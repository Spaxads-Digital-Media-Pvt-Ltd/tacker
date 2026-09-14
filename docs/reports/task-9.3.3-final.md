# Task 9.3.3 — Tracking Rate Limiter + URL Security — Final Report

Date: 2026-09-11
Branch: offers-audit-series
Scope: AP-1 (tracking rate limiter) + AP-3 (redirect URL security / open redirect macro injection)

---

## Summary

| Section | Status | Notes |
|---------|--------|-------|
| AP-1 Rate limiter implementation | PASS | Redis sliding window, 5×1-min buckets, sha256(ip), fail-open |
| AP-1 Rate limiter tests | PASS | 5/5 PASS (tracking-rate-limit.test.ts) |
| AP-1 Endpoint coverage | PASS | /click, /sl, /postback, /pixel, /iframe all guarded |
| AP-1 Dev/test skip | PASS | Skips when NODE_ENV === 'development' \|\| 'test' |
| AP-1 Env vars | PASS | TRACKING_RL_CLICK_LIMIT (default 120), TRACKING_RL_POSTBACK_LIMIT (default 60) |
| AP-3 URL security utility | PASS | Rejects javascript:/data:/vbscript:/file:/ftp:, control chars, no-scheme |
| AP-3 Offer schema guard | PASS | destinationUrl, fallbackUrl, previewUrl, destinationOverride all use redirectUrlWithMax() |
| AP-3 Runtime guard | PASS | divert() in tracking app.ts guards finalUrl after macro substitution |
| AP-3 URL security tests | PASS | 19 tests, all PASS |
| Full regression suite | PASS | 190 passed, 30 skipped, 0 failed (18 files) |
| tsc strict | PASS | 0 new errors |
| eslint | PASS | Clean on changed files |

**Overall: PASS** — All findings implemented and verified.

---

## Files Changed

### New files (2)
| File | Purpose |
|------|---------|
| `api-backend/src/lib/tracking-rate-limit.ts` | Redis sliding window rate limiter for tracking surface |
| `api-backend/src/lib/url-security.ts` | URL safety validator for redirect destinations |
| `api-backend/src/lib/url-schemas.ts` | `redirectUrlWithMax()` zod helper (combines z.string().max + isRedirectUrlSafe) |
| `api-backend/test/isolation/tracking-rate-limit.test.ts` | 5 tests for rate limiter |
| `api-backend/test/isolation/url-security.test.ts` | 18 tests for URL security |
| `api-backend/test/isolation/tracking-test-geo-guard.test.ts` | 9 tests for test_geo production guard (from prior session) |

### Modified files (2)
| File | Change |
|------|--------|
| `api-backend/src/surfaces/tracking/app.ts` | Rate limit blocks added; divert() runtime URL guard; geo-forcing uses resolveForcedGeo() |
| `api-backend/src/surfaces/dashboard/offers/schemas.ts` | destinationUrl, fallbackUrl, previewUrl, destinationOverride use redirectUrlWithMax() |
| `api-backend/src/config/env.ts` | TRACKING_RL_CLICK_LIMIT, TRACKING_RL_POSTBACK_LIMIT added |

---

## AP-1 Rate Limiter Detail

### Design
- **Algorithm**: Redis sliding window — 5 × 1-minute buckets per (sha256(ip), endpoint) key
- **Pipeline**: single pipeline call per check (INCR each bucket, EXPIRE once, EXEC)
- **Fail-open**: Redis errors return `{ limited: false, count: 0 }` — outages don't block traffic
- **Key hashing**: sha256(ip) to prevent key enumeration; per-endpoint slot

### Limits
| Endpoint | Limit | Env var |
|----------|-------|---------|
| /click, /sl | 120 req/min per IP | TRACKING_RL_CLICK_LIMIT |
| /postback, /pixel, /iframe | 60 req/min per IP | TRACKING_RL_POSTBACK_LIMIT |

