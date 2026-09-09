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
# Edit .env: fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
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
| `npm run seed:demo-data` | Demo data for development |
| `npm run bootstrap:admin` | Create platform admin |
| `npm run provision:demo-admin` | Provision demo network admin |
| `npm run provision:demo-portals` | Provision demo publisher/advertiser portals |
| `npm run smoke` | Run all smoke tests |
| `npm run tunnel` | Start ngrok tunnel |

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
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase admin key
- `SUPABASE_JWT_SECRET` — For HS256 test token verification
- `PLATFORM_ADMIN_JWT_SECRET` — Super admin JWT secret

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
