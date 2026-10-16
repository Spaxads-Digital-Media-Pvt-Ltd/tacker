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
 → a pending / inactive / unknown pub_id → invalid click (flag partner_* / unknown_partner, no payout, no attribution) → fallback: offer's, else network's (Settings › General), else 204 (D1)
 → server-side format=json click with ip= / user_agent= → the visitor's address + browser drive geo, IP lists, dedup, fraud (D2)
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
 - score ≥ fraudCfg.blockScore → rejected (recorded as an invalid click `fraud_blocked`, not sent on); opt-in; a server-side format=json click only when it passes the visitor's ip (D2)
 - every check that fails REJECTS the click: recorded as an invalid click with the reason (lib/click-rejections.ts), visitor to the fallback
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
 → useReportZone() (network zone from GET /api/me, or the one picked) → useQuery('/api/reports/<type>?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=<zone>&...')
 → adminReportsRoutes() handler → buildReportRequest (audience policy; tz → day/hour zone + local-day from/to)
 → getReportingProvider().runReport — Postgres provider:
   - fits the rollups (dims ⊆ offer/publisher/advertiser/smartLink/country/device/day/hour, filters on
     those + range; no city/region/isp/browser/os/subs, no excludeInvalid) and REPORTING_ROLLUPS=on and a
     rollup window exists → whole non-dirty 15-min buckets inside [low_mark, high_mark) ∩ range from
     stats_clicks_15m / stats_conversions_15m, UNION ALL the raw rows outside them, aggregated as one (exact)
   - otherwise raw clicks/conversions only
 → attachLabels (entity names for id dimensions)
 → Return { rows, total }
 → SPA: ReportView renders table + chart

reporting-rollup queue (every minute, lib/reporting/rollups.ts):
 1. freeze: [high_mark, floor15(now − 3h)) rolled up per network, high_mark advanced (one tx, ≤ 6h/run)
 2. dirty: buckets marked by the clicks/conversions triggers (late rows, later status changes —
    rows whose bucket is > 2h old) re-rolled and cleared
 3. backfill: one chunk (24h) below low_mark until backfill_floor (oldest raw row at first run)
 Raw-retention deletes don't touch the rollups (aggregates outlive raw rows).
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
 smartswitch queue (every 5 min, D8) → each active rule: reporting provider grouped by offer × partner
 over its window (scope: offers / advertisers / partners) → pairs where the conditions hold → state.holding
 (first held) → past the Action Delay and not yet acted → (≤ 25 / rule / run, one transaction each)
 notify | block (offer_publisher_access deny) | redirect (offer_custom_settings landing_pages for that
 partner) | payout (offer_publisher_access.payout_override) → system audit + smartswitch_history (kind
 action) → offer cache invalidated → raiseAlert type smartswitch + email admins/managers + alert.raised
 webhook → state.acted (once per holding period; cleared when the pair stops holding or the rule is edited)
 conversion recorded / approved / rejected, alert raised, action run → emitAutomationEvent
 → automation-webhook queue → safeRequest (retries + backoff) → automation_webhook_deliveries

Network lifecycle (F-26):
 platform admin PATCH status suspended|deleted / DELETE (soft) → networkStateChanged: tracking hosts
 dropped from the host cache (the resolver only resolves hosts of ACTIVE networks → /click, /sl,
 postbacks stop), dashboardAuth 403 (state cached 15 s per process), API keys 403, scheduled reports
 paused → PATCH active restores everything (no data was touched)
 → GET /platform/networks/:id/export (NDJSON snapshot, secrets redacted, exported_at)
 → after NETWORK_PURGE_GRACE_DAYS: POST /:id/purge { confirm: slug } → delete Supabase logins (all or
 nothing) → one transaction: clicks / conversions / postback_logs / own audit + logins rows, the
 purged_networks tombstone (D3), DELETE networks (cascade) — ledger_entries and platform audit rows
 stay; the ledger stays downloadable (GET /platform/networks/:id/ledger.csv)
 Its users: dashboard / sign-in / refresh refuse with a reason (network_suspended | network_deleted
 with the restore deadline | network_purged) → the SPA signs them out to /login?ended=<reason>
 Super Admin › Networks: Suspend / Activate, Delete, "Deleted … · can be restored until …", Restore,
 Export, Purge (slug confirmation; export or waive), Purged networks + ledger CSV

Usage metering (F-26, usage-meter queue, hourly):
 per active network: COUNT clicks / conversions / events for yesterday + today (UTC) → upsert
 usage_records → usage vs plan limits for the billing period (subscription period, else UTC month)
 → ≥ 80 % plan_limit_near / ≥ 100 % plan_limit_reached alert, once per limit per period
 → nothing is blocked; GET /api/subscription and /platform/networks/:id/usage show the state

Scheduled reports (F-24):
 Report page Save / Load → PUT /api/saved-reports/by-name (server = source of truth; localStorage cache,
 lib/savedReports.ts) → PATCH /api/saved-reports/:id { schedule (cron, network zone), recipients,
 rangePreset } — any role for its own report, admin/manager for anyone's (D4); recipients follow the
 OWNER's permissions: admin/manager owner → any address; Finance / Read-only owner → only their own
 email (403 recipients_self_only otherwise; none given → theirs); disabled owner → 409 → next_run_at
 scheduled-reports queue (every minute, lib/reporting/saved-reports.ts runDueSavedReports):
 due rows claimed FOR UPDATE SKIP LOCKED and next_run_at advanced first (a failed run waits for its
 next slot) → the saved page config → the same report request the page makes, for the rolling range
 (whole local days) → who it goes to, with its owner's permissions as they are NOW (savedReportDelivery:
 disabled → not sent, "Not sent: its owner's account is disabled."; Finance / Read-only → their current
 email only; admin / manager → the saved recipients) → reporting provider (table + totals) → entity
 labels → summary HTML + CSV attachment (formula-safe cells) → sendTransactionalNow('scheduled_report',
 sent directly) → last_run_status sent | skipped (SMTP not configured / refused / owner disabled — the
 reason is kept) | failed. Send now (POST /:id/send — owner or admin/manager, 20 per person per hour)
 runs the same path.

