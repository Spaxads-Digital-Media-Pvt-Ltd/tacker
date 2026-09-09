# Architecture

## Overview: Five Segregated Surfaces

The backend runs as **five independently scalable services** (spec §2.1, non-negotiable #10). They share code and DB/Redis but run on **different ports** with **different auth**:

```
Client Browser
 │
 ├── Vite dev proxy (/api → :4001, /platform → :4004)
 │
 ▼
┌─────────────────────────────────────────────────┐
│ Frontend (React SPA, port 5173) │
│ src/App.tsx — role-gated routes │
│ src/lib/api.ts — Bearer token HTTP client │
│ src/auth/AuthContext.tsx — session state │
└─────────────┬───────────────────────────────────┘
 │
 │ HTTP (authenticated)
 │
 ┌─────────┴───────────────────────────────────────┐
 │ │
 ▼ ▼
┌───────────────┐ ┌───────────────────┐
│ :4001 │ │ :4004 │
│ Dashboard │ │ Platform Admin │
│ Express │ │ Express │
│ (API surface) │ │ (Super Admin) │
│ │ │ │
│ auth: Supabase │ │ auth: Own JWT │
│ JWT + RBAC │ │ │
└────────┬──────┘ └───────────────────┘
 │
 │ internal calls / shared lib
 ▼
┌───────────────┐ ┌───────────────────┐
│ :4002 │ │ :4003 │
│ Tracking │ │ Public REST API │
│ Fastify │ │ Express │
│ (hot path) │ │ (3rd-party code) │
│ │ │ │
│ auth: None │ │ auth: API key │
│ (tenant by │ │ │
│ host header) │ │ │
└────────┬───────┘ └───────────────────┘
 │
 │ shared lib (pool, redis, lib/*)
 ▼
┌─────────────────────────────────────────────────────┐
│ Workers (:4005) │
│ Node http server │
│ BullMQ processors: │
│ - click-persist: durable write from Redis queue │
│ - outbound-postback: fire postbacks to publishers │
│ - fraud-scan: scheduled fraud analysis │
│ - retention: prune old clicks/conversions │
│ - facebook-capi: CAPI batch │
│ - offer-feed-sync: outbound offers │
└─────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────┐
│ Shared Data Layer │
│ Postgres 16 (via node-pg-migrate, 62 migrations) │
│ Redis 7 (ioredis — cache, dedup, caps, BullMQ) │
│ Supabase (Auth + Admin API — backend only) │
│ MaxMind GeoIP2 (optional) │
└─────────────────────────────────────────────────────┘
```

## Data Flow

### Dashboard API Request (e.g., GET /api/offers)
```
Browser
 → Authorization: Bearer <token> (localStorage)
 → Express dashboard (:4001)
 → dashboardAuth middleware (verifySupabaseJwt via jose JWKS)
 → req.identity = { surface: 'dashboard', kind: 'admin', userId, networkId, role }
 → requireAdmin + requireRole('admin')
 → routes/surfaces/dashboard/offers/routes.ts
 → lib/db/pool.js (pg query with network_id = req.scope.networkId)
 → lib/http/envelope.ts (wrap in { ok: true, data: ... })
 → Browser
```

### Click Tracking (Hot Path)
```
End user (browser → click on tracking link)
 → Host header → resolveHostToNetwork(host) → tenant.networkId (Redis-cached DB lookup)
 → GET /click?offer_id=X&pub_id=Y
 → getOfferConfig(networkId, offerId) from Redis (load-through, no PG on hot path)
 → evaluateGeoRules, evaluateTrafficControls, isTrafficBlocked, isClickCapped, markUnique
 → fraudPreSignals(ip)
 → enqueueClick(job) to BullMQ (async durable write)
 → storeClickForAttribution (Redis attribution cache for conversion path)
 → substituteMacros(destinationUrl, macros) → 302 redirect
 // The Hot Path NEVER touches Postgres synchronously
```

### Conversion (S2S Postback)
```
Advertiser server
 → POST /postback (tracking surface :4002)
 → resolveHostToNetwork(host)
 → recordConversion({ networkId, clickId, ... })
 → lookup click from Redis attribution cache
 → verify security_code (optional)
 → write conversion to Postgres (append-only ledger)
 → enqueue outbound postback to publishers (BullMQ)
 → { status: 'recorded', conversion_id: ... }
```

### Auth Flow
```
1. Browser POST /api/auth/login { email, password }
 Backend: supabase.auth.signInWithPassword() → Supabase Auth issues JWT
 Backend: Set httpOnly cookie "tracker_rt" with refresh token
 Backend: Return { access_token, expires_at, identity } in JSON

2. SPA stores access_token in localStorage, refreshes on 401

3. Every API call: Authorization: Bearer <access_token>
 Backend: verifySupabaseJwt(token) via jose
 - ES256: verify against JWKS (SUPABASE_URL/auth/v1/.well-known/jwks.json)
 - HS256: verify with SUPABASE_JWT_SECRET (test tokens only)

4. Custom claims from app_metadata: { network_id, kind, role, owner_id }
```

## Authentication Flow Per Surface

| Surface | Port | Auth Gate | Token Source | Claims |
|---|---|---|---|---|
| Dashboard | 4001 | Supabase JWT (jose JWKS) | Bearer header | network_id, kind, role, owner_id |
| Platform Admin | 4004 | Own JWT (PLATFORM_ADMIN_JWT_SECRET) | Bearer header | Separate from tenant users |
| Tracking | 4002 | None | Host header → tenant | network_id from DB |
| Public API | 4003 | API key (sha256 hashed) | Authorization: ApiKey <prefix>_<secret> | audience (advertiser/publisher/network) |
| Workers | 4005 | None (internal) | — | — |

## Module Relationships

```
src/
├── config/ Shared config (env.ts with zod validation, branding.ts)
├── middleware/ Shared host-resolver middleware
├── domain/ TypeScript interfaces (entities.ts)
├── lib/ Shared libraries
│ ├── auth/ verify-jwt.ts (Supabase JWT verification)
│ ├── db/ pool.ts, scoped-db.ts, from-request.ts
│ ├── http/ express-app.ts, envelope.ts, errors.ts, pagination.ts
│ ├── integrations/ Facebook CAPI, offer-feed-sync, PIN API
│ ├── apikeys/ API key generation, hashing, rate limiting
│ ├── postback/ Postback test utilities
│ ├── postback-controls/ Dynamic control logic
│ ├── fraud/ Alert rules, fraud scan
│ ├── geo/ MaxMind GeoIP2 integration
│ ├── ledger/ Append-only money logic
│ ├── observability/ Sentry, metrics
│ ├── reporting/ Analytics writer
│ ├── retention/ Click/conversion pruning
│ └── ... Many more libs for ai, analytics, customer-value, etc.
├── surfaces/ The five segregrated services
│ ├── dashboard/ Express — admin + portal routes (50+ route modules)
│ ├── tracking/ Fastify — /click, /postback, /pixel, /iframe, /sl
│ ├── public-api/ Express — /api/v1/advertiser|publisher|network/*
│ ├── platform-admin/ Express — /platform/* (super admin)
│ └── workers/ Node http — BullMQ processors, /health, /metrics
```

## Multi-Tenancy Model

- **Network** (tenant): Top-level entity — one network = one advertiser/publisher instance
- **Scoped queries**: Every query filters by `network_id` (from `req.scope.networkId` on dashboard, from `tenant.networkId` on tracking)
- **ScopedDb**: `lib/db/scoped-db.ts` — a query helper that attaches network_id automatically
- **Owner-scoped portals**: Publisher/advertiser portal routes further filter by `owner_id`

## Frontend → Backend Communication

- Vite dev proxy: `/api` → `:4001` (dashboard), `/platform` → `:4004` (platform-admin)
- Production: frontend built as static SPA, served behind the Express dashboard (or CDN) with same origin
- All calls use `credentials: 'include'` (for refresh cookies) + `Authorization: Bearer` header
- Error envelope: `{ ok: true, data: T }` or `{ ok: false, error: { code, message } }`
- Auto-transparent token refresh on 401

## Observability

- **Logging**: `pino-http` per surface, compact hot-path log lines
- **Metrics**: `prom-client` Prometheus exposition at `/metrics`
- **Error tracking**: Sentry (no-op without SENTRY_DSN)
- **Health**: `GET /health` on every surface
