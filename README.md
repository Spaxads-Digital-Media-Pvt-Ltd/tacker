# Tracker

> **Working name — renameable.** The brand string lives in exactly one place per repo
> (`src/config/branding.ts`). Change it there; everything else derives from it. See spec §14.

Multi-tenant affiliate tracking SaaS (click tracking, conversion attribution, append-only
money ledger, reporting, and an AI ops layer). Comparable to Trackier / Everflow.

## Repositories (two, independently deployable — spec §0)

| Path          | What it is                                                                 |
|---------------|---------------------------------------------------------------------------|
| `api-backend` | All server-side logic: tracking hot-path, Dashboard API, Public REST API, platform-admin, workers. Owns all data + secrets. |
| `frontend`    | React SPA (UI only). Talks to the backend **exclusively over HTTP**. No DB access, no secrets. |

**Absolute rule:** the frontend never touches Postgres/Redis/Supabase-DB directly. Every
byte reaches the browser through an authenticated, authorized backend HTTP call.

## Phase status

- [x] **Phase 0 — Foundation** (this scaffold): two repos, five segregated backend surfaces,
      tenant + owner middleware, env/branding, Docker Compose, migration tooling, CI stubs,
      isolation test harness.
- [ ] Phase 1 — Entity model & Dashboard API
- [ ] Phase 1A — Super Admin & onboarding
- [ ] Phase 2 — Click path (hot)
- [ ] Phase 3 — Conversions (S2S → pixel → iframe)
- [ ] Phase 4 — Ledger & payouts
- [ ] Phase 4A — Public REST API & API keys
- [ ] Phase 5 — Reporting
- [ ] Phase 6 — Fraud & alerts
- [ ] Phase 7 — AI ops layer
- [ ] Phase 8 — Scale & harden

## Locked Phase-0 decisions

- **Cloud target:** Docker-portable; host chosen at Phase 8.
- **Click volume:** < 1M/day. Postgres aggregation now; ClickHouse deferred behind the
  analytics interface (`AnalyticsWriter`).
- **Frontend:** single React SPA, role-gated areas. Authorization always enforced server-side.
- **Access surfaces:** all four logins (super-admin, operator, publisher, advertiser) + API keys.
- **Auth:** Supabase Auth issues/verifies JWTs; all authorization is server-side in Express.
- **Primary conversion method:** S2S postback.

## Local development

```bash
# 1. Infra (Redis; Postgres for local dev in place of hosted Supabase)
docker compose up -d redis postgres

# 2. Backend
cd api-backend && cp .env.example .env   # fill in values
npm install && npm run migrate && npm run dev

# 3. Frontend
cd frontend && cp .env.example .env
npm install && npm run dev
```

Health checks: every backend surface exposes `GET /health`. See `api-backend/README` details
in `memory.md`.

## Project memory

`memory.md` (gitignored, one at workspace root) records structure, decisions, conventions,
env-var inventory (names only), and gotchas. **Read it first** when resuming or debugging.
# tacker
