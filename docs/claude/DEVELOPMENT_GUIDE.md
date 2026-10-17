# Development Guide

## Prerequisites
- Node.js ≥ 20
- npm
- Docker + Docker Compose (for Redis + Postgres)
- Git

## Installation

```bash
# 1. Clone and install root dependencies
git clone <repo>
cd tacker

# 2. Start infrastructure
docker compose up -d redis postgres

# 3. Backend
cd api-backend
cp .env.example .env
# Edit .env: fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET,
# and SETTINGS_ENC_KEY (openssl rand -hex 32)
npm install
npm run migrate
npm run dev

# 4. Frontend (in another terminal)
cd frontend
cp .env.example .env
# Edit .env: set VITE_API_BASE_URL if needed (empty for dev proxy)
npm install
npm run dev
```

## Development Commands

### Backend (`api-backend/`)

| Command | Purpose |
|---|---|
| `npm run dev` | Start all 5 surfaces concurrently (dashboard, tracking, public-api, platform-admin, workers) |
| `npm run dev:dashboard` | Start dashboard only (Express :4001) |
| `npm run dev:tracking` | Start tracking only (Fastify :4002) |
| `npm run dev:public-api` | Start public API only (Express :4003) |
| `npm run dev:platform-admin` | Start platform admin only (Express :4004) |
| `npm run dev:workers` | Start workers only (:4005) |
| `npm run build` | Compile TypeScript |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm test` | Run tests |
| `npm run test:isolation` | Cross-tenant/cross-owner isolation tests |
| `npm run migrate` | Run pending migrations (up) |
| `npm run migrate:down` | Rollback last migration |
| `npm run migrate:create -j sql <name>` | Create new migration |
| `npm run seed` | Basic seed data |
| `npm run seed:rich` | Rich seed data (partners, offers, etc.) |
| `npm run seed:rich-modules` | Seed specific modules |
| `npm run seed:test-catalog [-- <slug>]` | A test catalog on YOUR network (default `test`), through the dashboard API as its admin (needs `SUPABASE_JWT_SECRET`): 5 advertisers, 5 partners with different postbacks (one pending), 15 offers — CPA / CPL / CPI / RevShare / CPS, GEO allow / block lists with per-country payouts, device-only, 2-event goals, private / ask, caps, duplicate rules, manual approval, paused — landing on public sites with `click_id` in the URL, plus a macro-echo offer (httpbin). Registers localhost as the network's tracking domain; prints the click links. Re-runnable (keeps what exists by name) |
| `npm run seed:demo-data` | Demo data for development |
| `npm run bootstrap:admin` | Create platform admin |
| `npm run provision:demo-admin` | Provision demo network admin |
| `npm run provision:demo-portals` | Provision demo publisher/advertiser portals |
| `npm run smoke` | Run all smoke tests |
| `npm run tunnel [-- <slug>]` | Public ngrok URL for the tracking surface (:4002), registered as a verified tracking domain for the network (default `demo`) — for external trackers' postbacks; prints the click and postback URL formats |

### Frontend (`frontend/`)

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Production build (tsc --noEmit + vite build) |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |

### Root

| Command | Purpose |
|---|---|
| `docker compose up -d redis postgres` | Start local infra |

## Build

### Backend
```bash
cd api-backend
npm run build
# Outputs to dist/ — each surface is independently deployable
npm run start:dashboard # node dist/surfaces/dashboard/main.js
npm run start:tracking # node dist/surfaces/tracking/main.js
npm run start:public-api # node dist/surfaces/public-api/main.js
npm run start:platform-admin # node dist/surfaces/platform-admin/main.js
```

### Frontend
```bash
cd frontend
npm run build
# Outputs to dist/ — static SPA, served by Express or CDN
```

## Test

### Backend
```bash
cd api-backend
npm test # vitest run
npm run test:isolation # Cross-tenant/cross-owner isolation tests
```

### Frontend
No test framework configured. CI runs: typecheck + lint + build.

## Lint

```bash
# Backend
cd api-backend && npm run lint