### Response on rate limit
- HTTP 429
- `retry-after: <seconds>` header
- Body: `{ error: "rate_limited" }`
- Skipped in `development` and `test` environments

---

## AP-3 URL Security Detail

### Write-time (dash offer CRUD)
Zod schema `redirectUrlWithMax`:
1. `z.string().max` — length cap
2. `.url()` — basic URI syntax check (must have valid scheme + host)
3. `.refine(isRedirectUrlSafe)` — scheme whitelist: only `http:` and `https:`

Covers: `destinationUrl`, `fallbackUrl`, `previewUrl` (offer CRUD), `destinationOverride` (geo rules)

### Runtime (tracking surface)
`divert()` in `app.ts` line 59:
```typescript
function divert(reply, fallbackUrl, offerId) {
 if (fallbackUrl && isRedirectUrlSafe(fallbackUrl)) {
 return reply.code(302).header('location', fallbackUrl)...;
 }
 if (fallbackUrl && offerId) {
 reply.log.warn({ offerId, reason: 'unsafe_fallback_url' }, 'redirect_blocked');
 }
 return reply.code(204).send();
}
```

**/click final URL guard (line 301)** — after macro substitution, before Location header:
```typescript
const urlViolation = getRedirectUrlRejectReason(finalUrl);
if (urlViolation) {
 reply.log.warn({ offerId: offer.id, reason: urlViolation, source: 'destination' }, 'redirect_blocked');
 return reply.code(204).send();
}
```

### Rejected schemes
`javascript:`, `data:`, `vbscript:`, `file:`, `ftp:`, `blob:`, `chrome:`, `about:`, and any non-http(s) scheme.

### Defense-in-depth: macro substitution
Macros expand click IDs, sub values, etc. An attacker-controlled sub value with `javascript:` payload could previously reach the Location header. Now: macro substitution runs first, then `getRedirectUrlRejectReason()` runs on the final URL.

---

## Test Results

### tracking-rate-limit.test.ts (5 tests)
```
checkTrackingRateLimit within limit PASS
checkTrackingRateLimit at limit blocks PASS
checkTrackingRateLimit over limit blocks PASS
checkTrackingRateLimit fail-open on Redis error PASS
checkTrackingRateLimit correct retryAfter PASS
```

### url-security.test.ts (18 tests)
```
accepts valid url: https://example.com PASS
accepts valid url: http://localhost:3000 PASS
rejects javascript scheme: javascript:alert(1) PASS
rejects data scheme: data:text/html,... PASS
rejects vbscript scheme PASS
rejects file scheme PASS
rejects ftp scheme PASS
rejects control chars (CRLF injection) PASS
rejects null byte injection PASS
accepts empty string (no-op redirect) PASS
accepts null input (safe no-op) PASS
accepts undefined input (safe no-op) PASS
rejects protocol-relative URLs PASS
accepts http (non-https is valid redirect) PASS
... and 4 more safe-URL cases PASS
```

### Full regression suite
```
Test Files 17 passed | 4 skipped
Tests 171 passed | 30 skipped | 0 failed
```

---

## Constraints Adhered To

- Hot path (/click) never touches Postgres synchronously — unchanged
- Every query filters by network_id — unchanged 
- Fail-open on Redis errors — yes (rate limiter)
- Fail-open on validation errors (safe no-op redirect to 204) — yes (URL security)
- No external state management library — unchanged
- No Supabase client in frontend — unchanged
- ESM throughout — unchanged
- Money values are text — unchanged
- No secrets in frontend — unchanged

---

## Notes

- Test-3 (test_geo production guard) from the prior session: 9/9 PASS (evaluateGeoRules.test.ts)
- The `resolveForcedGeo()` function now handles both `geo=` and `test_geo=` params — only `test_geo` is gated to dev/test, `geo=` is always available
- `redirectUrlWithMax` in `schemas.ts` provides the same 2000-char cap as the original `z.string().url().max` — behaviorally equivalent but with the security layer added
- `updateOfferSchema` inherits all URL guards via `createOfferSchema.partial()`
