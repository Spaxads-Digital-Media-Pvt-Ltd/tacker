# Task 9.3.4-A — Public API Security Audit Report

**Date:** 2026-09-12
**Branch:** main
**Auditor:** Claude Sonnet 4.6 (read-only audit — no code changes)
**Scope:** Public REST API surface only (`src/surfaces/public-api/`)

---

## Audit Methodology

All 9 source files in `src/surfaces/public-api/` plus the auth and key-management libraries they depend on were reviewed. Each finding traces to a specific file:line. Severity follows CVSS-inspired categories:

- **CRITICAL** — Exploitable without auth, or data loss / privilege escalation
- **HIGH** — Requires a low-privilege account, but leads to data exfiltration or unauthorized mutation
- **MEDIUM** — Defense-in-depth gap, information leak, or abuse of legitimate feature
- **LOW** — Design gap, missing hardening, or informational concern
- **INFO** — Observations that don't pose a direct threat today

Targeted test run: `test/isolation/api-audience.test.ts` — 3/3 PASS.

---

## Route Inventory

| Namespace | Method | Path | Scope |
|-----------|--------|------|-------|
| advertiser | GET | /offers | offers:read |
| advertiser | GET | /conversions | conversions:read |
| advertiser | POST | /conversions | conversions:write |
| advertiser | GET | /stats | stats:read |
| publisher | GET | /offers | offers:read |
| publisher | GET | /conversions | conversions:read |
| publisher | GET | /earnings | earnings:read |
| publisher | GET | /stats | stats:read |
| network | GET | /offers | offers:read |
| network | GET | /publishers | publishers:read |
| network | GET | /advertisers | advertisers:read |
| network | GET | /reports/summary | reports:read |
| network | GET | /reports | reports:read |
| network | POST | /payouts | payouts:write |
| any | GET | /openapi.json | (public, unauthenticated) |

**Total:** 14 authenticated endpoints, 1 public endpoint.

---

## Architecture Summary

```
/api/v1/advertiser/* → apiKeyAuth → requireAudience('advertiser') → advertiserApi()
/api/v1/publisher/* → apiKeyAuth → requireAudience('publisher') → publisherApi()
/api/v1/network/* → apiKeyAuth → requireAudience('network') → networkApi()
/api/v1/openapi.json → (no auth)
```

Three-layer auth chain:
1. `apiKeyAuth` — key resolution, rate limit, identity attachment
2. `requireAudience` — namespace segregation (403 before handler)
3. `requireScope` — per-endpoint capability check

---

## Findings

### A-1 — CRITICAL: POST /advertiser/conversions bypasses click ownership when click is not yet in DB

**File:** `src/surfaces/public-api/advertiser.ts:76-85`
**Attack scenario:** An advertiser with a valid API key knows a `click_id` that hasn't been flushed to Postgres yet (still in Redis fast-path). They call POST /conversions with that `click_id`. The JOIN query `SELECT o.advertiser_id FROM clicks c JOIN offers o` returns zero rows (`rows[0]` is undefined). The ownership check `if (rows[0] && rows[0].advertiser_id !== id.ownerId)` is skipped because `rows[0]` is falsy. `recordConversion()` is called with `skipSecureCode: true`, which then uses the Redis fast-path `findClick()` to locate the click — and will successfully attribute it to whatever advertiser the click's offer belongs to. The advertiser key holder can therefore post conversions for clicks that belong to *other advertisers*, provided those clicks haven't reached Postgres yet.

**Concrete flow:**
1. Advertiser A has key `adv_live_XXXX`
2. A click is generated for an offer owned by Advertiser B — stored in Redis, not yet persisted to `clicks` table
3. Advertiser A sends POST /conversions with that `click_id`
4. `clicks` JOIN returns no row → ownership check passes vacuously
5. `recordConversion` finds the click in Redis → attributes to Advertiser B's offer
6. Conversion recorded under Advertiser B, with Advertiser A's key as caller

**Root cause:** The ownership check has an implicit "trust when unknown" branch — absence of a row is treated as "passes ownership" rather than "unverifiable → reject".

---

### A-2 — HIGH: /payouts accepts arbitrary publisherIds from the request body

