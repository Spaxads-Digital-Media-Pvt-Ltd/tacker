# Workflows

## Login Flow (End User)

```
User enters credentials in Login form (frontend/src/pages/Login.tsx)
 → POST /api/auth/login { email, password }
 → Backend: supabase.auth.signInWithPassword() (dashboard/auth-routes.ts)
 → Supabase Auth: validates and issues JWT
 → Backend: Sets httpOnly cookie "tracker_rt" (refresh)
 → Backend: Returns { access_token, expires_at, identity } in envelope
 → SPA: authClient.toSession() maps kind to Role
 → SPA: saveSession() to localStorage (tracker.session.v2)
 → SPA: Router redirects to ROLE_HOME[role]
 - super_admin → /admin
 - admin → /app
 - publisher → /publisher
 - advertiser → /advertiser
```

## Token Refresh (Auto)

```
SPA makes API call with stale token
 → Backend: 401 Unauthorized
 → SPA: detects 401, calls authClient.refreshToken()
 → POST /api/auth/refresh (httpOnly cookie sent automatically)
 → Backend: supabase.auth.refreshSession()
 → Backend: Rotates cookie, returns new access_token
 → SPA: updateToken() in localStorage
 → SPA: Retries original request
```

## Dashboard Auth Flow (Server-side)

```
Dashboard request with Bearer token
 → dashboardAuth middleware (surfaces/dashboard/auth.ts)
 → verifySupabaseJwt(token) — jose
 - ES256: verify against JWKS (auto-refresh on unknown kid)
 - HS256: verify with SUPABASE_JWT_SECRET (test tokens)
 → Extract app_metadata claims: network_id, kind, role, owner_id
 → req.identity = { surface, kind, userId, networkId, role, ownerId? }
 → req.scope = { networkId, ownerId? }
 → requireAdmin / requireRole / requirePortal gates specific routes
 → Route handler runs with scoped identity
```

## Click Flow (Hot Path)

```
End user clicks tracking link
 → GET <tracking-domain>/click?offer_id=X&pub_id=Y&sub1=...
 → resolveHostToNetwork(Host) — DB-backed, Redis-cached
 → getOfferConfig(networkId, offerId) — Redis load-through
 → (Sync decisions, no Postgres reads)
 - offer.status === 'active'
 - publisher not in deniedPublishers
 - evaluateGeoRules(offer.geoRules, country, geoKnown)
 - evaluateTrafficControls(offer.trafficControls, fields)
 - isTrafficBlocked(offer.trafficBlockings, publisherId, fields)
 - fraudPreSignals({ ip, isDatacenter, userAgent, ipqs }, fraudCfg) — datacenter, velocity, bot/headless UA,
   the IP's cached IPQS verdict; weights from the network's fraud rules (Redis-cached config)
 - score ≥ fraudCfg.blockScore → divert (not enqueued); opt-in, never for server-side format=json clicks
 - isClickCapped(offerId, dailyClickCap) — Redis atomic
 - markUnique(offerId, ip, dedupWindowS) — Redis atomic
 → Resolve payout/revenue (geo overrides)
 → enqueueClick(job) — BullMQ async write to Postgres
 → storeClickForAttribution(networkId, clickId, ...) — Redis attribution cache
 → substituteMacros(destinationUrl, macros)
 → 302 redirect to final URL
```

## Postback Flow (S2S Conversion)

```
Advertiser server sends conversion
 → POST <tracking-domain>/postback?click_id=X&txn_id=Y&payout=Z
 → handleConversion(req, 'postback') (tracking/app.ts)
 → resolveHostToNetwork(host)
 → recordConversion({
 networkId,
 clickId,
 txnId,
 event,
 payoutParam,
 revenueParam,
 secureCode,
 source: 'postback',
 rawParams,
 })
 → Lookup click from Redis attribution cache
 → Optional: verify secure_code (if offer has one configured)
 → Create conversion record (append-only)
 → Create ledger entry (append-only)
 → enqueue outbound postback to publisher (BullMQ)
 → Return { status: 'recorded', conversion_id }
```

## Pixel/iframe Flow

Same as postback but:
- Pixel: returns 1x1 transparent GIF (always 200)
- Iframe: serves a tiny HTML document (always 200)
- Same `recordConversion()` core
- Tracking HTML `cache-control: no-store`

## Smart Link Flow

