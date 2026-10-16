# Backend Documentation

## Entry Points

Each surface has its own entry point in `src/surfaces/<surface>/main.ts`:

| Surface | File | Port | Framework | Entry |
|---|---|---|---|---|
| Dashboard | `surfaces/dashboard/main.ts` | 4001 | Express | `buildDashboardApp()` |
| Tracking | `surfaces/tracking/main.ts` | 4002 | Fastify | `buildTrackingApp()` |
| Public API | `surfaces/public-api/main.ts` | 4003 | Express | `buildPublicApiApp()` |
| Platform Admin | `surfaces/platform-admin/main.ts` | 4004 | Express | `buildPlatformAdminApp()` |
| Workers | `surfaces/workers/main.ts` | 4005 | Node HTTP | Direct probe server |

All run via `concurrently` in dev: `npm run dev` starts all 5.

### Shared Express Plumbing (`lib/http/express-app.ts`)
```ts
createBaseApp(surface) → helmet, JSON body (6mb limit), pino-http, Prometheus metrics, /health
finalizeApp(app) → 404 handler, error envelope handler
```

### Shared Fastify Plumbing (tracking)
- `trustProxy: isTrustedProxy` (Cloudflare → load balancer; `lib/net/trusted-proxy.ts`, the same check every Express surface uses since O2): `X-Forwarded-For` is walked from the right and only hops from a trusted proxy are skipped, so `req.ip` is the first untrusted address. Trusted = loopback (`127.0.0.1`, `::1` — Nginx on the same host), Cloudflare's **published** IPv4 + IPv6 ranges (cloudflare.com/ips-v4, /ips-v6; dated in the file) and `TRUSTED_PROXIES` / `TRACKING_TRUSTED_PROXIES` (IPv4/IPv6 IPs or CIDRs, or `private`; malformed entries are logged and ignored). In production the same check rejects any non-trusted socket peer with 403. A direct connection keeps its socket address (`127.0.0.1` locally — genuine, never replaced); because loopback is trusted, a local client can still set `X-Forwarded-For` in dev
- `disableRequestLogging: true` (hot path logs its own compact line)
- Error handler reports to Sentry, then returns generic error

## Request Flow

### Dashboard (Express)
```
Request
 ↓
createBaseApp() → helmet, pino-http, /health, /metrics
 ↓
cookieParser() (for auth cookie)
 ↓
/auth/* routes (login/refresh/logout — unauthenticated)
 ↓
dashboardAuth middleware (verify JWT, attach req.identity + req.scope)
 ↓
requireAdmin / requireRole / requirePortal (per route group)
 ↓
Feature route module (e.g., offers/routes.ts)
 ↓
Controller logic (inline in routes)
 ↓
Query via pool / ScopedDb
 ↓
Response envelope { ok: true, data: ... }
```

### Tracking (Fastify)
```
Request
 ↓
resolveHostToNetwork(host header) → tenant resolution
 ↓
Route handler
 ↓
Offer config from Redis (getOfferConfig)
 ↓
Geo rules, traffic controls, traffic blocking, cap check, dedup
 ↓
Fraud pre-signals
 ↓
enqueueClick → BullMQ
 ↓
storeClickForAttribution → Redis
 ↓
302 redirect with macro-substituted URL
```

## Controllers / Route Modules

Dashboard routes follow the pattern: `<surface>/<feature>/routes.ts`
Each exports a function returning an Express Router.

**Auth**: `surfaces/dashboard/auth-routes.ts`
- `POST /api/auth/login` — Supabase password sign-in
- `POST /api/auth/refresh` — Token refresh (httpOnly cookie)
- `POST /api/auth/logout` — Clear cookie

**50+ feature route modules** mounted in `app.ts`, all under `/api/`:
- offers, publishers, advertisers, reports, alerts, ai, tags, custom-fields, settings, smart-links, offline, import-export, catalog, invoices, offer-templates, offer-groups, creatives, custom-metrics, marketplace-profile, communication-hub, customer-value, traffic-health, investigator, automation, audit-log, conversion-imports, traffic-controls, offer-custom-settings, smartswitch, users, postbacks, partner-tiers, offer-applications, questionnaires, traffic-blocking, traffic-sources, reporting-adjustments, coupon-codes, partner-invoices, link-templates, postback-controls, advertiser-invoices, tiered-commissions, control-center, api-keys

Each admin route is gated by:
```ts
authed.use('/<feature>', requireAdmin, <feature>Routes());
```

Portal routes are gated by:
```ts
authed.use('/portal/publisher', requirePortal('publisher'), publisherPortalRoutes());
authed.use('/portal/advertiser', requirePortal('advertiser'), advertiserPortalRoutes());
```

## Services / Business Logic

