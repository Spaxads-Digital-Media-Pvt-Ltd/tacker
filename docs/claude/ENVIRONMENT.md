# Environment Variables

## Backend (`api-backend/.env`)

### Required
| Variable | Purpose | Type | Default |
|---|---|---|---|
| `NODE_ENV` | Environment mode | `development`/`test`/`production` | `development` |
| `LOG_LEVEL` | Log verbosity | `fatal`/`error`/`warn`/`info`/`debug`/`trace` | `info` |
| `DATABASE_URL` | PostgreSQL connection string | URL | `postgres://tracker:tracker_local_dev@localhost:5432/tracker` |
| `REDIS_URL` | Redis connection string | URL | `redis://localhost:6379` |

### Required for Auth
| Variable | Purpose | Default |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL (for JWKS) | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend admin key — **never leaves backend** | — |
| `SUPABASE_JWT_SECRET` | HS256 fallback for test tokens | — |
| `PLATFORM_ADMIN_JWT_SECRET` | Super admin JWT secret | — |
| `SETTINGS_ENC_KEY` | Encrypts integration credentials + the SMTP password in `networks.settings` (AES-256-GCM). 32 bytes as 64 hex chars or base64 (`openssl rand -hex 32`). **Required — boot fails without it.** Keep it stable and backed up: stored secrets can't be read without it | — |

### Optional
| Variable | Purpose | Default |
|---|---|---|
| `IMPERSONATION_JWT_SECRET` | Signs admin impersonation sessions (30 min). ≥32 chars (`openssl rand -hex 32`). Unset → "Impersonate" answers 503 | — |
| `TRACKING_BASE_DOMAIN` | Base for tenant subdomains | `ourtracking.com` |
| `TRACKING_RL_POSTBACK_PER_CLICK_LIMIT` | `/postback` rate limit per `click_id` (sliding 5-min window; each request is weighted by the buckets it touches, so 100 ≈ 20 postbacks for one click within a minute). Off in development/test | `100` |
| `TRACKING_TRUSTED_PROXIES` | Extra proxies (comma-separated IPv4/IPv6 IPs or CIDRs) allowed to set `X-Forwarded-For` on the tracking surface, e.g. an Nginx/LB not on the same host. Loopback + Cloudflare's published ranges are always trusted | — |
| `SENTRY_DSN` | Error tracking (no-op if absent) | — |
| `SENTRY_TRACES_SAMPLE_RATE` | Sentry trace sampling | `0` |
| `ANTHROPIC_API_KEY` | AI ops layer (Phase 7) | — |
| `MAXMIND_LICENSE_KEY` | GeoIP2 DB updates | — |
| `CLICK_RETENTION_DAYS` | Days to keep clicks before pruning | `90` |
| `CONVERSION_RETENTION_DAYS` | Days to keep conversions before pruning | `400` |
| `REPORTING_ROLLUPS` | `on` = the Postgres reporting provider reads the 15-minute rollups when a report fits them (F-20); `off` = raw tables only (the vitest config pins `off`) | `on` |

### Surface Ports
| Variable | Default | Description |
|---|---|---|
| `PORT_DASHBOARD` | `4001` | Dashboard API (admin + portals) |
| `PORT_TRACKING` | `4002` | Tracking hot path |
| `PORT_PUBLIC_API` | `4003` | Public REST API |
| `PORT_PLATFORM_ADMIN` | `4004` | Platform admin (super admin) |
| `PORT_WORKERS_HEALTH` | `4005` | Workers health probe |

## Frontend (`frontend/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | Empty (relative, uses Vite proxy in dev) |
| `VITE_FEATURE_SMARTSWITCH` | `true` shows the SmartSwitch module (rules are stored but not evaluated — `src/config/features.ts`) | unset = hidden (nav item inert, route absent) |

No secrets in the frontend. CI enforces no secret patterns in `frontend/` source.

## CI/CD

| Variable | Where Set | Purpose |
|---|---|---|
| `DATABASE_URL` | GitHub Actions | Postgres for tests |
| `REDIS_URL` | GitHub Actions | Redis for tests |
| `SUPABASE_JWT_SECRET` | GitHub Actions | Test JWT verification |
| `INTEGRATION_DB` | GitHub Actions | Redis DB number for tests |

## Docker Compose
Defined in `docker-compose.yml`:
- `POSTGRES_USER=tracker`
- `POSTGRES_PASSWORD=tracker_local_dev`
- `POSTGRES_DB=tracker`
- Redis: no auth, port 6379
