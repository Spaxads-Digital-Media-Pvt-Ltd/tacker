# Important Files

## Critical
| File | Importance | Purpose |
|---|---|---|
| `api-backend/src/surfaces/tracking/app.ts` | Critical | Tracking hot path — click, postback, pixel, iframe, smart link |
| `api-backend/src/surfaces/dashboard/app.ts` | Critical | Dashboard route assembly (50+ feature routes) |
| `api-backend/src/surfaces/dashboard/auth-routes.ts` | Critical | Login/refresh/logout — the only auth entry points |
| `frontend/src/App.tsx` | Critical | All frontend routes (lazy-loaded) |
| `frontend/src/main.tsx` | Critical | Frontend entry point + provider setup |
| `frontend/src/auth/AuthContext.tsx` | Critical | Frontend auth state management |
| `api-backend/src/config/env.ts` | Critical | Typed environment loading (fail-fast) |

## High
| File | Importance | Purpose |
|---|---|---|
| `api-backend/src/lib/auth/verify-jwt.ts` | High | JWT verification (Supabase JWKS + HS256) |
| `api-backend/src/lib/db/pool.ts` | High | Postgres connection pool |
| `api-backend/src/lib/redis.ts` | High | Redis connection (cache + queue) |
| `api-backend/src/lib/http/express-app.ts` | High | Shared Express scaffolding (helmet, logging, envelope) |
| `api-backend/src/surfaces/dashboard/auth.ts` | High | Dashboard auth middleware + RBAC |
| `api-backend/src/surfaces/workers/main.ts` | High | Background workers (BullMQ processors) |
| `api-backend/src/surfaces/public-api/app.ts` | High | Public REST API assembly |
| `api-backend/src/surfaces/tracking/click-job.ts` | High | Click job enqueue for async persistence |
| `api-backend/src/surfaces/tracking/conversions/record.ts` | High | Core conversion recording logic |
| `api-backend/src/surfaces/tracking/offer-cache.ts` | High | Redis offer config cache (hot path) |
| `api-backend/src/surfaces/tracking/macros.ts` | High | Macro token build + substitution |
| `frontend/src/lib/api.ts` | High | HTTP client (Bearer + envelope + auto-refresh) |
| `frontend/src/lib/authClient.ts` | High | Login/logout/refresh — backend auth bridge |
| `frontend/src/components/AppShell.tsx` | High | Main layout shell (sidebar, header, flyouts) |
| `frontend/src/components/nav.ts` | High | Per-role navigation definition |
| `frontend/src/auth/ProtectedRoute.tsx` | High | Role-gated route wrapper |
| `frontend/src/index.css` | High | Design tokens (Sora + Space Mono, teal/slate palette) |
| `api-backend/migrations/` | High | All 62 SQL migrations (schema source of truth) |
| `api-backend/src/domain/entities.ts` | High | TypeScript interfaces for DB row shapes |

## Medium
| File | Importance | Purpose |
|---|---|---|
| `api-backend/src/middleware/host-resolver.ts` | Medium | Tenant resolution from tracking domain |
| `api-backend/src/lib/apikeys/keys.ts` | Medium | API key generation + hashing |
| `frontend/src/lib/reportFilters.ts` | Medium | Report filter catalog (Trackog-compatible) |
| `frontend/src/lib/useApi.ts` | Medium | useQuery / useMutation hooks |
| `frontend/src/components/ReportPageKit.tsx` | Medium | Shared report page scaffold |
| `frontend/src/components/ui.tsx` | Medium | UI primitive components (shadcn-style) |
| `api-backend/src/lib/ledger/` | Medium | Append-only money ledger |
| `api-backend/src/lib/fraud/` | Medium | Fraud rules + scan logic |
| `api-backend/src/lib/integrations/facebook-capi.ts` | Medium | Facebook CAPI integration |
| `docker-compose.yml` | Medium | Local dev infra (Redis + Postgres) |
| `CONTRIBUTING.md` | Medium | Branch workflow rules |
| `.github/workflows/ci.yml` | Medium | CI pipeline (secret scan + tests + build) |
