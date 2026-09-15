# Task 9.3.3 — Tracking Surface Rate Limiting (AP-1) — Final Verification Report

**Date:** 2026-09-11
**Finding addressed:** AP-1 — No rate limiting on tracking surface endpoints
**Branch:** main

---

## Summary

| Section | Result |
|---------|--------|
| 1. Rate limiter implementation | PASS |
| 2. Environment variables | PASS |
| 3. Endpoint wiring | PASS |
| 4. test_geo production guard (A-5) | PASS |
| 5. JWT kind validation (A-4) | PASS |
| 6. Test suite | PASS |
| 7. Lint | PASS |
| 8. TypeScript compile | PASS (0 new errors) |

---

## 1. Rate Limiter Implementation

**Result: PASS**

**File:** `src/lib/tracking-rate-limit.ts` (new)

- Redis-backed sliding window counter using 5 × 1-minute buckets.
- IP address hashed with SHA-256 before use as the Redis key (privacy, key-length safety).
- Pipeline: `INCR key` → `EXPIRE key 300` in a single round-trip.
- **Fail-open design:** any Redis error returns `{ limited: false, count: 0 }` — tracking continues when Redis is down.
- Skipped entirely in `development` and `test` environments (`NODE_ENV` check at call site).
- Exports: `checkTrackingRateLimit()`, `CLICK_LIMIT`, `POSTBACK_LIMIT`, `TrackingEndpoint`, `RateLimitResult`.

---

## 2. Environment Variables

**Result: PASS**

**File:** `src/config/env.ts`

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRACKING_RL_CLICK_LIMIT` | `120` | Max requests per 5-min window for /click and /sl |
| `TRACKING_RL_POSTBACK_LIMIT` | `60` | Max requests per 5-min window for /postback, /pixel, /iframe |

---

## 3. Endpoint Wiring

**Result: PASS**

**File:** `src/surfaces/tracking/app.ts`

| Endpoint | Method | Limit | Notes |
|----------|--------|-------|-------|
| `/click` | GET | `CLICK_LIMIT` (120) | After `process.hrtime.bigint()`; logs warning on limit |
| `/sl` | GET | `CLICK_LIMIT` (120) | Smart-link redirect |
| `/postback` | GET | `POSTBACK_LIMIT` (60) | After `cache-control: no-store` header |
| `/pixel` | GET | `POSTBACK_LIMIT` (60) | |
| `/iframe` | GET | `POSTBACK_LIMIT` (60) | |

429 response shape: `{ error: 'rate_limited' }` with `Retry-After` header (seconds until window expires).

All blocks share the same pattern:

```typescript
if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
 const clientIp = (req.ip as string | undefined) ??
 (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const rl = await checkTrackingRateLimit(clientIp, '<endpoint>', <LIMIT>);
 if (rl.limited) {
 return reply.code(429).header('retry-after', String(rl.retryAfterSeconds))
 .send({ error: 'rate_limited' });
 }
}
```

### Geo-forcing hardened (A-5)

The inline `env.NODE_ENV === 'development' ? ...` expression was replaced with a call to `resolveForcedGeo()` from `geo-rules.ts`, centralizing the production guard in one tested pure function.

**File:** `src/surfaces/tracking/geo-rules.ts` (modified — `resolveForcedGeo` added)

---

## 4. test_geo Production Guard (A-5)

**Result: PASS**

**File:** `test/isolation/tracking-test-geo-guard.test.ts` (new, 9 tests)

| Test | Result |
|------|--------|
| production + test_geo=US → null | PASS |
| production + geo=DE → null | PASS |
| production + both null → null | PASS |
| development + test_geo=US → 'US' | PASS |
| development + geo=GB, test_geo=US → 'GB' (geo wins) | PASS |
| development + lowercase 'us' → 'US' | PASS |
| development + 'USA' → 'US' (truncated) | PASS |
| development + empty string → null | PASS |
| development + whitespace → null | PASS |

---

## 5. JWT Kind Validation (A-4)

**Result: PASS**

**File:** `test/isolation/dashboard-kind-validation.test.ts` (new, 5 tests)

| Test | Result |
|------|--------|
| kind='' (empty) → 401 | PASS |
| kind='superuser' (unknown) → 401 | PASS |
| kind='admin' → 200, identity.kind='admin' | PASS |
| kind='publisher' → 200, identity.kind='publisher' | PASS |
| kind='advertiser' → 200, identity.kind='advertiser' | PASS |

---

## 6. Test Suite

**Result: PASS**

```
Test Files 17 passed | 4 skipped (21)
Tests 171 passed | 30 skipped (201)
```

- 0 failures.
- 4 skipped files are integration tests requiring live DB/Redis (expected in isolated test run).
- New test files contributed:
 - `tracking-rate-limit.test.ts` — 5 tests
 - `tracking-test-geo-guard.test.ts` — 9 tests
 - `dashboard-kind-validation.test.ts` — 5 tests

---

## 7. Lint

**Result: PASS**

All changed files pass `eslint` with zero errors.

The only warnings are 6 `@typescript-eslint/no-explicit-any` in `tracking-rate-limit.test.ts` for the `globalThis.__mockRedis` mock slot — this is the documented standard pattern for per-test mock injection in vitest (top-level `vi.mock` + global slot) and cannot be avoided without restructuring the test architecture.

---

## 8. TypeScript Compile

**Result: PASS (0 new errors)**

`tsc --noEmit` reports 10 pre-existing errors all in `src/lib/analytics/backfill.ts` (`TS18048` / `TS2339`). These are unchanged from the baseline (confirmed by stashing all working-copy changes and re-running). Zero new errors introduced.

---

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src/config/env.ts` | Modified | Added `TRACKING_RL_CLICK_LIMIT`, `TRACKING_RL_POSTBACK_LIMIT` |
| `src/lib/tracking-rate-limit.ts` | **New** | Sliding window rate limiter (fail-open, 5×1min buckets, sha256 IP hash) |
| `src/surfaces/tracking/app.ts` | Modified | Rate limit blocks on /click, /sl, /postback, /pixel, /iframe; resolveForcedGeo |
| `src/surfaces/tracking/geo-rules.ts` | Modified | Added `resolveForcedGeo()` pure function |
| `test/isolation/tracking-rate-limit.test.ts` | **New** | 5 tests: under/over threshold, fail-open, postback, sl |
| `test/isolation/tracking-test-geo-guard.test.ts` | **New** | 9 tests: production guard + dev behavior for test_geo/geo |
| `test/isolation/dashboard-kind-validation.test.ts` | **New** | 5 tests: empty kind, unknown kind, valid kinds |
