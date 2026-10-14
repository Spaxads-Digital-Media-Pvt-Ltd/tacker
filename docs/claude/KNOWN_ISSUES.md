# Known Issues

## Confirmed Issues

### 1. Two Brand Name Sources of Truth
**Location**: `frontend/src/config/branding.ts` + `api-backend/src/config/branding.ts`
**Severity**: Low (cosmetic/maintenance)
**Issue**: The brand name "Tracker" exists in both repos. The spec says there's a single source, but in practice it's duplicated across two independently deployable repos. Renaming requires two edits.
**Why it matters**: A rename only finds one of the two files → inconsistent branding.
**Suggested fix**: Accept the duplication (two independently deployable repos). The spec's "single source" refers to within-each-repo.

### 2. LocalStorage Session Key Version Bump Friction
**Location**: `frontend/src/auth/session.ts:28`
**Severity**: Low
**Issue**: The session key is versioned (`tracker.session.v2`). When the format changes, all users get logged out. This is by design but could be surprising.
**Why it matters**: Silent logout on frontend changes.

### 3. No Tests in Frontend
**Location**: `frontend/`
**Severity**: Medium
**Issue**: No test directory, no test framework configured for the frontend. CI runs typecheck + lint + build only.
**Why it matters**: UI regressions go undetected. Complex report logic has no test coverage.

### 4. Money Stored as Text (String)
**Location**: All tables with monetary columns
**Severity**: Low (by design)
**Issue**: `default_payout`, `default_revenue`, and ledger amounts are stored as `text`, never as numeric/float. This is intentional (avoid floating-point precision errors) but requires careful handling everywhere.
**Why it matters**: Any code that accidentally treats these as numbers loses precision.

### 5. Shadow Supabase Role Claim
**Location**: `api-backend/src/surfaces/dashboard/auth.ts:42-44`
**Severity**: Low
**Issue**: Supabase sets `role: "authenticated"` at the top level of JWTs, which would shadow the admin role. The code explicitly falls back from `app_metadata.role` to top-level `role` for test tokens.
**Why it matters**: If Supabase changes how it sets claims, the role resolution could break silently.

## Potential Issues (Need Investigation)

### 6. Smart Link PG Read on Hot Path
**Location**: `api-backend/src/surfaces/tracking/app.ts:241-251`
**Severity**: Low
**Issue**: The `/sl` smart link resolver reads from Postgres synchronously (for `smart_links` + `smart_link_items`). The spec says the click path never touches Postgres synchronously. This is a documented departure.
**Why it matters**: Lower volume than `/click`, but under high smart-link traffic, this could be a latency issue.

### 7. Tracking Surface Trust Proxy
**Location**: `api-backend/src/surfaces/tracking/trusted-proxy.ts` (used by `trustProxy` and the production direct-connection guard in `tracking/app.ts`)
**Severity**: Info (fixed) / deployment assumption
**Status**: Fixed. `trustProxy: true` (took the client-writable LEFTMOST `X-Forwarded-For` entry as the click IP) became a trust check that walks the chain from the right and stops at the first untrusted hop; the hand-made Cloudflare list (bogus ranges such as `173.0.0.0/8`, `141.0.0.0/9`, TEST-NET-2, no IPv6) was replaced by Cloudflare's published IPv4 + IPv6 ranges (tests: `test/isolation/trusted-proxy.test.ts`, `test/integration/click-capture.test.ts`).
**Docs**: `api-backend/docs/cloudflare-edge.md` › "Client IP at the origin" describes the real behaviour (X-Forwarded-For only — `CF-Connecting-IP` is not read) and the Nginx setups that work. **Remaining**: (1) Cloudflare's ranges are pinned in code — re-check https://www.cloudflare.com/ips-v4/ and /ips-v6/ when they change. (2) The repo has no Nginx config, so the topology is assumed: Nginx on the same host (loopback) appending to `X-Forwarded-For` (`proxy_add_x_forwarded_for`). If Nginx/a load balancer runs on another host, add its address to `TRACKING_TRUSTED_PROXIES`, or every click IP will be that proxy (and the production guard will reject it). If Nginx overwrites `X-Forwarded-For` with `$remote_addr`, the click IP becomes the Cloudflare edge. (3) Loopback is trusted, so in local dev a client on loopback can set `X-Forwarded-For`.
**Why it matters**: IP-based geo lookups, fraud checks and IP filters depend on `req.ip`.

### 8. Redis Cache Staleness
**Location**: `api-backend/src/surfaces/tracking/offer-cache.ts`
**Severity**: Low (verified)
**Status**: Offer PATCH/DELETE, geo rules, goals, access rows (grant/PATCH/delete, applications, portal requests), per-offer and network secure codes, traffic controls/blocking and copy-settings all invalidate the cached offer config; tracking-domain delete invalidates the host cache. Any NEW write path that changes an input of `loadFromDb()` must call `invalidateOfferConfig` (or `invalidateNetworkOfferConfigs` for network-wide inputs).

### 9. No Input Sanitization on Search
**Location**: Frontend report filters
**Severity**: Low
**Issue**: The frontend sends user-selected filter values directly to backend API endpoints. If the backend doesn't sanitize all inputs, this could be a vector.
**Why it matters**: The backend uses zod validation, but worth verifying all report endpoints validate `groupBy` parameters.