```
End user clicks /sl?id=<smart-link-id>
 → resolveHostToNetwork(host)
 → getSmartLinkConfig — link + items from Redis (`slcfg:{net}:{id}`, load-through; busted by the
   smart-link API and the KPI worker) — no Postgres read per request (F-17b)
 → link missing/paused → catch-all offer (or 204)
 → items targeted at the visitor's country (or untargeted); none → catch-all offer (or 204)
 → drop items whose offer would dead-end at /click: not active, today's click cap reached (read-only
   Redis GET), partner denied / not approved on a non-public offer, geo rules (fail-open without geo)
 → 'priority': lowest position · 'weight': weighted-random · 'kpi': weighted by the KPI worker's
   kpi_weight (even rotation until scored); nothing eligible → catch-all offer (or 204)
 → Forward to /click with offer_id + sl + pub_id + subs + source_id + fbclid/gclid (catch-all too)
 → Normal /click pipeline takes over

smart-link-kpi queue (every 10 min) → active KPI links due (kpi_run_frequency_hours, default 1h)
 → per item: the link's clicks in kpi_lookback_hours (default 24h) + their approved conversions
 → CVR | EPC (payout/click) | Revenue (revenue/click); ≥ kpi_min_clicks (default 50) and score > 0
 → best item(s) share 80, others 20 (≥1 each) → smart_link_items.kpi_weight → cache busted
```

## API Key Generation Flow

```
Admin UI: create API key (POST /api/keys)
 → generateApiKey(audience, env='live')
 → prefix = '<aud>_<env>_<8-char-public-id>'
 → secret = 24 bytes base64url
 → fullKey = 'prefix_secret'
 → keyHash = SHA256(fullKey)
 → Insert into api_keys: { prefix, key_hash, audience, scopes, status }
 → Return fullKey ONCE — never again
 → Client stores fullKey securely
```

## API Key Auth Flow (Public API)

```
External system calls /api/v1/advertiser/...
 → apiKeyAuth middleware (public-api/auth.ts)
 → Parse Authorization: ApiKey <prefix>_<secret>
 → Lookup by prefix (fast — by prefix index)
 → SHA256(secret) → compare to key_hash
 → requireAudience('advertiser') — verify prefix matches expected namespace
 → scope check against requested operation
 → Handler executes
```

## Reporting Flow

```
Admin clicks ReportView
 → useQuery('/api/reports/<type>?from=...&to=...&...')
 → adminReportsRoutes() handler
 → Query Postgres with date range + group_by + filters
 → Aggregate by group_by (max 4 dimensions)
 → Compute metrics (clicks, conversions, payout, revenue, margin, cr, epc)
 → Return { rows, summary }
 → SPA: ReportView renders table + chart
```

## Background Job Flow

```
Click persisted:
 Click Job (BullMQ) → click-persist worker → INSERT into clicks table
 (with de-duplication by click_id from Redis cache)

Outbound Postback:
 Conversion created → outbound-postback queue → POST to publisher's URL
 (retry with backoff, log to postback_logs)

Automation (F-17a):
 scheduled-actions queue (every minute) → due offer_scheduled_actions, one per transaction (SKIP LOCKED)
 → offer status / cap / partner access changed → system audit → offer cache invalidated → webhook event
 alert-rules queue (every 5 min) → reporting provider over the rule's window → conditions start to hold
 → raiseAlert (In App) + deliverAlert email to admins/managers → alert.raised webhook event
 conversion recorded / approved / rejected, alert raised, action run → emitAutomationEvent
 → automation-webhook queue → safeRequest (retries + backoff) → automation_webhook_deliveries

Fraud Scan (scheduled):
 fraud-scan queue → query clicks + conversions → evaluate rules → create alerts
 → each NEW alert → deliverAlert (lib/alerts/deliver.ts): email via network SMTP + webhook via safeRequest
   → outcome stored on the alert (metadata.delivery); a still-open alert is not re-sent

Retention:
 retention queue → DELETE clicks > CLICK_RETENTION_DAYS days old
 DELETE conversions > CONVERSION_RETENTION_DAYS days old

Facebook CAPI:
 Conversion recorded → facebook-capi queue → batch send to Facebook API

Offer Feed Sync (scheduled):
 Scan offers → generate feed → POST to configured endpoint
```

## Onboarding / Provisioning

```
Script: bootstrap:admin
 → Create platform_admin user in Supabase
 → Store PLATFORM_ADMIN_JWT_SECRET signed token

Script: provision:demo-admin
 → Create demo network
 → Create admin user with kind=admin, role=admin
 → Stamp app_metadata with network_id, kind=admin, role=admin
 → User can log in at /login → lands at /app
```

## Multi-Tenant Data Isolation

Every query is filtered by `network_id`:
- `req.scope.networkId` from JWT claims (dashboard)
- `tenant.networkId` from host resolution (tracking)
- API keys scoped to network; cross-network access denied

`ScopedDb` (lib/db/scoped-db.ts) attaches `network_id` to queries by construction, preventing accidental cross-tenant leaks. Cross-tenant isolation tests verify this in CI (`npm run test:isolation`).