**File:** `src/surfaces/public-api/network.ts:82-96`
**Attack scenario:** A network-level API key holder (correct audience) calls POST /payouts with `publisherIds: ["pub-A", "pub-B", "pub-C"]`. The `createPayoutRun` function receives these IDs without any verification that those publishers actually belong to the caller's network, or that they exist. If `createPayoutRun` (in `src/lib/ledger/ledger.ts`) doesn't independently filter by `network_id`, a malicious or compromised network key could trigger payouts for publishers in *other networks* — or for non-existent publisher IDs causing unexpected ledger entries.

**Current protection:** The route does scope `id.networkId` into the call, but the `publisherIds` array comes verbatim from the caller's JSON body. Whether `createPayoutRun` validates each publisher ID against the network is not visible from this surface file. This is a trust-boundary violation — the API layer should never forward caller-supplied entity IDs to a financial operation without its own verification.

**Note:** This may be safe depending on what `createPayoutRun` does internally. However, the public API surface does not enforce this contract — it's a defense-in-depth gap.

---

### A-3 — HIGH: Error messages expose audience identity of valid keys

**File:** `src/surfaces/public-api/auth.ts:74`
**Attack scenario:** An attacker probes three namespaces with a stolen or guessed key fragment:
```
X-Api-Key: <partial_or_guessed_key>
```
For namespace `/api/v1/advertiser`: gets `"This key (audience=\"publisher\") may not access the \"advertiser\" API."`
For namespace `/api/v1/network`: gets `"This key (audience=\"advertiser\") may not access the \"network\" API."`

The error message explicitly reveals the key's `audience` field (advertiser/publisher/network). An attacker can use this to confirm:
1. A key fragment is valid (it resolved to a row)
2. The key's audience type — reducing the key-space they need to brute-force

**Impact:** Reduces the effective key search space. Combined with the fact that the key hash is SHA-256 (fast to compute), this assists offline dictionary attacks against captured hashes.

---

### A-4 — MEDIUM: OpenAPI spec is served without CORS headers

**File:** `src/surfaces/public-api/app.ts:23`
**Attack scenario:** The `/api/v1/openapi.json` endpoint is unauthenticated and the base app from `createBaseApp` does not appear to set CORS headers specifically for this route. Any origin can `fetch()` the spec from a victim's browser (CSRF-style) — revealing the full API structure, all scopes, and all endpoint paths to an attacker. This is low-severity individually (the spec is documentation, not secrets), but it:
- Reveals the exact API surface to unauthenticated scanners
- Enables targeted phishing ("your advertiser API key doesn't have conversions:write, update it here")
- Confirms which network namespaces exist

**Note:** The base app `createBaseApp` should be checked for CORS configuration. If CORS is set globally on the Express app, this finding is moot.

---

### A-5 — MEDIUM: Rate limit tier `unlimited` uses MAX_SAFE_INTEGER effectively as no-limit

