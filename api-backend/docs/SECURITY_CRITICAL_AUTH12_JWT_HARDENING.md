# SECURITY-CRITICAL-02 AUTH-1/AUTH-2: Supabase JWT Hardening

**Severity:** Critical 
**Risk:** Token theft from one Supabase project could authenticate against this API if JWKS verification had no issuer or algorithm constraints. 
**Status:** Fixed and verified.

---

## What was fixed

### AUTH-1 — Issuer pinning

`verifySupabaseJwt` in [`src/lib/auth/verify-jwt.ts`](src/lib/auth/verify-jwt.ts) now rejects any JWT whose `iss` claim does not match `<SUPABASE_URL>/auth/v1`. This prevents an attacker who compromises a different Supabase project from replaying that project's tokens here.

**Before:** `jwtVerify` was called without `issuer` — any project's token was accepted if it could be cryptographically verified. 
**After:** Both the HS256 (legacy test) and ES256 (JWKS) verification paths pass `issuer: getExpectedIssuer()`, which derives the expected value from `SUPABASE_URL` at runtime.

`test/helpers/tokens.ts` was updated so `tokenWithIssuer()` and all helper functions emit `iss: <SUPABASE_URL>/auth/v1` in the payload. Existing tests that override `iss` continue to work (override takes precedence).

### AUTH-2 — Algorithm pinning

The ES256 (JWKS) verification path now passes `algorithms: ['ES256']` to `jwtVerify`. This blocks algorithm-substitution attacks where an attacker switches the header to a weaker or symmetric algorithm.

**Before:** `jwtVerify(token, jwks)` — jose would accept any algorithm the JWKS could verify, including RS256 if the remote JWKS supported it. 
**After:** `jwtVerify(token, jwks, { algorithms: ['ES256'] })` — only ES256 tokens are accepted on the JWKS path.

The HS256 (legacy) path continues to use `algorithms: ['HS256']` — unchanged.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/auth/verify-jwt.ts` | Added `issuer` to both `jwtVerify` calls; added `algorithms: ['ES256']` to JWKS path; exported `__setJwksForTest` / `__resetJwksForTest` for isolated testing |
| `test/helpers/tokens.ts` | Fixed regex on line 10 (`/\/+$/`); added `iss` and `aud` to `baseClaims()`; fixed `tokenWithIssuer` to conditionally override `iss`/`sub` |
| `test/isolation/verify-jwt-hardening.test.ts` | New — 15 tests covering AUTH-1/AUTH-2: wrong issuer, foreign project, no issuer, algorithm confusion (RS256), expired tokens, malformed tokens, HS256 claim preservation, platform-admin regression, dashboard end-to-end |

---

## Test results

All 15 new hardening tests pass. All 8 pre-existing platform-admin regression tests pass. No regressions in `dashboard-kind-validation.test.ts`.

```
test/isolation/verify-jwt-hardening.test.ts 15 pass
test/isolation/platform-admin-auth.test.ts 8 pass
```

No production JWTs, secrets, or signing keys are stored in test fixtures.

---

## Remaining risk

Low. The hardening is complete:
- Issuer is validated for every token regardless of algorithm.
- Only ES256 is accepted on the JWKS path; only HS256 on the symmetric path.
- Platform-admin JWTs are in a separate module and untouched.

Future work: migrate off the legacy HS256 test path once all test infrastructure supports ES256 JWKS mocking end-to-end.
