# Authentication & Security

## Authentication Methods

### 1. Supabase JWT (Dashboard + Portals)
- **Issuer**: Supabase Auth (server-side via `supabase.auth.signInWithPassword`)
- **Verification**: `jose` library — ES256 via JWKS endpoint
- **Fallback**: HS256 via `SUPABASE_JWT_SECRET` (test tokens only)
- **Token storage**:
 - Access token: `localStorage` (`tracker.session.v2`)
 - Refresh token: httpOnly cookie `tracker_rt` (sameSite: 'lax', path: `/api/auth`, 30 days)
- **Custom claims**: Stored in Supabase `app_metadata`:
 - `network_id` — tenant ID
 - `kind` — `admin` / `publisher` / `advertiser`
 - `role` — `admin` / `manager` / `finance` / `read_only` (admin users). For a team member with a `users` row, that row is what's enforced: `dashboardAuth` reads its `role` + `status` per request (`lib/auth/staff-state.ts`, cached 15 s), so a role change applies on their next request and `status = disabled` is refused (403) even with a valid token. Edits (`PATCH /api/control-center/users/:id`) also update the login (role claim; a ban while disabled) when Supabase Auth is configured
 - `owner_id` — Party ID (publisher/advertiser portals)
- **JWKS endpoint**: `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`

