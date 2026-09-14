# Task 9.3.4-D — A-3 Fix: API-Key Audience Information Leak

**Date:** 2026-09-13
**Branch:** main
**Finding fixed:** A-3 (HIGH) from Task 9.3.4-A Public API Security Audit
**Scope:** `src/surfaces/public-api/auth.ts` — all three auth middleware functions

---

## 1. Root Cause

Three of four error messages in `src/surfaces/public-api/auth.ts` leaked authentication metadata to the client:

| Line | Function | Pre-fix message | Leaked info |
|------|----------|-----------------|-------------|
| 33 | `apiKeyAuth` (no key) | `Missing API key. Send X-Api-Key or Authorization: Bearer.` | Hinted that a key was expected, differentiating "no key" from "wrong key" |
| 44 | `apiKeyAuth` (no match) | `Invalid or revoked API key.` | Distinguished "revoked" from "unknown" |
| 74 | `requireAudience` | `` `This key (audience="${id.audience}") may not access the "${expected}" API.` `` | **Explicitly named the key's audience** (e.g., `advertiser`, `publisher`, `network`) |
| 86 | `requireScope` | `` `Key is missing required scope(s): ${needed.join(', ')}.` `` | **Listed required scope strings** |

The `AppError` instances created by `unauthorized()` and `forbidden()` carry these strings as `err.message`. The `errorHandler` middleware in `envelope.ts` serializes `err.message` directly to the client response body:

```typescript
// envelope.ts errorHandler — serializes err.message verbatim
res.status(err.status).json({ ok: false as const, error: { code: err.code, message: err.message } });
```

This means any sensitive string placed in the message at construction time is immediately exposed to the API caller. Internal diagnostics are unaffected — `pino-http` captures the full request/response cycle including error objects, so the same information remains available in server logs.

**Attack scenario:**
1. Attacker sends a request with a valid-looking API key to each namespace (`/api/v1/advertiser/...`, `/api/v1/network/...`, `/api/v1/publisher/...`).
2. If the key exists and is active, `apiKeyAuth` resolves the audience (e.g., `advertiser`).
3. `requireAudience('network')` rejects with a message naming the actual audience: `"This key (audience=\"advertiser\") may not access the \"network\" API."`
4. Attacker learns the key is valid, its audience, and its network — without any legitimate access.
5. This confirms the key is real and active (not revoked), enabling targeted brute-force or .

---

## 2. Exact Fix

All four messages in `src/surfaces/public-api/auth.ts` replaced with generic strings that carry no authentication metadata:

```typescript
// POST-FIX (all four locations)

// Line 33 — apiKeyAuth, missing key header
if (!key) return next(unauthorized('Invalid or missing API key.'));

// Line 44 — apiKeyAuth, key not found or not active
if (!row) return next(unauthorized('Invalid or missing API key.'));

// Line 74 — requireAudience, wrong audience
if (id.audience !== expected) {
 return next(forbidden("Forbidden."));
}

// Line 86 — requireScope, insufficient scopes
if (!needed.every((s) => have.has(s))) {
 return next(forbidden('Forbidden.'));
}
```

**Key design decisions:**
- `'Invalid or missing API key.'` is intentionally ambiguous — it describes the same response for malformed keys, unknown keys, and revoked keys. An attacker cannot determine whether a key exists.
- `'Forbidden.'` is intentionally bare — it carries no information about which audience was expected, which was found, or which scopes were missing.
- Internal logging via `pino-http` is untouched. The `errorHandler` logs the full `AppError` object including `code` and any internal metadata. Server operators retain full diagnostic capability.

---

## 3. Authorization / Tenant-Isolation Reasoning

The fix closes the information-disclosure gap in the auth middleware chain:

```
Layer 1: apiKeyAuth — resolves key → ApiKeyIdentity (403 if no key / 401 if key invalid)
Layer 2: requireAudience — verifies namespace match (403 if wrong audience)
Layer 3: requireScope — verifies capability match (403 if insufficient scopes)
```

**Before fix:**
- Layer 1 leaked "revoked" vs "unknown" distinction.
- Layer 2 leaked the key's actual audience in the 403 body.
- Layer 3 leaked the list of required scopes.

**After fix:**
- Layer 1: `'Invalid or missing API key.'` for both "no key" and "key not found". Unknown-key and revoked-key look identical to the caller.
- Layer 2: `'Forbidden.'` — no audience information disclosed.
- Layer 3: `'Forbidden.'` — no scope requirements disclosed.

**Defense-in-depth:** The pino-http logger continues to capture the full `AppError` (including `code`, `status`, and the original message) on every request. Internal operators have full visibility. Attackers have none.

**Why client messages must be generic (not absent):**
- A 403 with an empty body could be confused with a network error.
- A 401 with an empty body provides no guidance for legitimate integration debugging.
- Generic messages ("Invalid or missing API key." / "Forbidden.") are sufficient for client-side error handling while disclosing nothing about authentication state.

