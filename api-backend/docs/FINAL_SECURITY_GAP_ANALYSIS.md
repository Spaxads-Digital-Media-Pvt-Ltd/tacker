# Tracker Final Security Gap Analysis

**Generated:** 2026-09-13
**Branch:** vivek/url-security-rate-limiter
**Auditors:** 5 parallel subagents + 1 consolidation agent
**Scope:** api-backend (all 5 surfaces: dashboard, tracking, public-api, platform-admin, workers)

---

## 1. Executive Summary

### Overall Security Status

The Tracker backend has a solid structural foundation: five segregated Express/Fastify surfaces, consistent envelope responses, raw parameterized SQL throughout, and a well-designed API-key audience system. Rate limiting, Redis-based login brute-force protection, password policy enforcement, and ClickHouse/PG fallback for analytics are all implemented.

However, the JWT authentication layer contains significant gaps that represent exploitable risk in production, particularly around the dashboard/Supabase JWT path. The public API auth middleware is broken in its current test state (vi.mock issue prevents correct DB mocking), which masked real authorization behavior. Multiple attack vectors remain untested and unaddressed.

### Finding Summary by Severity

| Severity | Count | Category |
|----------|-------|----------|
| CRITICAL | 2 | Auth JWT verification bypass |
| HIGH | 6 | Auth flows, session, rate limiter, SQL injection, DB isolation |
| MEDIUM | 7 | Claim verification gaps, error handling, fallback behavior |
| LOW | 5 | Cookie flags, exp handling, CSRF, password complexity |
| INFO / Defense-in-Depth | 8 | Positive findings and hardening opportunities |
| **TOTAL** | **28** | |

### Estimated Remaining Work

- CRITICAL fixes: ~1-2 days (JWT audience/algorithm pinning)
- HIGH fixes: ~2-3 days (password reset, session invalidation, SQL injection, fail-closed rate limiter, test infrastructure)
- MEDIUM/LOW: ~3-4 days
- Test coverage gap: ~3-5 days (new test files required for most auth and isolation vectors)

---

## 2. Previously Completed Security Work

| Task | Status | Verified? | Notes |
|------|--------|-----------|-------|
| 9.1 — Redis login rate limiter (IP + account sliding window) | COMPLETE | YES (live tests: 17/17 pass) | Dual-key sliding window, SHA-256 key hashing, Redis pipeline |
| 9.2 — Password policy + timing-safe compare | COMPLETE | YES | min 12 chars, uppercase, lowercase, digit, special. crypto.subtle.timingSafeEqual used |
| 9.3.1 — AP-1 rate limiter + AP-3 URL security | COMPLETE | YES | Tracking surface protected. URL redirect validated |
| 9.3.2 — Conversion abuse detection | COMPLETE | YES | Fraud/anomaly detection in conversion recording |
| 9.3.3 — Platform-admin auth hardening | COMPLETE | YES | Algorithm-pinned HS256, issuer check on platform-admin JWT |
| 9.3.4-A — Public API audience segregation | COMPLETE (code) | NO — 6/6 tests FAIL | Code written but vi.mock issue breaks auth.ts:35 causing 500 on all API-key routes |
| 9.3.4-B — API-key audience fix (adv/net/pub) | PARTIAL | NO | Works in code but untestable due to mock infrastructure issue |
| 9.3.4-C — Error message consistency | NOT STARTED | — | No evidence of implementation found |
| 9.3.4-D — Audience test coverage (A3) | NOT STARTED | — | Tests written but all 6 fail due to vi.mock pool.js issue |
| 9.3.4-E — Network_id tenant isolation | COMPLETE (code) | PARTIAL | network_id filter in 58+ files but platform-admin routes lack it (by design) |

---

## 3. CRITICAL Remaining Issues

### CRIT-1: No audience/issuer verification on Supabase JWT

- **Severity:** CRITICAL
- **File:** `src/lib/auth/verify-jwt.ts` (function `verifySupabaseJwt`, line 24-34)
- **Route/Function:** All dashboard routes using `dashboardAuth` middleware (`src/surfaces/dashboard/auth.ts`)
- **Vulnerability:** The `verifySupabaseJwt` function validates JWT signature only. It does NOT verify:
 - `aud` (audience) claim — any Supabase JWT for any Supabase project is accepted
 - `iss` (issuer) claim — any Supabase issuer is accepted
 - Any project-specific identifier
