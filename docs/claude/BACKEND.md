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
- `trustProxy: true` (Cloudflare → Nginx)
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
- offers, publishers, advertisers, reports, alerts, ai, tags, custom-fields, settings, smart-links, offline, import-export, catalog, invoices, offer-templates, offer-groups, creatives, custom-metrics, marketplace-profile, communication-hub, customer-value, traffic-health, investigator, automation, audit-log, conversion-imports, traffic-controls, offer-custom-settings, smartswitch, users, postbacks, partner-tiers, partner-channels, offer-categories, business-units, offer-applications, questionnaires, traffic-blocking, traffic-sources, reporting-adjustments, coupon-codes, partner-invoices, link-templates, postback-controls, advertiser-invoices, tiered-commissions, control-center, api-keys

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
| `ai/` | Anthropic SDK integration, tool definitions |
| `analytics/` | Analytics writer (ClickHouse interface, deferred) |
| `apikeys/` | API key generation (`adv_live_*`/`pub_live_*`/`net_live_*`), sha256 hashing |
| `auth/` | JWT verification via jose (JWKS ES256 + HS256 fallback) |
| `customer-value/` | Customer value rule evaluation |
| `db/` | Pool, ScopedDb, from-request, table registry |
| `fraud/` | Fraud rules, fraud scan, alerts |
| `geo/` | MaxMind GeoIP2 lookup |
| `http/` | Express app scaffolding, envelope, errors, pagination |
| `integrations/` | Facebook CAPI, offer feed sync, PIN API |
| `investigator/` | Investigation logic |
| `ledger/` | Append-only money ledger |
| `observability/` | Sentry, Prometheus metrics |
| `postback/` | Postback test utilities |
| `postback-controls/` | Dynamic postback control evaluation |
| `reporting/` | Reporting aggregation |
| `retention/` | Click/conversion pruning |
| `tiered-commissions/` | Tiered commission calculation |

### Tracking-Specific (in `surfaces/tracking/`)
| Module | Purpose |
|---|---|
| `offer-cache.ts` | Redis load-through cache for offer config (no sync PG on hot path) |
| `caps.ts` | Atomic click cap check in Redis |
| `dedup.ts` | IP-based dedup/idempotency |
| `fraud-presignals.ts` | Fast pre-signals (datacenter IP, velocity) |
| `geo-rules.ts` | Offer geo targeting rules |
| `macros.ts` | Macro token build + substitution (click_id, offer_id, etc.) |
| `click-job.ts` | Job definition + enqueue for click persistence |
| `click-store.ts` | Store click in Redis for attribution |
| `conversions/record.ts` | Conversion recording (normalizes postback/pixel/iframe) |
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
- `validateBody` middleware returns 400 with error details

## Error Handling

- **Express**: `notFoundHandler` (404), `errorHandler` (wraps in envelope)
- **Fastify**: Custom error handler → Sentry → generic error response
- Errors use the envelope: `{ ok: false, error: { code: string, message: string } }`

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
