# Project Context

## Project Name
**Tracker** (working name — renameable). Single source: `frontend/src/config/branding.ts` (frontend) and `api-backend/src/config/branding.ts` (backend). Spec §14.

## Purpose
Multi-tenant affiliate tracking SaaS. Click tracking, conversion attribution, append-only money ledger, reporting, and an AI ops layer. Positioned as a Trackier/Everflow competitor.

## Main Users
| Role | Surface | Lands on |
|---|---|---|
| Super Admin (platform_admin) | `/admin/*` (tenant ops) | `/admin` |
| Network Admin (dashboard) | `/app/*` | `/app` |
| Publisher | `/publisher/*` portal | `/publisher` |
| Advertiser | `/advertiser/*` portal | `/advertiser` |
| External Code | REST API with API key | `/api/v1/*` |

## Application Type
Two-repository system (independently deployable):
- **`api-backend/`** — Express + Fastify + BullMQ; all server-side logic and data
- **`frontend/`** — React SPA (UI only); talks to backend exclusively over HTTP

## Frontend Technology
- React 18 + TypeScript 5
- Vite 5 (build, dev server, code-split)
- Tailwind CSS 3 + design tokens in `src/index.css` (RGB triples)
- React Router 6 (lazy-loaded routes)
- No external state management lib — `useState/useContext` + `localStorage`
- `@supabase/supabase-js` included as dep but the SPA never talks to Supabase directly

## Backend Technology
- Node 20+, TypeScript 5, ESM modules
- Express 4 (dashboard + public-api + platform-admin)
- Fastify 4 (tracking hot path — latency budget)
- pg 8 (raw driver, no ORM on the hot path)
- BullMQ 5 + ioredis 5 (queue + cache + dedup + caps)
- @supabase/supabase-js (admin client only, backend-only)
- Anthropic SDK (Phase 7 AI ops)
- zod 3 (request validation)

## Database
- **Postgres 16** (local docker; Supabase Postgres pooler in staging/prod via `DATABASE_URL`)
- 62 migrations in `api-backend/migrations/` (timestamped `1700000000000_*.sql`)
- Schema covers: networks, users, parties (advertisers/publishers), offers, tracking-domains, clicks, conversions, ledger (append-only money), api-keys, fraud-alerts, ai, audit-log, smart-links, segmentations, automations, control-center, etc.

## Authentication
| Login | Library | Token storage |
|---|---|---|
| Supabase JWT | `jose` (JWKS ES256) / `SUPABASE_JWT_SECRET` (HS256 test tokens) | localStorage `tracker.session.v2` (token); httpOnly `tracker_rt` cookie (refresh) |
| Platform admin | `PLATFORM_ADMIN_JWT_SECRET` (own gate) | per surface |
| API key | Per-audience prefix `adv_live_*` / `pub_live_*` / `net_live_*` | sha256 hashed server-side |

## Deployment
Docker-portable. Per-surface containers (the Segregation rule — spec §2.1, non-negotiable #10). Hosting choice deferred to Phase 8.

## Major Integrations
- **Supabase Auth** — JWT issuer
- **MaxMind GeoIP2** — `MAXMIND_LICENSE_KEY` (optional; fail-open if missing)
- **Sentry** — `SENTRY_DSN` (optional no-op)
- **Anthropic Claude** — AI ops layer (Phase 7)
- **Facebook CAPI** — outbound conversions
- **Offer feed sync** — outbound feed
- **ngrok** — dev tunneling

## Current Project Status
Phase 0 (Foundation) implemented; Phases 1–7 in various states of completion:
- Phase 0 ✅ Foundation (scaffold, all 5 segregated surfaces, migrations)
- Phase 1 ✅ Entity model & Dashboard API (offers/publishers/advertisers CRUD)
- Phase 1A ✅ Super Admin & onboarding
- Phase 2 ✅ Click path (hot)
- Phase 3 ✅ Conversions (S2S + pixel + iframe)
- Phase 4 ✅ Ledger & payouts
- Phase 4A ✅ Public REST API & API keys
- Phase 5 ✅ Reporting
- Phase 6 ✅ Fraud & alerts
- Phase 7 ✅ AI ops layer
- Phase 8 ⏳ Scale & harden (cloud choice deferred)

Check `README.md` for the canonical "Phase status" list.