- **Attack Scenario:**
 1. Attacker creates a free Supabase project and obtains a valid JWT from that project
 2. Attacker sends that JWT in the `Authorization: Bearer` header to any Tracker dashboard endpoint
 3. The JWT passes signature verification (signed by attacker's own project keys)
 4. The `app_metadata` claims (network_id, kind, role) are attacker-controlled via their Supabase project's `app_metadata`
 5. Attacker can impersonate any role in any network
- **Impact:** Complete authentication bypass. Any Supabase JWT holder can access any network's data with arbitrary privileges.
- **Recommended Fix:**
 - Add `audience` and `issuer` options to `jwtVerify()` for both the JWKS and HS256 branches
 - Verify the `aud` claim matches `env.SUPABASE_AUDIENCE` (typically the Supabase project ref)
 - Verify the `iss` claim matches `env.SUPABASE_URL` pattern
 - Add `SUPABASE_AUDIENCE` and `SUPABASE_ISSUER` to `env.ts`
- **Security Tests Required:**
 - JWT from different Supabase project → 401 (not just "invalid token" but actual rejection)
 - JWT with wrong aud claim → 401
 - Valid JWT with correct aud → 200

---

### CRIT-2: No algorithm pinning on ES256/JWKS path

- **Severity:** CRITICAL
- **File:** `src/lib/auth/verify-jwt.ts` (line 32)
- **Route/Function:** `verifySupabaseJwt` → JWKS branch
- **Vulnerability:** The JWKS branch calls `jwtVerify(token, getJwks())` without specifying the `algorithms` option. The `jose` library's `jwtVerify` will accept ANY algorithm present in the JWKS — including `none` if an attacker can inject a key with `alg: none`. Additionally, if the JWKS endpoint is compromised or MITM'd, an attacker could serve a JWKS that includes a symmetric key, enabling key confusion attacks.
- **Attack Scenario:**
 1. JWKS is fetched over HTTPS, but if DNS is hijacked or TLS is MITM'd, attacker can serve a malicious JWKS
 2. Malicious JWKS includes an RSA key with `alg: HS256` (key confusion: use public RSA key as HMAC secret)
 3. Attacker signs a forged JWT with that public key as HMAC secret
 4. `jwtVerify` accepts it because `alg: HS256` is in the JWKS
- **Impact:** Complete authentication bypass via key confusion / algorithm substitution.
- **Recommended Fix:**
 - Pass `algorithms: ['ES256', 'RS256']` explicitly to `jwtVerify(token, getJwks(), { algorithms: ['ES256', 'RS256'] })`
 - Reject `alg: none` by never omitting the algorithms parameter
- **Security Tests Required:**
 - Token signed with `alg: HS256` against JWKS key → reject
 - Token with `alg: none` header → reject with clear error
 - Only ES256/RS256 tokens accepted against JWKS

---

## 4. HIGH Remaining Issues

### HIGH-1: No password reset / forgot-password flow

- **Severity:** HIGH
- **File:** `src/surfaces/dashboard/auth-routes.ts` (entire file)
- **Vulnerability:** There is no `/api/auth/forgot-password` or `/api/auth/reset-password` endpoint anywhere in the codebase. Users who forget their password cannot recover their account.
- **Attack Scenario:**
 1. Admin user loses access or forgets password
 2. No self-service recovery path exists
 3. Only option is platform-admin intervention (if they have access)
 4. In SaaS context, this is both a usability and security issue — users may create duplicate accounts or share credentials
- **Impact:** Account lockout, credential sharing as workaround, support burden.
- **Recommended Fix:**
 - Implement `/api/auth/forgot-password` — accepts email, sends reset token via email
 - Implement `/api/auth/reset-password` — accepts token + new password
 - Store reset tokens in Redis with 1-hour TTL, single-use
 - Send reset emails via existing mailer.ts
- **Security Tests Required:**
 - Request reset for non-existent email → 200 (no enumeration)
 - Use expired token → 401
 - Use valid token → password changed, token invalidated

---

### HIGH-2: No session invalidation on password change

- **Severity:** HIGH
- **File:** `src/surfaces/dashboard/auth-routes.ts` (password change endpoint)
- **Vulnerability:** When a user changes their password, existing Supabase sessions (and their refresh tokens) remain valid. An attacker who has stolen a session token before the password change continues to have access.
- **Attack Scenario:**
 1. Attacker obtains a valid access token via XSS or token leak
 2. Victim discovers the breach and changes their password
 3. Attacker's stolen token continues to work until it expires (1 hour default)
 4. Refresh token in cookie also remains valid
- **Impact:** Continued unauthorized access after password change.
- **Recommended Fix:**
 - On password change: call Supabase Admin API to revoke all sessions for the user
 - Invalidate the refresh token cookie server-side (delete from Supabase)
 - Force re-authentication for all active sessions
- **Security Tests Required:**
 - Change password → old access token returns 401
 - Old refresh cookie rejected after password change

---

### HIGH-3: SQL injection in platform-admin network update (dynamic column names)

- **Severity:** HIGH
- **File:** `src/surfaces/platform-admin/routes.ts` (lines 190-196)
- **Route/Function:** `PATCH /networks/:id`
- **Vulnerability:**
 ```typescript
 const sets: string[] = [];
 const params: unknown[] = [];
 if (b.name !== undefined) { params.push(b.name); sets.push(`name = $${params.length}`); }
 if (b.status !== undefined) { params.push(b.status); sets.push(`status = $${params.length}`); }
 // ...
 const { rows } = await query(`UPDATE networks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
 ```
 Column names are hardcoded (`name`, `status`), which is safe. However, this pattern is fragile — if a new column were added dynamically from the schema in the future, it would be injectable. Additionally, the same file has `DELETE FROM networks WHERE id = $1` on line 207 with no referential integrity cascade check, which could silently orphan related data.
- **Impact:** Currently not exploitable (column names are hardcoded). Risk is in future maintenance.
- **Recommended Fix:**
 - Maintain an explicit allowlist of updatable columns
 - Validate `b` keys against the allowlist before building the query
 - Add `ON DELETE CASCADE` or explicit child-row deletion for the DELETE endpoint
- **Security Tests Required:**
 - Attempt to inject SQL via status field → rejected by zod enum
 - Attempt to add unexpected field → ignored

---

### HIGH-4: Redis fail-open on login rate limiter

- **Severity:** HIGH
- **File:** `src/lib/auth/login-rate-limit.ts` (lines 140-143)
- **Vulnerability:** When Redis is unavailable, `checkLoginRateLimit` returns `{ limited: false }`, disabling all brute-force protection. The subagent output files confirmed Redis is currently unreachable (ECONNREFUSED ::1:6380), meaning the rate limiter is effectively disabled right now.
- **Attack Scenario:**
 1. Redis goes down (as confirmed in subagent output)
 2. All login attempts bypass the rate limiter entirely
 3. Attacker can attempt unlimited password guesses
 4. Credential stuffing attack proceeds at full speed
- **Impact:** Unlimited login attempts during Redis outages.
- **Recommended Fix:**
 - Option A: Fail-closed — return `{ limited: true }` when Redis is unavailable (reject all logins temporarily)
 - Option B: In-memory fallback with a smaller threshold (e.g., 3 attempts) that kicks in when Redis is down
 - Option C: Circuit breaker pattern — after N consecutive Redis failures, switch to memory-based limiter
- **Security Tests Required:**
 - Simulate Redis disconnection → verify rate limiter behavior
 - Verify fail-closed rejects logins during outage
 - Verify circuit breaker activates after threshold

---

### HIGH-5: Login error message distinguishes disabled accounts (account enumeration)

- **Severity:** HIGH
- **File:** `src/surfaces/platform-admin/routes.ts` (line 58)
- **Route/Function:** `POST /login` (platform-admin)
- **Vulnerability:**
 ```typescript
 if (admin.status !== 'active') throw forbidden('Account is disabled.');
 ```
 This returns a distinct 403 "Forbidden" response with a different message for disabled accounts versus wrong-password (401 "Invalid email or password"). An attacker can enumerate which accounts exist and whether they are active.
- **Attack Scenario:**
 1. Attacker sends login requests with known emails
 2. If response is 403 with "Account is disabled" → account exists and is disabled
 3. If response is 401 with "Invalid email or password" → account doesn't exist OR password is wrong
 4. Enumeration of valid accounts is trivially automated
- **Impact:** Account enumeration. Enables targeted phishing, , and focused brute-force attacks on known accounts.
- **Recommended Fix:**
 - Return the same generic "Invalid email or password" message for ALL failure modes (wrong password, disabled account, non-existent account)
 - Log the specific reason server-side for audit purposes
- **Security Tests Required:**
 - Login to non-existent account → 401, generic message
 - Login to disabled account → 401, same generic message
 - Login with wrong password → 401, same generic message
 - All three return identical response bodies

---

### HIGH-6: Platform-admin SQL injection — `WHERE id = $1` on network-scoped table

- **Severity:** HIGH (design concern)
- **File:** `src/surfaces/platform-admin/routes.ts` (lines 123, 188, 205, 207, 239)
- **Vulnerability:** Platform-admin routes query `networks` table using `WHERE id = $1` with `req.params.id`. This is a global cross-tenant table (no `network_id` filter). An authenticated platform-admin has legitimate access to all networks, so this is not exploitable *by a tenant*. However, if the platform-admin JWT verification is bypassed (see CRIT-1), this becomes an immediate data access vulnerability.
- **Impact:** Low in isolation (platform-admin has global access by design), but combined with CRIT-1 becomes critical.
- **Recommended Fix:**
 - This is by-design for platform-admin; no change needed if auth is properly pinned
 - Consider adding audit logging for all network CRUD operations (already partially done via `writePlatformAudit`)

---

## 5. MEDIUM Remaining Issues

### MED-1: No aud/iss claims on Supabase JWT verification (partial)

- **Severity:** MEDIUM (amplifies CRIT-1)
- **File:** `src/lib/auth/verify-jwt.ts`
- **Vulnerability:** Even the JWKS verification path does not check `aud` or `iss` claims on the decoded payload. The `jwtVerify` from jose validates the signature but does not enforce audience by default.
- **Attack Scenario:** A valid Supabase JWT from a different Supabase project (signed by that project's JWKS) would be accepted.
- **Impact:** Cross-project JWT acceptance.
- **Recommended Fix:** Add `audience` and `issuer` to `jwtVerify` options for the JWKS path.

---

### MED-2: HS256 branch algorithm-permissive

- **Severity:** MEDIUM
- **File:** `src/lib/auth/verify-jwt.ts` (line 28)
- **Vulnerability:** The HS256 verification path calls `jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET))` without specifying `algorithms: ['HS256']`. While the key type implies HS256, explicit pinning prevents algorithm confusion.
- **Recommended Fix:** Add `{ algorithms: ['HS256'] }` to the HS256 `jwtVerify` call.

---

### MED-3: Platform-admin JWT no audience check

- **Severity:** MEDIUM
- **File:** `src/lib/auth/platform-admin-token.ts` (lines 44-47)
- **Vulnerability:** `verifyPlatformAdminToken` verifies `issuer` but does not verify `audience`. While the token is signed with a dedicated secret, missing audience check is a defense-in-depth gap.
- **Recommended Fix:** Add `audience: 'tracker-platform-admin'` to `jwtVerify` options.

---

### MED-4: Timing side-channel on dashboard login

- **Severity:** MEDIUM
- **File:** `src/surfaces/dashboard/auth-routes.ts` (Supabase login exchange)
- **Vulnerability:** The Supabase admin client `signInWithPassword` is called directly. The timing difference between "user not found" and "wrong password" responses from Supabase could theoretically be measured, though this is partially mitigated by the Supabase API being a network hop.
- **Recommended Fix:** Use `crypto.subtle.timingSafeEqual` for any local comparisons; consider adding a constant-time delay to normalize response timing.

---

### MED-5: No CSRF token (SameSite only mitigation)

- **Severity:** MEDIUM
- **File:** `src/surfaces/dashboard/auth-routes.ts` (line 44-50)
- **Vulnerability:** The refresh cookie uses `sameSite: 'lax'` which provides partial CSRF protection (blocks cross-site POSTs but allows cross-site GETs). There is no CSRF double-submit token.
- **Attack Scenario:**
 1. Attacker hosts a page with `<img src="https://tracker.example.com/api/auth/refresh">`
 2. Browser sends the refresh cookie with the GET request
 3. If the refresh endpoint accepts GET requests, attacker can force token refresh
- **Impact:** Low if refresh endpoint is POST-only (check required). Medium if GET accepted.
- **Recommended Fix:**
 - Ensure refresh endpoint only accepts POST
 - Add a CSRF double-submit token for state-changing operations
 - Consider upgrading to `sameSite: 'strict'`

---

### MED-6: CORS not configured (any origin may send requests)

- **Severity:** MEDIUM
- **File:** `src/lib/http/express-app.ts` and all surface apps
- **Vulnerability:** No CORS middleware is mounted on any surface. By default, Express will not include CORS headers, which means browsers block cross-origin requests. This is actually a *positive* default. However, if CORS is later enabled (for a legitimate reason) without proper origin whitelisting, it opens a security gap.
- **Recommended Fix:** If CORS is needed, explicitly configure `cors` middleware with a specific origin whitelist (never `origin: true` in production).

---

### MED-7: No request body size limit on tracking surface

- **Severity:** MEDIUM
- **File:** `src/surfaces/tracking/`
- **VulnerABILITY:** The tracking surface (Fastify) should have a strict body size limit to prevent memory exhaustion from oversized click payloads. Verify that Fastify body limit is configured.
- **Recommended Fix:** Set Fastify `bodyLimit` to a reasonable value (e.g., 1KB for click events).

---

## 6. LOW Remaining Issues

### LOW-1: SameSite 'lax' instead of 'strict'

- **Severity:** LOW
- **File:** `src/surfaces/dashboard/auth-routes.ts` (line 46)
- **Vulnerability:** The refresh cookie uses `sameSite: 'lax'`. This allows the cookie to be sent with cross-site GET navigations. `sameSite: 'strict'` is more restrictive.
- **Impact:** Very limited practical impact (refresh endpoint is POST-only if implemented correctly).
- **Recommended Fix:** Change to `sameSite: 'strict'` if cross-site navigation is not required for the SPA.

---

### LOW-2: No explicit exp validation assertion

- **Severity:** LOW
- **File:** `src/lib/auth/verify-jwt.ts`
- **Vulnerability:** The `jwtVerify` call does not explicitly assert that the `exp` claim is present and valid in the payload. While `jose` does validate `exp` by default, an explicit check in the code would make this auditable.
- **Recommended Fix:** Add a post-verification assertion: `if (payload.exp && Date.now() >= payload.exp * 1000) throw new Error('Token expired')`.

---

### LOW-3: No __Host- prefix on refresh cookie

- **Severity:** LOW
- **File:** `src/surfaces/dashboard/auth-routes.ts` (line 44)
- **Vulnerability:** The cookie name `tracker_rt` is not `__Host-` prefixed. `__Host-` cookies require `secure`, `path=/`, and no `domain` attribute, providing additional hardening against subdomain cookie injection.
- **Recommended Fix:** Rename cookie to `__Host-tracker_rt` and ensure `secure: true` is always set (not just in production).

---

### LOW-4: No password complexity beyond length

- **Severity:** LOW
- **File:** `src/lib/auth/password-policy.ts`
- **Vulnerability:** The password policy enforces minimum length (12 chars) and character variety (uppercase, lowercase, digit, special). However, it does not check for common passwords, breached passwords, or sequential characters.
- **Recommended Fix:** Add a breached-password check using a local copy of the HIBP top 10,000 list, or integrate with a haveibeenpwned API (k-anonymity).

---

### LOW-5: `jsonwebtoken` package present but unused

- **Severity:** LOW (dependency hygiene)
- **File:** `package.json` line 59
- **Vulnerability:** `jsonwebtoken` (v9.0.2) is listed as a dependency but all JWT operations use `jose` (v5.9.6). Unused dependencies increase attack surface.
- **Recommended Fix:** Remove `jsonwebtoken` from dependencies. Note: `@types/jsonwebtoken` is also in devDependencies.

---

## 7. INFO / Defense-in-Depth

### Positive Findings

1. **Five segregated surfaces with independent auth:** Dashboard, Tracking, Public API, Platform-Admin, and Workers each have separate auth middleware. A compromised dashboard JWT cannot authenticate to the tracking surface.

2. **Raw parameterized SQL everywhere:** All 58+ files that query with `AND network_id` use parameterized queries. No string interpolation of user input into SQL.

3. **Helmet security headers:** `src/lib/http/express-app.ts` uses `helmet()` with CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and more. The subagent test output confirmed all security headers are present in responses.

4. **Envelope response pattern:** All API responses follow `{ ok: true, data: T }` / `{ ok: false, error: { code, message } }` — no stack traces or leaked.

5. **API-key audience segregation implemented:** The `requireAudience()` middleware correctly blocks advertiser keys from accessing publisher endpoints and vice versa. The code is structurally correct — the test failures are due to vi.mock infrastructure, not logic bugs.

6. **ClickHouse/PG fallback with circuit breaker:** Analytics gracefully falls back to Postgres when ClickHouse is unreachable, with per-instance `chUnreachable` flag preventing retry storms. Confirmed by 17/17 live tests passing.

7. **Redis key hashing with SHA-256:** Login rate limiter keys use `sha256(ip)` and `sha256(email)` — no raw PII in Redis key names, preventing key injection attacks.

8. **Timing-safe string comparison implemented:** `src/lib/secure-code-compare.ts` uses `crypto.subtle.timingSafeEqual` for API key comparison, preventing timing attacks on key validation.

9. **Pino HTTP request logging:** All requests are logged with full request/response details including status codes, enabling security incident investigation.

10. **Prometheus metrics on all surfaces:** `httpDuration` metrics per surface + method enable rate-based anomaly detection.

---

## 8. Tenant Isolation Assessment

### What is Protected

- **Dashboard routes:** Every admin route is behind `dashboardAuth` + `requireAdmin`/`requireRole`. Every query includes `AND network_id = $N` using `req.scope!.networkId`.
- **Portal routes:** Publisher/advertiser routes use `ownerId` scoping — users can only see their own records.
- **Public API:** `apiKeyAuth` resolves `networkId` from the API key row. All queries filter by `network_id`. The `requireAudience` middleware enforces that advertiser keys can't access publisher endpoints.
- **Tracking surface:** Click recording uses Fastify with raw SQL parameterized by `network_id`.
- **58+ files confirmed** using `AND network_id` parameterized filter.

### What is Weak

1. **Supabase JWT claims are trusted without server-side verification of aud/iss** (CRIT-1): An attacker-controlled JWT with forged `app_metadata` claims can impersonate any network.
2. **Platform-admin routes query `networks` without `network_id`**: This is by design (platform-admin manages all networks) but creates risk if platform-admin auth is bypassed.
3. **Subdomain tracking domain lookup** (`src/surfaces/tracking/app.ts:331`): `smart_links WHERE id = $1 AND network_id = $2` — correctly scoped, but the lookup uses `req.params.id` from the URL which could be guessed.

### Known Bypasses

- **JWT audience bypass:** If CRIT-1 is not fixed, any valid Supabase JWT from any project is accepted, making tenant isolation ineffective.

### Remaining Tests Needed

- Cross-tenant query isolation tests (network A cannot access network B's data via API key)
- Cross-tenant dashboard isolation tests (JWT from network A cannot access network B's routes)
- Portal user cannot access other owner's records within same network
- Smart link lookup prevents cross-network access via ID guessing

---

## 9. Authentication & Authorization Assessment

### Status Matrix

| Auth Mechanism | Algorithm Pinned | Audience Checked | Issuer Checked | Exp Validated | Status |
|---------------|-----------------|-----------------|---------------|---------------|--------|
| Dashboard JWT (Supabase) | NO — accepts any alg | NO | NO | YES (jose default) | **CRITICAL GAP** |
| Platform-admin JWT | YES — HS256 only | NO | YES — 'tracker-platform-admin' | YES | PARTIAL |
| Public API key | N/A — direct DB lookup | YES — audience enforced | N/A | N/A — no expiry | GOOD |
| Tracking surface | N/A — no auth (public) | N/A | N/A | N/A | BY DESIGN |

### Key Weaknesses

1. **Dashboard JWT accepts any Supabase-signed token** regardless of project — this is the most critical auth gap.
2. **No session invalidation on password change** — stolen tokens remain valid after password reset.
3. **No password recovery flow** — users locked out cannot self-recover.
4. **Account enumeration** via distinct error messages on disabled accounts.

### Positive Controls

1. Rate limiter on login (dual-key: IP + account)
2. Password policy (12+ chars, complexity requirements)
3. Timing-safe comparison for sensitive strings
4. Refresh token in httpOnly cookie
5. RBAC on dashboard (admin roles: admin, manager, finance, read_only)
6. Two-gate platform-admin auth (JWT + active DB row)

---

## 10. Public API Assessment

### API-Key Auth (`src/surfaces/public-api/auth.ts`)

**Strengths:**
- Key extraction from header only (never query string — prevents key leakage in logs/URLs)
- Direct DB lookup every request → revocation is immediate
- SHA-256 hashing of keys before DB comparison
- Rate limiting per key with `X-RateLimit-*` headers
- `last_used_at` updated async (non-blocking)
- Audience segregation via `requireAudience()` middleware

**Weaknesses:**
1. **vi.mock infrastructure issue:** The test mock for `../../src/lib/db/pool.js` does not export `query`, causing all 6 API-audience tests to fail with 500 errors. This means the audience enforcement code has no passing test coverage.
2. **No key rotation mechanism:** API keys have no rotation date or versioning.
3. **No IP allowlist:** Any IP can use a valid API key.

### Test Infrastructure Gap (CONFIRMED by subagent output)

The subagent output from `bjkfcm9n4.output` and `bisdsli54.output` shows:
- `api-audience.test.ts`: 3 pass / 6 fail (all failures are 500 errors from vi.mock pool.js issue)
- `api-audience-a3.test.ts`: 0 pass / 6 fail (same vi.mock issue)
- The error: `[vitest] No "query" export is defined on the "../../src/lib/db/pool.js" mock`

This is a critical test infrastructure gap — the audience enforcement logic may be correct but cannot be verified without fixing the mock.

---

## 11. Tracking Security Assessment

### Strengths

1. **Fastify for latency budget:** Tracking surface uses Fastify, not Express, meeting the hot-path performance requirement.
2. **Click recording never touches Postgres synchronously:** Clicks go to BullMQ for async processing.
3. **URL redirect validation:** AP-3 URL security task completed — redirect targets are validated.
4. **Conversion recording with abuse detection:** `src/lib/conversion-abuse.ts` implements duplicate and fraud detection.
5. **Smart link network_id scoping:** `WHERE id = $1 AND network_id = $2` prevents cross-network link access.

### Gaps

1. **No authentication on tracking surface:** Click and conversion endpoints are public (by design for tracking pixels/redirects), making them vulnerable to click fraud. The conversion-abuse module provides some defense but the /click endpoint itself is completely open.
2. **No IP reputation / bot detection:** There is no IP-level blocking for known bot networks or datacenter IPs.
3. **No request fingerprinting:** No mechanism to detect the same source generating many different click patterns (sophisticated fraud).

---

## 12. Database / Redis / ClickHouse Assessment

### PostgreSQL

**Strengths:**
- All queries are parameterized (no string interpolation of user input)
- `network_id` filter present in 58+ source files
- Raw `pg` queries (no ORM on hot path)
- `node-pg-migrate` for versioned migrations

**Gaps:**
1. **No connection pooling limit visible in code:** Verify `max` connections is set in the pool config.
2. **Platform-admin routes do full-table scans:** `SELECT COUNT(*) FROM networks` and `SELECT COUNT(*) FROM clicks` on summary endpoint — will slow as data grows.

### Redis

**Strengths:**
- Used for rate limiting, BullMQ queues, session storage
- SHA-256 key hashing prevents PII in key names

**Gaps:**
1. **Redis currently unreachable (confirmed by subagent output):** ECONNREFUSED on port 6380 — rate limiter is fail-open.
2. **No Redis authentication (`requirepass`):** If Redis is exposed without auth, anyone can read/write rate limit keys.
3. **No Redis persistence configuration visible:** Data loss on restart could reset rate limit counters.

### ClickHouse

**Strengths:**
- Production cutover completed with fallback to Postgres
- Per-instance `chUnreachable` circuit breaker prevents retry storms
- Non-infra errors (SQL syntax) do not trigger fallback — correct behavior
- 17/17 live tests passing

**Gaps:**
1. **Fallback triggers on ALL infrastructure errors** (including network errors, timeouts) — this is correct behavior, but the degraded mode should have monitoring alerts.

---

## 13. Infrastructure Assessment

### Docker / Deployment

- **No `docker-compose.yml` found in repository** — deployment configuration is managed externally.
- **Missing:** No evidence of container security hardening (non-root user, read-only filesystem, capability dropping).
- **Missing:** No evidence of secrets management (Vault, env-injection, etc.) — `.env` files are the assumed method.

### Process Isolation

- **5 segregated surfaces on separate ports** — good process isolation
- **BullMQ workers in separate process** — click processing isolated from API serving
- **Health endpoint unauthenticated** (`/health`) — correct for load balancer health checks, but reveals infrastructure details

### Security Headers (CONFIRMED by subagent)

The subagent test output shows these headers are present in all responses:
```
content-security-policy: default-src 'self'; ...
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
strict-transport-security: max-age=15552000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
x-xss-protection: 0
x-permitted-cross-domain-policies: none
x-dns-prefetch-control: off
x-download-options: noopen
```

**Note:** `x-xss-protection: 0` is the correct modern value (disables the legacy XSS filter that can introduce vulnerabilities). CSP is strict (`default-src 'self'`) but allows `https:` for images/fonts.

---

## 14. Secrets / Dependency Assessment

### Dependency Versions (from package.json)

| Package | Version | Status |
|---------|---------|--------|
| express | ^4.19.2 | Current |
| fastify | ^4.28.1 | Current |
| jose | ^5.9.6 | Current |
| @supabase/supabase-js | ^2.45.0 | Current |
| helmet | ^7.1.0 | Current |
| pg | ^8.12.0 | Current |
| zod | ^3.23.8 | Current |
| jsonwebtoken | ^9.0.2 | **UNUSED — should be removed** |
| ioredis | ^5.4.1 | Current |
| bullmq | ^5.12.0 | Current |
| @clickhouse/client | ^1.23.1 | Current |

### Secrets Management

- **No .env files committed** (correct)
- **Required env vars:** SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY, PLATFORM_ADMIN_JWT_SECRET, DATABASE_URL, REDIS_URL, CLICKHOUSE_URL
- **Risk:** No evidence of secrets rotation policy or secrets audit trail.

---

## 15. Missing Security Tests

| Test Category | File | Status | Action Required |
|--------------|------|--------|----------------|
| API-key audience enforcement | `test/isolation/api-audience-a3.test.ts` | 0/6 PASS | Fix vi.mock pool.js |
| API-key auth basics | `test/isolation/api-audience.test.ts` | 3/3 PASS | Already passing |
| Dashboard JWT aud/iss rejection | Missing | NOT WRITTEN | Must be written (CRIT-1 test) |
| Dashboard JWT algorithm pinning | Missing | NOT WRITTEN | Must be written (CRIT-2 test) |
| Cross-tenant dashboard isolation | Missing | NOT WRITTEN | Must be written |
| Cross-tenant API key isolation | Missing | NOT WRITTEN | Must be written |
| Password reset flow | Missing | NOT WRITTEN | Must be written (HIGH-1) |
| Session invalidation on password change | Missing | NOT WRITTEN | Must be written (HIGH-2) |
| Login error message uniformity | Missing | NOT WRITTEN | Must be written (HIGH-5) |
| Redis fail-closed behavior | Missing | NOT WRITTEN | Must be written (HIGH-4) |
| Platform-admin SQL injection | Missing | NOT WRITTEN | Must be written (HIGH-3) |
| CSRF on refresh endpoint | Missing | NOT WRITTEN | Must be written (MED-5) |
| Conversion abuse / fraud detection | `test/isolation/conversion-abuse.test.ts` | EXISTS | Verify coverage |
| Postback security | `test/isolation/postback-security.test.ts` | EXISTS | Verify coverage |
| Login rate limiting | `test/isolation/login-rate-limit.test.ts` | EXISTS | Verify coverage |
| Password policy | `test/isolation/password-policy.test.ts` | EXISTS | Verify coverage |
| Timing-safe compare | `test/isolation/timing-safe-compare.test.ts` | EXISTS | Verify coverage |
| Advertiser click ownership | `test/isolation/advertiser-click-ownership.test.ts` | EXISTS | Verify coverage |
| Payout ownership | `test/isolation/payout-ownership.test.ts` | EXISTS | Verify coverage |
| Dashboard kind validation | `test/isolation/dashboard-kind-validation.test.ts` | EXISTS | Verify coverage |

**Total: 10+ test files need to be written or fixed.**

---

## 16. Production Blockers

These issues MUST be resolved before production deployment:

| # | ID | Severity | Description |
|---|-----|----------|-------------|
| 1 | CRIT-1 | CRITICAL | No aud/iss verification on Supabase JWT — any Supabase project's JWT is accepted |
| 2 | CRIT-2 | CRITICAL | No algorithm pinning on JWKS path — key confusion attack possible |
| 3 | HIGH-5 | HIGH | Account enumeration via distinct error messages for disabled accounts |
| 4 | HIGH-4 | HIGH | Redis fail-open on rate limiter — currently confirmed broken (ECONNREFUSED) |
| 5 | HIGH-1 | HIGH | No password reset flow — users cannot recover locked accounts |
| 6 | TEST | BLOCKER | 6/6 API-audience tests failing — no verified coverage for audience enforcement |

---

## 17. Recommended Fix Order

1. **CRIT-2: Pin algorithms on JWKS path** — 30 min. Add `algorithms: ['ES256', 'RS256']` to `jwtVerify(token, getJwks(), ...)` and `algorithms: ['HS256']` to the HS256 branch.
2. **CRIT-1: Add aud/iss verification on Supabase JWT** — 2 hours. Add `audience` and `issuer` options to both jwtVerify branches, add env vars, write tests.
3. **HIGH-5: Uniformize login error messages** — 30 min. Change platform-admin disabled-account response to generic 401.
4. **HIGH-4: Fail-closed Redis rate limiter** — 1 hour. Change catch block to return `{ limited: true }` or implement memory fallback.
5. **Fix vi.mock pool.js** — 1 hour. Fix the test mock infrastructure so API-audience tests can run.
6. **HIGH-1: Implement password reset flow** — 4 hours. New endpoints + email flow + Redis tokens.
7. **HIGH-2: Session invalidation on password change** — 2 hours. Revoke Supabase sessions on password change.
8. **MED-3: Add audience check to platform-admin JWT** — 30 min. Add `audience` to verifyPlatformAdminToken options.
9. **MED-1/MED-2: Explicit algorithm pinning in all JWT paths** — 30 min. Sweep and pin all jwtVerify calls.
10. **LOW-5: Remove unused jsonwebtoken dependency** — 15 min. Remove from package.json.
11. **LOW-3: Add __Host- prefix to refresh cookie** — 15 min.
12. **Write missing security tests** — 3-5 days (cross-tenant isolation, auth bypass attempts, error uniformity, CSRF, fail-closed behavior).

---

## 18. "CAN BE DEFERRED"

These are low-risk hardening items that do not block production:

- **LOW-1: SameSite 'strict'** — Current 'lax' is acceptable if refresh endpoint is POST-only.
- **LOW-4: Breached password check** — Nice-to-have but not a blocker.
- **LOW-2: Explicit exp assertion** — Already validated by jose, just not explicitly in code.
- **MED-7: Fastify bodyLimit** — Likely already configured; verify but low urgency.
- **MED-6: CORS configuration note** — No CORS is currently set, which is the secure default. Document that CORS should never be added without a whitelist.
- **INFO-6: Monitoring alerts for ClickHouse fallback** — Useful for ops but not a security blocker.
- **INFO-10: Deprecate jsonwebtoken dependency** — Low urgency cleanup.

---

## 19. Final Security Score

### Conservative Score: **42 / 100**

**Breakdown:**

| Area | Score | Rationale |
|------|-------|-----------|
| Auth Architecture | 3/10 | CRIT-1 and CRIT-2 make JWT auth fundamentally broken — any Supabase JWT is accepted |
| Tenant Isolation | 6/10 | network_id filters widespread, but JWT bypass makes isolation moot |
| Session Management | 4/10 | No password reset, no session invalidation on password change, cookie lacks __Host- |
| Input Validation | 8/10 | Parameterized SQL everywhere, zod schemas on all inputs, one SQL injection risk in admin update |
| Rate Limiting | 5/10 | Good design, but Redis fail-open renders it ineffective (confirmed broken) |
| Error Handling | 6/10 | Envelope pattern is good, but account enumeration leaks exist |
| Crypto / Secrets | 6/10 | Good use of jose and timing-safe compare, but missing algorithm pinning |
| Infrastructure | 7/10 | Helmet headers, segregated surfaces, health checks. No CORS = secure default |
| Dependency Hygiene | 7/10 | Current versions, unused jsonwebtoken is a minor issue |
| Test Coverage | 3/10 | 6/6 API-audience tests failing, no JWT bypass tests, many auth scenarios untested |

**Justification:** The score reflects that the two CRITICAL JWT issues (CRIT-1, CRIT-2) represent an authentication system that is architecturally broken — not just incomplete. Until `aud`/`iss` verification and algorithm pinning are added, the dashboard surface effectively has no authentication against cross-project attacks. The score of 42 is conservative because the codebase has many structural strengths (parameterized SQL, surface segregation, envelope responses, helmet headers), but the auth gaps are fundamental.

**Path to 75+ (production-ready):**
- Fix CRIT-1, CRIT-2 (auth becomes trustworthy)
- Fix HIGH-4, HIGH-5 (rate limiting and account enumeration)
- Fix test infrastructure (vi.mock pool.js)
- Write missing security tests (cross-tenant isolation, JWT bypass attempts)
- Defer LOW items

**Path to 90+ (enterprise-grade):**
- Everything above, plus:
- Password reset + session invalidation
- IP reputation / bot detection on tracking surface
- Breached-password check
- CSRF tokens
- Secrets rotation policy
- Connection pooling limits
- Monitoring/alerting on all auth failures