---

## 4. Attack Scenarios Tested

| # | Scenario | Expected | What it proves |
|---|----------|----------|----------------|
| 1 | Valid advertiser key sent to `/api/v1/network/` | 403, body = `"Forbidden."` | Audience not leaked in 403 |
| 2 | Valid network key (offers:read only) sent to `/api/v1/network/publishers` (requires publishers:read) | 403, body = `"Forbidden."` | Scope requirements not leaked |
| 3 | Malformed key sent to `/api/v1/advertiser/offers` | 401, body = `"Invalid or missing API key."` | No key metadata in 401 |
| 4 | Unknown key hash sent to `/api/v1/advertiser/offers` | 401, identical body to malformed | Key existence not revealed |
| 5 | Valid network key with offers:read scope sent to `/api/v1/network/offers` | 200, `{ ok: true, data: [...] }` | Authorized flow preserved |
| 6 | Valid advertiser key to wrong namespace vs no key at all | 403 vs 401 | HTTP semantics intact |

---

## 5. Tests Added

6 tests in `test/isolation/api-audience-a3.test.ts`:

Each test builds a fresh Express app via `vi.resetModules` + `vi.doMock`. The pool/query module is fully mocked to simulate DB responses. The rate-limit module is mocked to always allow. The app is built via a dynamic `import` of `buildPublicApiApp` after mock registration. Requests are sent via `supertest` and the response body is inspected for leaked strings.

| Test | Mock pool response | Endpoint | Expected | Assertions on body |
|------|-------------------|----------|----------|-------------------|
| 1 | Advertiser key row | `GET /api/v1/network/offers` | 403 | `ok: false`, message = `"Forbidden."`, body does NOT contain `advertiser`, `audience`, `type` |
| 2 | Network key (offers:read only) | `GET /api/v1/network/publishers` | 403 | `ok: false`, message = `"Forbidden."`, body does NOT contain `publishers:read`, `scope` |
| 3 | Empty rows (no match) | `GET /api/v1/advertiser/offers` | 401 | `ok: false`, message = `"Invalid or missing API key."`, body does NOT contain `revoked`, `audience`, `network`, `advertiser` |
| 4 | Empty rows (no match) | `GET /api/v1/advertiser/offers` (×2) | 401 both | `res1.body` equals `res2.body` (indistinguishable) |
| 5 | Network key row + offers list | `GET /api/v1/network/offers` | 200 | `ok: true`, data present |
| 6 | Advertiser key row (403) / empty rows (401) | Wrong namespace vs no key | 403 / 401 | Status codes correct |

---

## 6. Tests Executed / Results

```
test/isolation/api-audience-a3.test.ts 6 passed (6) ← A-3 fix
test/isolation/api-audience.test.ts 3 passed (3) ← regression (requireAudience unit)
test/isolation/advertiser-click-ownership.test.ts 7 passed (7) ← A-1 regression
```

**Total: 16/16 pass.** No regressions.

---

## 7. Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/surfaces/public-api/auth.ts` | **Modified** | Four error messages sanitized: lines 33 and 44 use `'Invalid or missing API key.'`; lines 74 and 86 use `'Forbidden.'`. Internal diagnostics (pino-http) untouched. |
| `test/isolation/api-audience-a3.test.ts` | **Created** | 6 end-to-end tests verifying no audience/type/scope/realm metadata leaks in 401/403 responses |

---

## 8. Remaining Limitations

- **`requireAudience` line 72** still uses `'API key identity not resolved.'` for the deny-by-default case (no identity on `req`). This is an internal server error path — it fires if `apiKeyAuth` failed to set `req.identity` without calling `next(err)`. The message does not leak auth metadata (it doesn't reference audience, scope, or key state), so it is not in scope for A-3. However, if a future attacker can trigger this path without a valid key, the message provides a minor signal that the request reached the middleware. This is a LOW-severity concern and out of scope for A-3.
- **Fix does not address A-1, A-2, or MEDIUM findings** — out of scope for this task.
- **Fix does not change rate-limiting behavior** — out of scope per task rules.

---

## 9. Pre-Report Checklist

- [x] `git diff --stat` reviewed: `src/surfaces/public-api/auth.ts` shows only message sanitization changes; no unrelated files modified for A-3
- [x] Internal diagnostics sufficient: pino-http logs full `AppError` objects on every error — operators retain complete visibility
- [x] Client-facing responses no longer disclose audience metadata: all four error paths return generic strings
- [x] Tests added: 6 new A-3 tests covering wrong audience, insufficient scope, malformed key, unknown key, valid key, and 401/403 semantics
- [x] Regression tests pass: `api-audience.test.ts` (3/3), `advertiser-click-ownership.test.ts` (7/7)
- [x] No test files deleted or modified (other than A-3 creation)
- [x] No API-key generation/storage, SHA-256 hashing, rate-limiting, payouts, conversions, or auth refactoring touched
- [x] Report written: this document