### `lib/` Modules
| Module | Purpose |
|---|---|
| `ai/` | Anthropic SDK integration, tool definitions, quota.ts (per-network daily chat / token budget in Redis → 429) |
| `analytics/` | Analytics writer (ClickHouse interface, deferred) |
| `apikeys/` | API key generation (`adv_live_*`/`pub_live_*`/`net_live_*`), sha256 hashing |
| `auth/` | JWT verification via jose (JWKS ES256 + HS256 fallback) |
| `customer-value/` | Customer value rule evaluation |
| `db/` | Pool, ScopedDb, from-request, table registry |
| `fraud/` | Fraud rules (Redis-cached for /click), fraud scan, alerts |
| `alerts/` | `deliverAlert` — email + webhook delivery of raised alerts (fraud scan; automation alert rules) |
| `automation/` | Scheduled-action runner, alert-rule grammar + evaluator, SmartSwitch engine (D8: per partner × offer conditions → notify / block / redirect / payout, delay, action log, preview), webhook events (emit + delivery) |
| `smart-links/` | KPI scoring for KPI smart links (kpiWeights + rescoreKpiSmartLinks) |
| `partner-tiers.ts` | Tier payout (revenue × (1 − margin)) + auto-approve check |
| `geo/` | MaxMind GeoIP2 lookup |
| `http/` | Express app scaffolding, envelope, errors, pagination |
| `integrations/` | Facebook CAPI, offer feed sync, PIN API |
| `investigator/` | Investigation logic |
| `ledger/` | Append-only money ledger |
| `observability/` | Sentry, Prometheus metrics |
| `postback/` | Postback test utilities |
| `postback-controls/` | Dynamic postback control evaluation |
| `reporting/` | Reporting aggregation: provider (postgres.ts — raw or rollups + raw tail), rollups.ts (worker + window), time-zone.ts (report zones), labels.ts (entity names on rows), saved-reports.ts (saved configs → report requests, CSV, scheduled runs — F-24) |
| `networks/` | state.ts (`networkState` — active / suspended / deleted, checked by dashboardAuth; `networkStateChanged` drops the cached state + tracking hosts), lifecycle.ts (soft delete, NDJSON export, purge) — F-26 |
| `usage/` | meter.ts — per-day usage into usage_records, usage vs plan limits, near / reached alerts (policy: flag, never block) — F-26 |
| `creatives/` | files.ts (creative uploads to object storage, allowed types, list-safe url columns, data: URI parsing), backfill.ts (inline data: files → storage, `npm run creatives:backfill`) — F-27 |
| `storage/` | supabase-storage.ts (public bucket uploads, backend only); images.ts (O12: branding logo / favicon + profile photo → bucket `network-images`, content-addressed; allowed types, no SVG; `imageUrlSchema` / `assertImageValue` — settings keep only the URL); images-backfill.ts (inline data: images → storage, `npm run images:backfill`) |
| `email/` | system-emails.ts (Automated System Emails catalog + which are sent), transactional.ts (`sendTransactional`: toggle → recipients → network SMTP, never throws), templates.ts (F-24) |
| `scheduling/` | cron.ts — 5-field cron parse + next run in a time zone (DST-safe) |
| `retention/` | Per-network click / postback-log / conversion pruning; conversions any ledger entry references are never pruned (F-21) |
| `tiered-commissions/` | Tiered commission calculation |

### Tracking-Specific (in `surfaces/tracking/`)
| Module | Purpose |
|---|---|
| `offer-cache.ts` | Redis load-through cache for offer config (no sync PG on hot path) |
| `caps.ts` | Atomic click cap check in Redis |
| `dedup.ts` | IP-based dedup/idempotency |
| `fraud-presignals.ts` | Fast pre-signals (datacenter IP, velocity, bot/headless UA, cached IPQS verdict), weighted by the network's fraud rules; /click diverts at the block score |
| `geo-rules.ts` | Offer geo targeting rules |
| `macros.ts` | Macro token build + substitution (click_id, offer_id, etc.) |
| `click-job.ts` | Job definition + enqueue for click persistence |
| `click-store.ts` | Store click in Redis for attribution |
| `conversions/record.ts` | Conversion recording (normalizes postback/pixel/iframe/advertiser API); per-event duplicate rules (`dedupeRule`: one per click / unique transaction ids / every postback), unusual-volume hold, a reason on every outcome |
| `conversions/inbound-log.ts` | Inbound postback log — one `inbound_postback_logs` row per conversion request, recorded or not, and why |
| `traffic-controls-eval.ts` | Evaluate offer traffic controls |
| `traffic-blocking-eval.ts` | Evaluate partner traffic blocking |
| `host-resolver-db.ts` | DB-backed tenant resolution (Redis-cached) |

## Workers