**File:** `src/lib/apikeys/rate-limit.ts:10`
**Attack scenario:** A network admin creates a key with `rate_limit_tier = 'unlimited'`. The check at line 25 returns `n <= Number.MAX_SAFE_INTEGER` which is always true for any realistic count. Rate limit headers are still set (so a client *thinks* it's being limited) but no actual enforcement occurs. If a key is compromised, there is no backstop.

**Impact:** Low individually (unlimited tier is an explicit admin choice), but if a network operator accidentally assigns this tier to a public-facing integration key, there is no circuit breaker.

---

### A-6 — MEDIUM: POST /advertiser/conversions silently accepts any request body fields

**File:** `src/surfaces/public-api/advertiser.ts:69-99`
**Attack scenario:** The advertiser POST /conversions handler casts `req.body` to `Record<string, unknown>` and manually extracts fields. There is no `validateBody(zodSchema)` call. An attacker can send:
```json
{ "click_id": "valid", "txn_id": "x", "secureCode": "bypass-attempt", "skipSecureCode": true, ... }
```
The handler ignores `secureCode` and `skipSecureCode` from the body (it hardcodes `skipSecureCode: true`), but the absence of schema validation means:
- No type coercion or field whitelisting
- The raw body is stored as `rawParams: b` in the conversions record — potentially large or malicious payloads stored in the DB
- No explicit rejection of unexpected fields

**Impact:** Low — the handler ignores unknown fields for control flow, and `rawParams` is JSON-serialized. But missing schema validation is a defense-in-depth gap.

---

### A-7 — MEDIUM: POST /payouts body is not validated with zod

**File:** `src/surfaces/public-api/network.ts:85-96`
Same class as A-6. The body is cast inline: `(req.body ?? {}) as { publisherIds?: string[]; note?: string }`. No `validateBody` call. `note` is passed verbatim to `createPayoutRun` — if that function stores it in a log or DB column without length limits, it could be used for log injection or storage exhaustion.

---

### A-8 — LOW: /publisher/earnings hardcodes LIMIT 200 with no pagination

**File:** `src/surfaces/public-api/publisher.ts:72-78`
The `/earnings` endpoint queries `ledger_entries` with a hardcoded `LIMIT 200` and no `limit`/`offset` query parameters. For publishers with long histories, the response is silently truncated at 200 rows with no indication in the response envelope that more rows exist. There is no `pagination` field in the response. Compare to every other list endpoint which uses `paginationSchema` and returns `{ data, pagination: { limit, offset } }`.

**Impact:** Publishers cannot reliably page through their full ledger history via the API. They must rely on the dashboard for full history.

---

### A-9 — LOW: Scope/route mismatch — advertiser has settings:manage scope but no /settings endpoint

**File:** `src/lib/apikeys/keys.ts` (AUDIENCE_SCOPES) vs `src/surfaces/public-api/advertiser.ts`
The `AUDIENCE_SCOPES` for advertiser includes `'settings:manage'`, but there is no route in `advertiser.ts` that requires this scope. Similarly, publisher scopes include `'clicks:read'`, `'postbacks:manage'`, and `'links:generate'` with no corresponding routes in `publisher.ts`. These scopes are dead code from an authorization perspective — they clutter the key-creation UI and give integrators false expectations.

**Impact:** Confusion during integration; potential for future routes to be added without proper scope review.

---

### A-10 — LOW: No request body size limit on POST endpoints

**File:** `src/surfaces/public-api/app.ts` (global middleware)
Neither `express.json({ limit: '100kb' })` nor equivalent body size limiting is visible in the app setup (`createBaseApp`). Both POST endpoints (`/advertiser/conversions` and `/payouts`) accept request bodies. Without a body size limit, an attacker could send a multi-MB JSON payload, causing memory exhaustion on the API worker.

**Impact:** Low — mitigated by any upstream proxy (nginx, Cloudflare) body size limits. Worth verifying those are in place.

---

### A-11 — INFO: API key extracted only from headers (not query string)

**File:** `src/surfaces/public-api/auth.ts:23-29`
**Positive finding:** `extractKey()` only checks `X-Api-Key` header and `Authorization: Bearer`. Query string keys are explicitly rejected. This prevents keys from leaking into:
- Web server access logs
- Proxy logs
- Browser history
- Referrer headers

---

### A-12 — INFO: Keys stored as SHA-256 hash, never plaintext

**File:** `src/lib/apikeys/keys.ts` (hashKey function), `src/surfaces/public-api/auth.ts:35-40`
**Positive finding:** `key_hash = $1` with `hashKey(key)` — plaintext keys never touch the database. The full key is returned exactly once at creation.

---

### A-13 — INFO: Audience segregation is structural, not convention-based

**File:** `src/surfaces/public-api/app.ts:26-28`
**Positive finding:** Each namespace mounts `requireAudience()` as a separate middleware before the router. A key with audience=publisher hitting `/api/v1/network/*` gets 403 before any handler runs. This is enforced at the router mount level — no handler can accidentally skip it.

---

### A-14 — INFO: Rate limit is per-key and Redis-backed

**File:** `src/lib/apikeys/rate-limit.ts`
**Positive finding:** Fixed 60-second window, keyed by API key ID + minute bucket. Three tiers (default: 600/min, high: 6000/min, unlimited). Fail-open on Redis errors. Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`) exposed to clients.

---

### A-15 — INFO: Tenant isolation is structurally enforced

**File:** All route handlers in `advertiser.ts`, `publisher.ts`, `network.ts`
Every database query filters by `id.networkId`. Advertiser/publisher routes also filter by `id.ownerId`. Network routes have no owner filter (correct — network keys represent the operator). The identity object (`req.identity`) is set by `apiKeyAuth` and never re-derived by handlers — eliminating handler-level tenancy bugs.

---

## Attack Scenario Coverage

| Scenario | Status | Finding |
|----------|--------|---------|
| A: Key brute-force | Partial | SHA-256 is fast to compute; no key-format validation or early-reject on malformed keys before hash |
| B: Key reuse across namespaces | Blocked | `requireAudience` rejects with 403 |
| C: Key reuse across tenants | Blocked | All queries filter by `network_id` from the key |
| D: Replay attack | Partial | No nonce or timestamp validation on POST endpoints; idempotency key helps for conversions only |
| E: Information disclosure via errors | Issue | A-3: audience exposed in 403 messages |
| F: Mass assignment | Issue | A-6, A-7: body not schema-validated |
| G: Race condition / TOCTOU | Issue | A-1: click ownership check has implicit pass-on-miss |
| H: Rate limit bypass | Blocked | Per-key rate limit with Redis; no IP-based bypass vector visible |
| I: Scope escalation | Blocked | `requireScope` checks actual scopes; scopes are bounded by `AUDIENCE_SCOPES` ceiling |
| J: SQL injection | Blocked | Raw pg queries with parameterized `$1, $2...` everywhere; no string concatenation |
| K: Open redirect | N/A | No redirect logic in public API |
| L: DoS via large payload | Issue | A-10: no visible body size limit |

---

## Existing Protections — Assessment

| Protection | Status | Notes |
|------------|--------|-------|
| Key never in query string | ✅ | Only headers |
| Key stored as SHA-256 hash | ✅ | Never plaintext in DB |
| Audience segregation (structural) | ✅ | Mounted per-namespace |
| Scope enforcement | ✅ | `requireScope` middleware |
| Rate limiting (per-key) | ✅ | Redis-backed, three tiers |
| Tenant isolation (all queries) | ✅ | `network_id` filter everywhere |
| Owner isolation (advertiser/publisher) | ✅ | `advertiser_id`/`publisher_id` filter |
| Zod validation on query params | ✅ | `paginationSchema`, `reportQuerySchema` |
| Constant-time secureCode comparison | ✅ | `timingSafeCompare` from Task 9.3.3 |
| Click ownership check (advertiser posting) | ⚠️ | Has pass-on-miss gap (A-1) |
| Request body schema validation | ❌ | No `validateBody` on POST endpoints (A-6, A-7) |
| Request body size limit | ❌ | Not visible in surface code (A-10) |
| Error message sanitization | ⚠️ | Audience leaked in 403 (A-3) |
| Pagination on all list endpoints | ⚠️ | /earnings hardcoded LIMIT 200 (A-8) |

---

## Test Results

```
test/isolation/api-audience.test.ts — 3/3 PASS
 ✓ allows a key on its own namespace
 ✓ rejects every wrong-namespace combination with 403
 ✓ rejects when no identity is present (deny-by-default)
```

No existing tests cover:
- POST /advertiser/conversions click ownership edge cases
- POST /payouts with arbitrary publisherIds
- Error message content (audience leakage)
- Request body schema validation (absent)

---

## Summary

| Severity | Count | Key Findings |
|----------|-------|--------------|
| CRITICAL | 1 | A-1: click ownership bypass when click not in DB |
| HIGH | 2 | A-2: /payouts accepts arbitrary publisherIds; A-3: audience leaked in errors |
| MEDIUM | 4 | A-4: OpenAPI without CORS; A-5: unlimited tier; A-6/A-7: no body schema validation |
| LOW | 4 | A-8: /earnings hardcoded limit; A-9: scope/route mismatch; A-10: no body size limit |
| INFO | 5 | Positive findings (header-only keys, SHA-256, structural audience, rate limit, tenant isolation) |

**Critical path forward (if implementing fixes):**
1. A-1: Invert the ownership check — reject when `rows[0]` is absent (unverifiable), not pass
2. A-2: Verify `createPayoutRun` validates publisherIds against the network, or add explicit filter in the route
3. A-3: Remove audience field from 403 error message
4. A-6/A-7: Add `validateBody(zodSchema)` to both POST endpoints
5. A-8: Add `limit`/`offset` query params to /earnings
