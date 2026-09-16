# Task 9.3.3 Final Report — Postback/Credit Security Hardening

**Date:** 2026-09-11
**Scope:** Address security findings from Task 9.1 (T-1 timingSafeEqual, T-2 per-click conversion abuse, T-3 postback auth hardening)
**Branch:** vivek/postback-security-hardening

---

## Summary

| Section | Finding | Status |
|---------|---------|--------|
| T-1: timingSafeEqual for secureCode comparison | Previously used `!==` (timing-side-channel vuln) | PASS |
| T-2: Per-click conversion abuse protection (distinct txnId variation) | Not implemented | PASS |
| T-3: Postback source guard + secureCode enforcement | Already correctly guarded | PASS |
| T-3: skipSecureCode path audit | Verified correct behavior | PASS |
| Security tests | 26 tests covering T-1 + T-2 | PASS (26/26) |
| Regression: full test suite | 225 tests | PASS |
| tsc: new type errors | 0 new errors | PASS |
| eslint: changed source files | 0 errors | PASS |

---

## T-1: timingSafeEqual for secureCode comparison

**Finding:** `src/surfaces/tracking/conversions/record.ts` line 124 used `input.secureCode !== required` to compare the postback `secureCode` against the offer's configured code. This is a classic timing-side-channel vulnerability: an attacker can probe the code character-by-character by measuring response latency differences.

**Fix:**
- Created `src/lib/secure-code-compare.ts` — pure function `timingSafeCompare(provided, reference)` using Node.js `crypto.timingSafeEqual`
- Rejects non-string input, mismatched lengths, and short references (<8 chars) without calling `timingSafeEqual`
- Returns `{ ok: boolean, refLen: number }` — always returns the same shape regardless of failure reason
- Never throws — catches Buffer allocation errors
- Updated `record.ts` to call `timingSafeCompare(input.secureCode, required)` instead of `!==`
- All failure reasons produce an indistinguishable result shape — no partial-match information exposed

**Tests:** 13 tests in `test/isolation/timing-safe-compare.test.ts` — PASS

---

## T-2: Per-click conversion abuse protection

**Finding:** An attacker who knows or guesses a `click_id` could rapidly submit conversions with varying `txn_id` values. The existing idempotency key (`convidem:${clickId}:${txnId}`) prevents duplicate writes per txnId but does not limit the *rate of distinct txnId submissions* per click.

**Fix:**
- Created `src/lib/conversion-abuse.ts` — exported `checkConversionAbuse(redis, clickId, txnId, networkId)`
- Key: `convabuse:${networkId}:${clickId}` (scoped by tenant — no cross-tenant bleed)
- Increments on every call with a non-empty txnId
- Sets TTL (600s) on first increment
- Returns `{ limited: boolean, count: number }`
- Fail-open on Redis errors (never blocks legitimate conversions)
- Null/empty txnId bypasses the guard (idempotency key handles those)
- Wired into `recordConversion()` *before* click lookup — fail fast on obvious abuse

**Tests:** 13 tests in `test/isolation/conversion-abuse.test.ts` — PASS
- Under threshold: not limited
- Over threshold (11th attempt): limited
- Null/empty txnId: bypassed
- Cross-tenant: keys properly scoped
- TTL: set only on first increment
- Redis failure: fail-open

---

## T-3: Postback authentication hardening

**Verified behaviors (no changes needed):**
- `skipSecureCode: true` is only set by the authenticated public-API-key path — not attacker-controllable
- `source === 'postback'` guard correctly restricts secureCode enforcement to S2S postbacks only
- Pixel/iframe sources never reach the secureCode check (correctly excluded)
- The `required` fallback chain (`offer.securityCode || offer.networkSecurityCode || null`) is correct

---

## Tenant/Ownership Verification (T-5)

**Verified:**
- `recordConversion()` receives `networkId` from the caller — all Redis keys include `networkId`
- `findClick()` queries with `WHERE network_id = $2` — no cross-tenant data leak
- `getOfferConfig(input.networkId, ...)` — offer lookup is tenant-scoped
- The abuse guard key `convabuse:${networkId}:${clickId}` is tenant-scoped
- Test `scopes keys by networkId + clickId (no cross-tenant bleed)` confirms this

---

## Redis Key Security (T-6)

**Verified:**
- `convidem:${clickId}:${txnId ?? event ?? 'default'}` — idempotency key (existing, unchanged)
- `convabuse:${networkId}:${clickId}` — abuse guard key (new) — includes tenant prefix
- No plaintext secureCode stored in Redis at any point
- All keys use a fixed-length, non-secret format

---

## Failure Behavior (T-7)

| Component | Redis Failure Behavior |
|-----------|----------------------|
| Idempotency key (`set`) | Falls through; DB unique index is authoritative |
| Abuse guard (`checkConversionAbuse`) | Returns `{ limited: false }` — fail open |
| `timingSafeCompare` | Returns `{ ok: false }` — no throw |
| Postback enqueue | Queued via BullMQ — Redis failure = no postback sent (not critical) |

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/lib/secure-code-compare.ts` | **Created** | `timingSafeCompare()` — constant-time comparison |
| `src/lib/conversion-abuse.ts` | **Created** | `checkConversionAbuse()` — per-click txnId rate limit |
| `src/surfaces/tracking/conversions/record.ts` | **Modified** | Replaced `!==` with `timingSafeCompare`; added abuse guard before click lookup |
| `test/isolation/timing-safe-compare.test.ts` | **Created** | 13 tests for timing-safe comparison |
| `test/isolation/conversion-abuse.test.ts` | **Created** | 13 tests for conversion abuse guard |
| `src/lib/redis.ts` | **Read only** | Verified `Redis` type available from `ioredis` |
| `src/surfaces/tracking/geo-rules.ts` | **Read only** | Verified `resolveForcedGeo` pattern |

---

## Test Results

```
Test Files 25 passed | 4 skipped (29 total)
Tests 225 passed | 30 skipped | 0 failed (255 total)
Duration 5.93s
```

**New tests added:** 26 (13 timingSafeCompare + 13 conversion-abuse)

**tsc new errors:** 0 (pre-existing `backfill.ts` errors remain, unrelated)
**eslint source errors:** 0