### 2. Platform Admin JWT (Super Admin)
- Separate secret: `PLATFORM_ADMIN_JWT_SECRET`
- Completely isolated from tenant auth (non-negotiable #10, #12)
- Cannot authenticate any other surface
- SPA sign-in: Login page › "Sign in as Super Admin" → `authClient.loginPlatform()` → `POST /platform/login` → session `role: 'super_admin'` with the platform token (1 h, `expiresAt` from its `exp`). Account: `npm run bootstrap:admin -- <email> <password>`
- No refresh cookie: the api client never sends a Super Admin session to `/api/auth/refresh`; a 401 from `/platform/*` clears the session and returns to `/login`, a 401 from a tenant `/api/*` endpoint just fails that call

### 2b. Impersonation session (admin → portal account)
- `POST /api/{publishers|advertisers}/:id/impersonate` (admin) mints a 30-min HS256 token, issuer `tracker-impersonation`, signed with `IMPERSONATION_JWT_SECRET` (optional; 503 when unset) — never the account's own credentials
- `dashboardAuth` routes it by issuer to its own verifier → portal identity of that account + `impersonatedBy`; it can't authenticate admin routes or other surfaces
- Writes are audited to the admin (`audit_log.impersonated_by`); password/email/anonymize/API-key changes are refused; `/api/me` exposes `impersonating` for the SPA banner
- SPA: the token opens in a new tab as that tab's own session (`sessionStorage`, `tracker.impersonation.v1`) — the admin's localStorage login and refresh cookie are never replaced, refreshed or revoked from it; the token is passed in the URL fragment (never sent to a server) and wiped from the address bar; a 401 ends the session

### 3. API Key (Public REST API)
- Format: `<audience>_<env>_<publicId>_<secret>`
 - e.g., `pub_live_a1b2c3d4_<32-char-base64url>`
- Audience prefix: `adv_` / `pub_` / `net_`
- Stored as **SHA256 hash** only — full key returned exactly once
- Verified server-side per-request
- Scoped by audience ceiling (narrow-only, cannot exceed)

### 4. Tracking
- Click: **No auth** (public redirect)
- Tenant resolved from `Host` header → tracking domain
- S2S postback: `secure_code` **required** (network code, or the offer's own code) — fails closed
- Pixel / iframe: no secret (browser-fired); bound to the offer's own site via Referer/Origin and priced at defaults

## Login Flow
```
Browser → POST /api/auth/login { email, password }
Backend → supabase.auth.signInWithPassword()
Supabase Auth → Validates + issues JWT
Backend → Sets httpOnly cookie + returns JSON
SPA → Saves access_token to localStorage
SPA → Router redirects to ROLE_HOME[role]
```

## Token Refresh Flow
```
SPA → 401 on API call
SPA → POST /api/auth/refresh (httpOnly cookie sent automatically)
Backend → supabase.auth.refreshSession()
Backend → Rotates refresh cookie, returns new access token
SPA → Updates localStorage, retries original request
```

## Registration Flow
Portal logins (partners/advertisers) are provisioned in-product — see API_REFERENCE.md "Portal logins":
- Admin/manager **invite** (`POST /api/{publishers|advertisers}/:id/invite`, also automatic on create when a contact email is given): a Supabase user with the portal claims and a temporary password, emailed via the network SMTP. Idempotent by email; never takes over a login whose claims belong to another account, another network or network staff.
- Partner **self-serve sign-up** (`POST /api/signup/partner`, unauthenticated, per-IP limited in production): creates a `pending` partner + login. The applicant never chooses the password — it's emailed — so signing up with someone else's address gets the attacker nothing.
- The SPA has no magic-link callback, so invites use temporary passwords (changed via `PATCH /api/me/password`). Outside production, when the email can't be sent, the response returns the credentials for dev.

Network staff and demo data are still script-based:
- `provision:demo-admin` — Creates demo network admin
- `provision:demo-portals` — Creates demo publisher/advertiser portals

## Authorization

### Roles
| Role | Surface | Access |
|---|---|---|
| `super_admin` | `/admin/*` | Full platform access |
| `admin` | `/app/*` | Network admin (full CRUD) |
| `manager` | `/app/*` | Limited admin |
| `finance` | `/app/*` | Finance views only |
| `read_only` | `/app/*` | Read-only access |
| `publisher` | `/publisher/*` | Publisher portal (own data) |
| `advertiser` | `/advertiser/*` | Advertiser portal (own data) |

### Middleware Chain
```
dashboardAuth (JWT → req.identity + req.scope; the claim's network must exist (else 401) and be
 active (suspended / soft-deleted → 403, F-26 — lib/networks/state.ts, 'active' cached 15 s))
 → requireAdmin (dashboard kind === 'admin')
 → requireRole('admin', 'manager', 'finance', 'read_only') (RBAC)
 → Handler
```

### Portal Authorization
```
dashboardAuth
 → requirePortal('publisher' | 'advertiser')
 → req.scope.ownerId (further restricts to own data)
 → Handler (queries filtered by owner_id)
```

## Security Features

### XSS Protection
- Refresh token in **httpOnly** cookie (JS cannot read it)
- Access token in `localStorage` (mitigated by httpOnly refresh)
- Session key versioned (`tracker.session.v2`) — stale sessions dropped on rename

### CSRF Protection
- SameSite cookies (`lax`)
- Bearer token in Authorization header for sensitive requests

### CORS
- Vite dev proxy handles same-origin locally
- Production: frontend served from same origin as dashboard

### Input Validation
- `zod` schemas on all request bodies
- Email format validation
- Password length constraints (min 8, max 200)
- URL format validation
- Query param sanitization

### Rate Limiting
- API key rate limiting: `lib/apikeys/rate-limit.ts`
- Token bucket per API key

### Secure Code (Postbacks)
- Every network has a `postback_security_code`: generated at creation (platform-admin), backfilled and defaulted by migration `1700000067000` (SQL `tracker_generate_secure_code()`, the twin of `lib/security-code.ts`)
- An offer's own `security_code` overrides the network code
- Verified (timing-safe) in `conversions/record.ts`; **fails closed** — no configured code means the postback is rejected, not accepted
- Rides on the Redis-cached offer config; Settings › Security regenerate/clear and the offer security-code endpoints invalidate it

### Settings Secrets (integration credentials, SMTP password)
- Every integration setting whose name ends in key/token/secret/password (IPQS, FB access token, offer-feed key, Pin API key, the catalog API keys, ...) and the SMTP password are **encrypted at rest** (AES-256-GCM, `lib/crypto/secret-box.ts`, `SETTINGS_ENC_KEY`) and **never returned to the browser**: `GET /api/settings` shows `<key>Set` / `passwordSet` booleans to every role
- Decrypted only where used (`secretValue()` in IPQS, Facebook CAPI, offer-feed sync; the mailer). Legacy plaintext still reads; `npm run settings:secrets -- encrypt` converts it (`decrypt` undoes)
- The network postback secure code (`GET /api/settings/security`) is shown to admin/manager only

### Host Header Validation
- Tracking surface: tenant resolved from `Host` header
- `resolveHostToNetwork(host)` validates against configured tracking domains

## Security-Sensitive Areas
- All API keys are SHA256 hashed — never stored in plaintext
- Backend-only secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `PLATFORM_ADMIN_JWT_SECRET`, `ANTHROPIC_API_KEY`
- Frontend CI scans for forbidden secret patterns (spec §3A)
- Login events logged (IP, user agent, device) in `login_events` table
- GDPR anonymize endpoint (`/me/anonymize`)

## Environment Secrets
| Variable | Where Used | Exposure Risk |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Backend only (admin operations) | **Never** in frontend |
| `SUPABASE_JWT_SECRET` | Backend only (HS256 verification) | **Never** in frontend |
| `PLATFORM_ADMIN_JWT_SECRET` | Platform admin only | **Never** in frontend |
| `SETTINGS_ENC_KEY` | Backend only (settings secrets at rest) | **Never** in frontend; losing it makes stored secrets unreadable |
| `ANTHROPIC_API_KEY` | AI ops layer | **Never** in frontend |
| `DATABASE_URL` | Backend only | **Never** in frontend |
| `REDIS_URL` | Backend only | **Never** in frontend |
