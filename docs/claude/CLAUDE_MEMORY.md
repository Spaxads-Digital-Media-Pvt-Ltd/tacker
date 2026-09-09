# Project Identity

**Tracker** — Multi-tenant affiliate tracking SaaS (click tracking, conversion attribution, append-only money ledger, reporting, AI ops). Positioned as Trackier/Everflow competitor. Two repos: `api-backend/` + `frontend/`. Working name "Tracker" — renameable (brand string in `config/branding.ts` per repo).

---

# Architecture

```
Frontend (React SPA) → HTTP → Dashboard (:4001) + Public API (:4003) + Platform Admin (:4004)
 → HTTP → Tracking (:4002) — Fastify, NO auth
 ↓
 Workers (:4005) — BullMQ processors
 ↓
 Postgres 16 + Redis 7
```

**Five segregated backend surfaces** (spec §2.1, non-negotiable #10), each own port + own auth:
- `:4001` Dashboard — Express, Supabase JWT + RBAC
- `:4002` Tracking — Fastify, **no auth**, tenant by Host header
- `:4003` Public API — Express, API key auth
- `:4004` Platform Admin — Express, own JWT (`PLATFORM_ADMIN_JWT_SECRET`)
- `:4005` Workers — Node HTTP, BullMQ processors

**Frontend never touches DB or Supabase directly.** All data via authenticated HTTP.

---

# Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TS 5, Vite 5, Tailwind CSS 3, React Router 6 |
| Backend | Node 20+, TS 5 (ESM), Express 4 + Fastify 4 |
| DB | Postgres 16 (pg 8 raw, no ORM) |
| Cache/Queue | Redis 7 (ioredis) + BullMQ 5 |
| Auth | Supabase Auth (JWT) + jose (JWKS verification) |
| AI | Anthropic SDK |
| Observability | Sentry (optional), Prometheus (prom-client), pino logging |
| Geo | MaxMind GeoIP2 (optional) |
| CI | GitHub Actions (secret scan + tests + build) |
| Infra | Docker Compose (local dev) |

---

# Frontend Structure

```
frontend/src/
├── main.tsx — Entry (BrowserRouter > ThemeProvider > AuthProvider > App)
├── App.tsx — Routes (4 role groups, all lazy-loaded)
├── auth/ — AuthContext, ProtectedRoute, roles, session (localStorage)
├── components/ — Shared UI (AppShell, NavFlyout, ui.tsx, etc.)
├── pages/
│ ├── admin/ — 80+ page files (advertisers, publishers, offers, reports, etc.)
│ ├── portal/ — Publisher/Advertiser portal pages
│ └── super-admin/ — Networks, Subscriptions, Usage
├── lib/ — api.ts (HTTP client), authClient.ts, useApi.ts, reportFilters.ts
├── theme/ — Light/dark theme (CSS-only)
├── config/branding.ts — Brand name
└── index.css — Design tokens (Sora/Space Mono fonts, teal/slate palette)
```

**No external state management**. `useState` + `useContext` + `localStorage`.

---

# Backend Structure

```
api-backend/src/
├── config/env.ts — Zod-validated env (fail-fast)
├── config/branding.ts — Brand name
├── domain/entities.ts — DB row TypeScript interfaces
├── middleware/host-resolver.ts — Tenant from Host header
├── lib/ — Shared libraries
│ ├── auth/verify-jwt.ts — JWT via jose (JWKS ES256 + HS256 fallback)
│ ├── db/pool.ts — pg Pool, query(), ScopedDb
│ ├── redis.ts — Redis connection + BullMQ factory
│ ├── http/ — express-app.ts (scaffolding), envelope.ts, errors.ts
│ ├── apikeys/ — Key generation (sha256), rate limiting
│ ├── ai/, analytics/, fraud/, geo/, integrations/, ledger/, observability/, postback/, postback-controls/, reporting/, retention/, tiered-commissions/
├── surfaces/ — 5 independently scalable services
│ ├── dashboard/main.ts → app.ts (50+ route modules) → auth.ts (RBAC)
│ ├── tracking/main.ts → Fastify /click /postback /pixel /iframe /sl
│ ├── public-api/main.ts → Express /api/v1/advertiser|publisher|network/*
│ ├── platform-admin/main.ts → Express /platform/*
│ └── workers/main.ts → BullMQ processors (click-persist, outbound-postback, fraud-scan, retention, facebook-capi, offer-feed-sync)
```

---

# Database

**62 migrations** in `api-backend/migrations/`. Key tables:
- `networks` — tenant (one per advertiser)
- `users` — dashboard auth users (linked to Supabase Auth)
- `parties` — unified advertisers + publishers
- `offers` — central entity (payout model, caps, attribution windows)
- `clicks` — append-only (written async by workers)
- `conversions` — append-only ledger (S2S + pixel + iframe)
- `ledger_entries` — append-only money
- `smart_links`, `smart_link_items` — smart link routing
- `tracking_domains` — subdomain/custom tracking domains
- `api_keys` — sha256-hashed keys for Public REST API
- `invoices` (partner + advertiser) — billing

**Multi-tenancy**: Every query filtered by `network_id` from JWT claims (dashboard) or host header (tracking). `ScopedDb` attaches it by construction.

**Money**: Stored as `text` (never float).

---

# Authentication

| Surface | Auth | Token | Claims |
|---|---|---|---|
| Dashboard (:4001) | Supabase JWT (jose JWKS) | Bearer header | network_id, kind, role, owner_id |
| Platform Admin (:4004) | Own JWT (PLATFORM_ADMIN_JWT_SECRET) | Bearer header | Separate from tenants |
| Tracking (:4002) | **None** | Host header → tenant | network_id from DB |
| Public API (:4003) | API key (sha256) | Authorization: ApiKey | audience |
| Workers (:4005) | Internal | — | — |

**Refresh token**: httpOnly cookie `tracker_rt` (path `/api/auth`, 30 days). Frontend never sees it.

**Session**: localStorage `tracker.session.v2` (access_token + role + expiresAt).

**Login**: Browser → `POST /api/auth/login` → Supabase Auth → httpOnly cookie + JSON response → localStorage.

---

# Important APIs

### Dashboard Auth
- `POST /api/auth/login` — Email/password
- `POST /api/auth/refresh` — Token refresh (cookie)
- `POST /api/auth/logout` — Clear cookie

### Dashboard Identity
- `GET /api/me` — Identity + scope
- `GET /api/me/account` — Own user row
- `PATCH /api/me/profile` — Update profile
- `GET /api/me/notifications` — Notification prefs

### Dashboard Admin (50+ route modules under `/api/`)
- `/api/advertisers/*`, `/api/publishers/*`, `/api/offers/*`, `/api/reports/*`, `/api/alerts/*`, `/api/ai/*`, `/api/smart-links/*`, `/api/control-center/*`, etc.
- All admin routes: `dashboardAuth` → `requireAdmin` → handler

### Dashboard Portal (owner-scoped)
- `/api/portal/publisher/*` — Publisher self-reads
- `/api/portal/advertiser/*` — Advertiser self-reads

### Tracking (no auth)
- `GET /click` — Click redirect (302) with macro substitution
- `GET /sl` — Smart link resolver → redirect to /click
- `GET/POST /postback` — S2S conversion
- `GET /pixel` — Pixel conversion (1x1 GIF)
- `GET /iframe` — Iframe conversion

### Public API (API key auth)
- `/api/v1/advertiser/*` — Advertiser keys only
- `/api/v1/publisher/*` — Publisher keys only
- `/api/v1/network/*` — Network keys only
- `/api/v1/openapi.json` — OpenAPI spec

---

# Important Business Logic

### Click Path (Hot Path — NO Postgres on /click)
1. Resolve tenant from Host header → Redis-cached
2. Load offer config from Redis (load-through cache)
3. Check: offer active, publisher not denied, geo rules, traffic controls, traffic blocking, daily cap, unique/dedup
4. Fraud pre-signals (datacenter IP, velocity)
5. Enqueue click to BullMQ (async Postgres write)
6. Store attribution data in Redis
7. Build macros, substitute into destination URL, 302 redirect

### Conversion (S2S Postback)
1. Lookup click from Redis attribution cache
2. Optional: verify secure_code
3. Append conversion + ledger entries
4. Enqueue outbound postback to publisher

### Smart Links
1. Look up smart_link + items from Postgres (small read)
2. Geo-filter items, pick by priority or weighted-random
3. Forward to /click

### Money (Append-Only)
- All conversions create ledger_entries
- Never update or delete existing entries
- Money stored as text (never float)

---

# Critical Files

| File | Purpose |
|---|---|
| `api-backend/src/surfaces/tracking/app.ts` | Click/postback/pixel/iframe/smart-link |
| `api-backend/src/surfaces/dashboard/app.ts` | Dashboard route assembly |
| `api-backend/src/surfaces/dashboard/auth-routes.ts` | Login/refresh/logout |
| `api-backend/src/surfaces/dashboard/auth.ts` | Dashboard auth middleware + RBAC |
| `api-backend/src/surfaces/workers/main.ts` | All BullMQ workers |
| `api-backend/src/lib/auth/verify-jwt.ts` | JWT verification |
| `api-backend/src/lib/db/pool.ts` | Postgres pool |
| `api-backend/src/lib/redis.ts` | Redis connection |
| `frontend/src/App.tsx` | All routes |
| `frontend/src/lib/api.ts` | HTTP client |
| `frontend/src/components/AppShell.tsx` | Layout shell |
| `api-backend/src/config/env.ts` | Env loading |
| `migrations/` | 62 SQL migrations |

---

# Important Workflows

- **Login**: Frontend → `/api/auth/login` → Supabase → httpOnly cookie + localStorage token
- **Token refresh**: 401 → `/api/auth/refresh` (cookie) → new token → retry
- **Click**: Host header → Redis offer config → checks → BullMQ enqueue → 302
- **Conversion**: `/postback` → Redis attribution lookup → append-only ledger → outbound postback
- **Multi-tenancy**: Every query filtered by `network_id` (JWT or host header)
- **Portal access**: Publisher/advertiser further scoped by `owner_id`

---

# Environment Variables

### Backend (required)
- `DATABASE_URL`, `REDIS_URL`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `PLATFORM_ADMIN_JWT_SECRET`

### Backend (optional)
- `SENTRY_DSN`, `ANTHROPIC_API_KEY`, `MAXMIND_LICENSE_KEY`
- `CLICK_RETENTION_DAYS` (90), `CONVERSION_RETENTION_DAYS` (400)
- `TRACKING_BASE_DOMAIN` (ourtracking.com)
- Surface ports: `PORT_DASHBOARD`, `PORT_TRACKING`, etc.

### Frontend
- `VITE_API_BASE_URL` (empty for dev proxy)

**No secrets in frontend. CI enforces this.**

---

# Known Constraints

- Two independently deployable repos (cannot share code)
- Brand name duplicated across repos
- Money always stored as `text` (never float)
- No ORM — all raw SQL via `pg`
- Hot path: `/click` must NEVER touch Postgres synchronously
- Tracking surface has NO auth (tenant by Host header)
- 62 migrations are raw SQL (node-pg-migrate)
- Frontend has NO test framework
- Phase 0 scaffold active; many route modules minimal

---

# Known Issues

1. **No frontend tests** — CI runs typecheck + lint + build only
2. **Smart link PG read** on tracking surface (documented departure from hot-path rule)
3. **Money as text** requires careful handling everywhere
4. **Redis cache staleness** risk on offer updates (needs verification)
5. **Queue connection leak risk** if `makeQueueConnection()` called repeatedly without close
6. **Two brand name sources** of truth across repos
7. **Phase 0 scaffold** — many route modules are empty/minimal stubs
8. **`dashboardMock.ts`** contains mock data that should be removed

---

# Development Commands

```bash
# Infra
docker compose up -d redis postgres

# Backend
cd api-backend && cp .env.example .env
npm install && npm run migrate && npm run dev
npm run dev:dashboard # single surface
npm test # vitest
npm run test:isolation # cross-tenant tests
npm run seed:rich # rich seed data

# Frontend
cd frontend && cp .env.example .env
npm install && npm run dev
npm run build # production
npm run lint # eslint
```

---

# Deployment

- Docker-portable, cloud-agnostic
- Per-surface containers (5 independently scalable)
- Local dev: Docker Compose (Redis + Postgres)
- Staging/prod: Supabase Postgres pooler, hosted Redis
- CI: GitHub Actions (secret scan → typecheck → lint → migrate → test → build)

---

# Rules for Future Changes

1. **Do not modify frontend** from backend tasks (and vice versa) unless required
2. **Follow existing patterns**: route module per feature, zod validation, envelope responses
3. **Never modify `tracking/app.ts` hot path** to touch Postgres synchronously
4. **Check existing route module** before adding new endpoints (use existing ones as template)
5. **Money values are text** — never use float/number for monetary amounts
6. **Every query filters by network_id** — never write cross-tenant queries
7. **No secrets in frontend** — CI enforces this
8. **Frontend routes are lazy-loaded** — new pages need `React.lazy()` + `Suspense`
9. **Follow existing naming**: `<feature>/routes.ts` for dashboard, `<feature>/routes.ts` for platform-admin
10. **Commit on feature branch** — never to main directly