Transactional email (F-24) through the email queue (O11):
 invite / reset / share offer details / request balances / invoice create / partner notification
 → sendTransactional(event) → the network's Communication Hub toggle (default on; staff invites and
 password resets always send) → an address? → SMTP set up? (no → { skipped: smtp_not_configured })
 → email_outbox row per recipient (body encrypted when it carries a credential) → `email` queue job
 → email worker → network SMTP → sent (credential bodies wiped) | retried with backoff (6 attempts,
 ~15 min) → failed (Communication Hub › Email Log; retry there unless it carried a credential).
 The action itself never fails because of email; `sent: true` on its response = accepted for delivery.
 Partner notifications (lib/email/notifications.ts) fire after the action commits, without waiting:
 sign-up decided, offer application decided, offer live again / paused / archived (edit, archive or a
 scheduled action) → the partners running it, one partner's access opened / blocked, an active
 creative added, a payout run or a paid partner invoice → each partner's own amount.

Fraud Scan (scheduled):
 fraud-scan queue → query clicks + conversions → evaluate rules → create alerts
 → each NEW alert → deliverAlert (lib/alerts/deliver.ts): email via network SMTP + webhook via safeRequest
   → outcome stored on the alert (metadata.delivery); a still-open alert is not re-sent

Retention (daily, per network — F-21):
 retention queue → for each network, its windows (settings.retention, else CLICK_/CONVERSION_RETENTION_DAYS; 0 = keep forever)
 → DELETE its clicks + postback_logs older than the click window (bounded ctid batches, (network_id, created_at) index)
 → DELETE its conversions older than the conversion window that NO ledger entry references
   (a ledgered conversion — earned, billed or reversed — is kept forever, like the ledger itself)
 → nothing financial references a click (conversions carry their own money; the ledger keys on conversions)

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

## Platform Billing (Super Admin → tenant networks)

```
Super Admin › Plans: create a plan (price / month or year, trial days, limits)
Super Admin › Networks › a network › Assign plan
  → trial: subscription 'trialing' until trial_ends_at (no invoice)
  → no trial: 'active' for one period from now + invoice issued at once (free plan: none)
Billing run (worker every 15 min, or Billing › "Run billing now") — lib/billing/engine.ts
  → trial ended → 'active', first period from the trial end, invoiced
  → period ended → next period, invoiced (or 'canceled' when set to cancel at the period end)
  → invoice unpaid at due_at → subscription 'past_due' (flag: Super Admin Billing, tenant banner + Billing page)
  → invoice unpaid at suspend_at (due + grace days) and autoSuspend → network 'suspended' (reason 'billing'):
    tracking, dashboard, portals, API stop; sign-in says "suspended for an unpaid invoice"; once per deadline
Super Admin › Billing (no payment gateway yet — payments recorded by hand)
  → Mark as paid → invoice 'paid' → subscription active again; a billing suspension lifts at once
  → More time (+days / a date) → suspend_at later; a billing suspension it caused lifts at once
  → Void → nothing owed on it (same settling)
  A Super Admin's manual suspension is never lifted by billing; reactivating a billing-suspended network
  by hand stands until a new deadline passes.
```

## Platform Sales (Super Admin › Sales)

```
Lead in: "Request a demo" (/request-demo → POST /api/signup/demo) → lead (website, new) → owner = the active
  Sales member with the fewest open leads + a high-priority follow-up task (due in a day); a repeat → a note
  …or a person adds it (Leads › New lead; the creator owns it; an open lead with the same email → 409)
Work it: log notes / calls / emails / meetings; move it new → contacted → qualified → demo → trial → negotiation
  (stage bar or the kanban); next step + date; tasks (due, assignee) — on the Sales dashboard and /admin/tasks
Lost: needs a reason (lost_at; reopening clears it)
Won → "Convert to customer": network (+ tracking subdomain) + owner login (temporary password shown once, must
  change it) + plan with its trial → lead won + linked; network.sales_owner_id = the lead's owner (an
  'assigned' Sales / Account Manager role then sees that network); a converted lead stays won
```

## Customer Success (Super Admin › Customer health)

```
Workers every 6 h (or "Recalculate"): per network — usage (clicks / conversions 7 days), trend (last 7 complete
  days vs the 7 before), sign-ins (days since the last), billing (subscription, overdue invoices, billing
  suspension), onboarding (owner signed in, domain, offer, advertiser, partner, first click, first conversion,
  partner postback, team, plan) → score 0–100 → healthy / needs attention / at risk; one row per day of history
Fell to at risk (from better) → a high-priority check-in task for the account manager (once per fall)
Account managers: assigned on the health board or the network's Account tab (also set when a lead is
  converted); the Account Manager role sees only its networks; notes (pin), tags, tasks per network
```

## Multi-Tenant Data Isolation

Every query is filtered by `network_id`:
- `req.scope.networkId` from JWT claims (dashboard)
- `tenant.networkId` from host resolution (tracking)
- API keys scoped to network; cross-network access denied

`ScopedDb` (lib/db/scoped-db.ts) attaches `network_id` to queries by construction, preventing accidental cross-tenant leaks. Cross-tenant isolation tests verify this in CI (`npm run test:isolation`).