### 10. Migration Reversibility
**Severity**: Low
**Issue**: Migrations are written as SQL (not TypeScript), and `node-pg-migrate` supports `down` but only for basic operations. Complex migrations may not be reversible.
**Why it matters**: `npm run migrate:down` may not fully revert complex schema changes.

### 11. Frontend Never Directly Reads Error Responses
**Location**: `frontend/src/lib/api.ts:52-55`
**Severity**: Low
**Issue**: The API client tries `res.json()` with a catch-all, then checks `body.ok`. If the server returns non-JSON (e.g., 500 plain text), the error handling may not surface the right message.
**Why it matters**: Users see "Unknown error" instead of useful error messages.

### 12. BullMQ Queue Connection Leak Risk
**Location**: `api-backend/src/lib/redis.ts:23-29`
**Severity**: Low
**Issue**: `makeQueueConnection()` creates a new Redis connection each time it's called. If called frequently without closing, this could exhaust Redis connections.
**Why it matters**: Queue worker startup should use this, but repeated calls in request handlers could leak connections.

## Technical Debt

### 13. Phase 0 Scaffold Active
The entire application is based on the Phase 0 scaffold specification. Some infrastructure is placeholder-level (e.g., the analytics writer interface, ClickHouse deferred). Expect the data layer to evolve.

### 14. Many Route Modules Are Empty/Minimal
Some of the 50+ dashboard route modules have minimal implementations. As phases advance, these will grow significantly.

### 15. Frontend Mock Data
`frontend/src/pages/dashboardMock.ts` contains mock data. This should be removed once real endpoints are fully populated.

### 17. Stored-but-not-enforced settings (labelled in the UI)
Saved and shown, but not acted on by the tracker yet — each page says so: Link Templates, Coupon Codes (no coupon-based attribution), Reporting Adjustments (not applied to ledger/reports), invoice "visible to advertiser" (no advertiser invoice portal), partner default attribution/dedup windows, postback `delay` and Meta/TikTok/Snapchat/Rumble delivery methods (fired as a plain URL), SmartSwitch rules (module hidden behind `VITE_FEATURE_SMARTSWITCH`, F-17b), group-level shared caps, CPC-level postbacks.

### 16. Schema Uses Serial Ref Numbers
The `ref` column on entities (offers, publishers, advertisers, etc.) is a `serial` (auto-increment integer). This is visible to users as display IDs. Consider if this should remain sequential.

### 18. Report time zones and entity lists (F-20 follow-ups)
The API now buckets `day`/`hour` in a `tz` zone and `/dashboard` uses the network timezone, but the report pages still send UTC-day ranges (`toIso` in `frontend/src/lib/reportMath.ts`) and no `tz`, so their tables stay UTC; a page that wants local days should send `tz` plus plain dates (and compute "today" in that zone). `/api/reports/grouped` (Click report grouped mode) stays raw + UTC. Report rows now carry `labels` (entity names), but the report pages still load full offer / partner / advertiser lists — they also feed the filter pickers, so dropping them needs a picker that searches server-side.

### 19. Scheduled reports and system emails (F-24 follow-ups)
A schedule is set through the API only (`PATCH /api/saved-reports/:id` — no form on Reporting › Saved & Scheduled yet); Requested Reports is still an empty shell. A scheduled run applies the saved filters, exclusions, Ignore Fail Traffic and sort, but not the page's metric filters (client-side on the pages) or hidden columns, and attaches at most 1,000 rows (the email says so when truncated). Twelve of the 18 Automated System Emails are stored toggles with no send behind them (`wired: false` in `GET /api/communication-hub/system-emails`). Event emails are sent inline in the request (sequential, one SMTP connection per send) — a large "Request Outstanding Balances" selection is slow; moving them to a queue would fix it.

### 20. Creatives: two APIs, inline leftovers, branding logos (F-27 follow-ups)
`/api/creatives` (network-wide, fans out to a row per offer) and `/api/offers/:id/creatives` (per offer) are still two routes over `offer_creatives`; they now share one body schema, one URL rule and the list-safe url projection, but collapsing them into one API needs the Offer › Creatives tab and the Creatives page moved to the same endpoint. Creatives stored inline before F-27 stay inline until `npm run creatives:backfill` runs with storage configured (lists hide their bytes meanwhile); SVG files can't be backfilled (not stored — re-upload as PNG). Control Center branding logos are still data: URLs in network settings, which is why the JSON body limit stays 6 MB.

### 21. Network purge keeps the ledger; metering counts raw rows (F-26 follow-ups)
A purge deletes a network's data and its Supabase logins but keeps its `ledger_entries` rows (and the platform's audit rows): the ledger is append-only — a trigger forbids DELETE — and is the financial record, so removing them needs an explicit decision and a narrowly-scoped exception in that trigger. They stay unreachable (no network) and are in the export. Before F-26 a hard network delete also left the network's clicks, conversions and postback logs behind (those tables have no foreign key to networks); the purge now removes them. Usage metering counts raw clicks / conversions per day (indexed by network + time) every hour — fine at today's volumes; very large networks could read the 15-minute rollups instead. Over-limit usage is flagged, never blocked (by design). A suspended network's dashboard access ends within 15 s on other dashboard processes (in-process state cache); tracking stops at once.