# Frontend
cd frontend && npm run lint
```

## Environment Setup

### Backend `.env`
Required:
- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — Redis connection string
- `SUPABASE_URL` — Supabase project URL (for JWKS)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase admin key (also file storage for offer thumbnails / creatives). With storage configured, run `npm run creatives:backfill` once (`-- --dry-run` to preview) to move creatives stored inline before F-27 into storage, and `npm run images:backfill` (same flags) for branding logos / favicons and profile photos stored inline before O12
- `SUPABASE_JWT_SECRET` — For HS256 test token verification
- `PLATFORM_ADMIN_JWT_SECRET` — Super admin JWT secret
- `SETTINGS_ENC_KEY` — Encryption key for settings secrets (32 bytes hex/base64). After first deploying it, run `npm run settings:secrets -- encrypt` once to encrypt values stored before (`decrypt` undoes it)

Optional:
- `SENTRY_DSN` — Error tracking
- `ANTHROPIC_API_KEY` — AI ops (Phase 7)
- `MAXMIND_LICENSE_KEY` — GeoIP2 updates
- `CLICK_RETENTION_DAYS` — Default 90
- `CONVERSION_RETENTION_DAYS` — Default 400

### Frontend `.env`
- `VITE_API_BASE_URL` — Empty for dev (uses Vite proxy); set for production

## Deployment

### Architecture
- **Docker-portable** — no hard dependency on a specific cloud
- **Per-surface containers** — each of the 5 surfaces is independently scalable
- **Local dev**: Docker Compose (Redis + Postgres)
- **Staging/prod**: Supabase Postgres (via pooler), hosted Redis

### Behind Cloudflare + AWS (client IPs)
Set `TRUSTED_PROXIES=private` on every surface so the visitor's IP (not the load balancer's) is used for
login rate limits, the API IP whitelist, audit logs, login history and click geo / fraud — Cloudflare's
ranges are trusted already. Allow only Cloudflare's ranges into the load balancer's security group.
Details: `api-backend/docs/cloudflare-edge.md` › "Client IP at the origin".

### Deploy checklist (each release)
1. **Secrets / env** (per surface; values never in git): `DATABASE_URL`, `REDIS_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (logins, invites, password resets, file storage), `SUPABASE_JWT_SECRET`,
   `PLATFORM_ADMIN_JWT_SECRET`, `SETTINGS_ENC_KEY` (32 bytes — `openssl rand -hex 32`; keep it: settings
   secrets can't be read without it), `IMPERSONATION_JWT_SECRET` (admin "Impersonate"; unset → 503),
   `DASHBOARD_ORIGINS` (CORS — and its first origin is the app address in invite / reset emails), SMTP per
   network (Settings), and behind Cloudflare + an AWS load balancer `TRUSTED_PROXIES=private` (next section).
2. **Migrate**: `npm run migrate` (node-pg-migrate, forward-only in production).
3. **One-off data steps** — idempotent, safe to re-run; preview each with `-- --dry-run` first:
   - `npm run settings:secrets -- encrypt` — encrypts integration credentials / SMTP passwords stored in
     plaintext before `SETTINGS_ENC_KEY` was set (D6; `decrypt` undoes it, e.g. before rotating the key).
   - `npm run creatives:backfill` and `npm run images:backfill` — move creatives (F-27) and branding
     logos / favicons / profile photos (O12) stored inline into object storage.
4. **Run every surface**, including **workers** (`start:workers`): emails, postbacks, scheduled reports,
   alert rules, SmartSwitch, rollups and retention all run there.
5. **After deploy**: sign in, send a test email (Communication Hub › Email Log shows it), check
   `/health` on each surface, and that a test click lands with the visitor's real IP (not the load balancer's).

### Surface Ports
| Surface | Port |
|---|---|
| Dashboard | 4001 |
| Tracking | 4002 |
| Public API | 4003 |
| Platform Admin | 4004 |
| Workers (health) | 4005 |

### CI/CD
- GitHub Actions (`ci.yml`):
 - Frontend: secret scan → install → typecheck → lint → build
 - Backend: spin up Postgres + Redis → install → typecheck → lint → migrate → isolation tests → tests

## Branch Workflow

```
main (protected — no direct pushes)
 └── <name>/<short-description> (feature branch)
 └── Pull Request → main
```

- Branch name format: `<name>/<short-description>` (e.g., `vivek/offers-everflow-parity`)
- Keep PRs small and merge often
- Pull `main` into your branch daily
- See `CONTRIBUTING.md` for full rules

## Development Conventions

- **ESM modules** everywhere (type: "module")
- **No ORM** — raw pg queries with zod validation
- **Raw SQL migrations** — `node-pg-migrate` with SQL files
- **Envelope pattern** — all API responses: `{ ok: true, data: T }` or `{ ok: false, error: { code, message } }`
- **zod validation** on all request bodies
- **Route-level code splitting** — every frontend page is `React.lazy()`
- **Per-route file colocation** — `surfaces/dashboard/<feature>/routes.ts`
- **Money as text** — never float for monetary values
- **Multi-tenancy** — every query filtered by `network_id` from JWT claims or host header