### Queue Processors (`surfaces/workers/processors/`)
| Worker | File | Queue | Schedule |
|---|---|---|---|
| Click Persist | `click-persist.ts` | `click-persist` | Continuous |
| Outbound Postback | `outbound-postback.ts` | `outbound-postback` | Continuous |
| Fraud Scan | `fraud-scan.ts` | `fraud-scan` | Scheduled |
| Retention | `retention.ts` | `retention` | Scheduled |
| Facebook CAPI | `facebook-capi.ts` | `facebook-capi` | Continuous |
| Offer Feed Sync | `offer-feed-sync.ts` | `offer-feed-sync` | Scheduled |
| Tracking Domain Re-check | `domain-verify.ts` | `domain-verify` | Every 10 min — DNS TXT verification of pending custom domains |
| Scheduled Actions | `scheduled-actions.ts` | `scheduled-actions` | Every minute — applies due offer scheduled actions (lib/automation/scheduled-actions.ts) |
| Alert Rules | `alert-rules.ts` | `alert-rules` | Every 5 min — evaluates Automation alert rules via the reporting provider (lib/automation/alert-rules.ts) |
| SmartSwitch | `smartswitch.ts` | `smartswitch` | Every 5 min — evaluates SmartSwitch rules per partner × offer and applies notify / block / redirect / payout (lib/automation/smartswitch.ts, D8) |
| Automation Webhooks | `automation-webhook.ts` | `automation-webhook` | Continuous — event deliveries with retries/backoff through safeRequest (lib/automation/webhooks.ts) |
| Smart-Link KPI | `smart-link-kpi.ts` | `smart-link-kpi` | Every 10 min — re-scores due KPI smart links (lib/smart-links/kpi.ts) |
| Reporting Rollups | `reporting-rollup.ts` | `reporting-rollup` | Every minute — freeze / dirty re-roll / backfill of the 15-min rollups (lib/reporting/rollups.ts) |
| Usage Meter | `usage-meter.ts` | `usage-meter` | Hourly — meters each active network's clicks / conversions / events (today + yesterday, UTC) and raises plan-limit alerts (lib/usage/meter.ts) |
| Platform Billing | `platform-billing.ts` | `platform-billing` | Every 15 min — `lib/billing/engine.ts runBilling`: ended trials → active + invoiced; ended periods → renewed + invoiced (caught up period by period) or canceled; overdue invoices → subscription `past_due`; past `suspend_at` → network suspended for billing (once per deadline; `autoSuspend`). Each subscription in its own transaction under `FOR UPDATE SKIP LOCKED` (pooler-safe); audited as system; then `lib/billing/revenue.ts snapshotMrr` (today's MRR per paying network + movements) |
| Customer health | `platform-health.ts` | `platform-health` | Every 6 h (and once at start) — `lib/platform/health.ts computeHealth`: each network's health score (usage 30 %, trend 15 %, sign-ins 20 %, billing 20 %, onboarding 15 %; healthy ≥ 70, attention 40–69, at risk < 40), daily history, onboarding milestones; a fall to at risk → a check-in task for its account manager (once per fall); history kept ~400 days |
| Support housekeeping | `platform-support.ts` | `platform-support` | Hourly — `lib/platform/support.ts closeResolvedTickets`: resolved tickets with no customer reply for `autoCloseDays` (default 7) → closed, with a system line on the thread |
| Scheduled Reports | `scheduled-reports.ts` | `scheduled-reports` | Every minute — emails due scheduled saved reports as CSV (lib/reporting/saved-reports.ts) |
| Email | `email.ts` | `email` | On demand — sends each queued email (one `email_outbox` row) through the network's SMTP; 6 attempts, exponential backoff from 30 s; SMTP problems are final (lib/email/outbox.ts, O11) |

### Queue Definitions (`surfaces/workers/queues.ts`)
Exports `QUEUE` constant mapping queue names to BullMQ queue instances.

### Worker Infrastructure
- BullMQ + Redis (connection with `maxRetriesPerRequest: null`)
- Failed jobs reported to Sentry (only on exhausted retries)
- Queue depth sampled every 15s → Prometheus gauge
- Graceful shutdown on SIGTERM/SIGINT

## Middleware

### Dashboard Auth (`surfaces/dashboard/auth.ts`)
- `dashboardAuth` — Verify Supabase JWT, extract `network_id`, `kind`, `role`, `owner_id` from `app_metadata`
- `requireAdmin` — Restrict to admin dashboard users
- `requireRole(...allowed)` — RBAC guard (admin, manager, finance, read_only)
- `requirePortal(kind)` — Restrict to publisher or advertiser portal

### Platform Admin Auth (`surfaces/platform-admin/auth.ts`)
- Separate JWT verification (`PLATFORM_ADMIN_JWT_SECRET`)
- Completely isolated from tenant auth

### Host Resolver (`middleware/host-resolver.ts`)
- `resolveHostToNetwork(host)` → tenant from tracking domain
- Used by tracking surface for every request
- Implementation: `DbHostResolver` (DB-backed, Redis-cached)

### API Key Auth (`surfaces/public-api/auth.ts`)
- `apiKeyAuth` — Parse `Authorization: ApiKey <prefix>_<secret>`
- Verify prefix audience, look up sha256 hash
- `requireAudience(audience)` — Ensure key matches expected audience

## Models (TypeScript Interfaces)

`src/domain/entities.ts` — TypeScript interfaces for DB row shapes:
- `AdvertiserRow`, `PublisherRow`, `OfferRow`
- `OfferGeoRuleRow`, `OfferPublisherAccessRow`
- `TrackingDomainRow`, `InvestigationRow`

No ORM. All queries are raw SQL via `pool.query()` or `ScopedDb`.

## Validation

- **zod** schemas inline in route handlers (`validateBody(schema)`)
- Common: email, password, pagination params, CRUD bodies
- `validateBody` / `validateQuery` return 422 `validation_failed`; the message names each field's problem (first three, e.g. `Email: Invalid email · Password: Required`), `details` keeps the full per-field list

## Error Handling

- **Express**: `notFoundHandler` (404), `errorHandler` (wraps in envelope)
- **Fastify**: Custom error handler → Sentry → generic error response
- Errors use the envelope: `{ ok: false, error: { code: string, message: string } }`
- Every Express request has an id (a proxy's `X-Request-Id` if it looks like one, else a uuid), returned as `X-Request-Id` and logged. An unexpected error → 500 `internal`, message "Something went wrong on our side… quote reference <id>", `details.reference`; outside production the message also names the cause

## Database

### Connection
- `pg.Pool` — configured in `lib/db/pool.ts`
- `DATABASE_URL` from env (Supabase pooler in prod for concurrency)
- Max connections: 10 (dev), 20 (prod)
- Connection pool errors logged via pino

### Query Patterns
- Raw SQL via `pool.query()` or `query<T>()`
- `ScopedDb` — attaches `network_id` automatically
- `from-request.ts` — extracts owner info from Express request
- No query builder, no ORM

### Migrations
- 62 SQL files in `migrations/` (timestamped `1700000000000_*.sql`)
- `node-pg-migrate` — `npm run migrate` (up), `npm run migrate:down`
- Schema covers: networks, users, parties, offers, clicks, conversions, ledger, api-keys, fraud, etc.

## Scripts

| Script | Purpose |
|---|---|
| `seed.ts` | Basic seed data |
| `seed:rich` | Rich seed (partners, offers, etc.) |
| `seed:rich-modules` | Seed specific modules |
| `seed:demo-data` | Demo data for development |
| `bootstrap:admin` | Create platform admin |
| `provision:demo-admin` | Provision demo network admin |
| `provision:demo-portals` | Provision demo publisher/advertiser portals |
| `reconcile.ts` | Data reconciliation |
| `fraud-scan.ts` | Run fraud scan |
| `retention.ts` | Run retention pruning |
| `loadtest-click.ts` | Load test click path |
| `smoke.ts` | Smoke tests |
| Various `*-smoke.ts` | Per-feature smoke tests |

## Configuration

- `config/env.ts` — Zod-validated env loading (fail-fast at boot)
- `config/branding.ts` — Brand name (single source of truth)
- No separate config files — all via env vars

## Logging

- **pino-http** for HTTP request logging per surface
- `surfaceLogger(name)` — per-surface logger
- Hot path: Fastify custom log line per click (compact)
- Tracking logs: click_id, offer_id, unique, fraud score, microsecond latency

## Metrics

- **prom-client** Prometheus exposition at `/metrics`
- HTTP duration (per route, not raw path)
- Click outcomes histogram
- Queue depth gauges
- `queueDepth` sampled every 15s

## Super Admin platform modules (lib/platform)
- `permissions.ts` — staff role sections and levels; `sales.ts` — pipeline vocabulary, lead routing, inbound leads; `health.ts` — customer health score; `support.ts` — help desk rules (settings, auto-assign, auto-close); `flags.ts` — feature flags (evaluation, `requireFeature` on gateable tenant routes); `announcements.ts` — tenant announcements; `email.ts` — platform SMTP settings + notification toggles; `notify.ts` — the platform's emails (tickets, demo requests, tasks, invoices, overdue, suspension), fail-safe, through the email queue (`enqueuePlatformEmails`, `sendPlatformEmail` in lib/mailer.ts)
- `lib/billing/charges.ts` (invoice lines: plan, overage, discount) and `lib/billing/revenue.ts` (MRR definition, snapshots, movements); `lib/networks/create.ts` (network creation, shared by New network and lead conversion); `lib/db/pool.ts withTransaction`

