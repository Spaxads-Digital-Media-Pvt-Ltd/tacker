# Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend Framework** | React | 18.3 | UI rendering |
| **Frontend Language** | TypeScript | 5.5 | Type safety |
| **Frontend Bundler** | Vite | 5.3 | Dev server + build |
| **Frontend Styling** | Tailwind CSS | 3.4 | Utility-first CSS |
| **Frontend Routing** | React Router | 6.26 | Client-side routing with lazy loading |
| **Frontend Icons** | lucide-react | 1.24 | Icon library |
| **Frontend Spreadsheet** | xlsx | 0.18.5 | Excel export |
| **Frontend Auth** | @supabase/supabase-js | 2.45 | **Not used by SPA directly** — backend only |
| **Frontend Ngrok** | ngrok | 5.0-beta | Dev tunneling (future tunneling use) |

| **Backend Runtime** | Node.js | ≥20 | Server runtime |
| **Backend Language** | TypeScript | 5.5 | Type safety (ESM) |
| **Backend HTTP (admin)** | Express | 4.19 | Dashboard + Public API + Platform Admin |
| **Backend HTTP (hot)** | Fastify | 4.28 | Tracking surface (latency budget) |
| **Backend DB Driver** | pg | 8.12 | Raw PostgreSQL driver (no ORM) |
| **Backend Queue** | BullMQ | 5.12 | Background job processing (Redis-backed) |
| **Backend Cache** | ioredis | 5.4 | Config cache, dedup, caps, queue backend |
| **Backend Auth** | Supabase Auth | — | JWT issuance + verification |
| **Backend JWT Verify** | jose | 5.9 | JWKS + HS256 token verification |
| **Backend JWT Legacy** | jsonwebtoken | 9.0 | Legacy (not primary) |
| **Backend Validation** | zod | 3.23 | Runtime schema validation |
| **Backend AI** | @anthropic-ai/sdk | 0.68 | AI ops layer (Phase 7) |
| **Backend Error Tracking** | @sentry/node | 8.26 | Error reporting (optional) |
| **Backend GeoIP** | maxmind | 4.3 | MaxMind GeoIP2 lookups |
| **Backend Email** | nodemailer | 9.0 | Outbound email |
| **Backend Logging** | pino + pino-http | 9.3/10.2 | Structured logging |
| **Backend Metrics** | prom-client | 15.1 | Prometheus metrics |
| **Backend UA Parse** | ua-parser-js | 1.0 | User agent parsing |
| **Backend Security** | helmet | 7.1 | Security headers (Express) |
| **Backend Cookies** | cookie-parser | 1.4 | Cookie parsing (refresh tokens) |
| **Backend DB Migrations** | node-pg-migrate | 7.6 | SQL migrations |
| **Backend Dev** | tsx | 4.16 | TypeScript execution + watch |
| **Backend Dev** | concurrently | 8.2 | Run all surfaces in one terminal |

| **Database** | PostgreSQL | 16 | Primary datastore |
| **Cache/Queue** | Redis | 7 | Config cache, dedup, caps, BullMQ |
| **Auth Provider** | Supabase Auth | — | JWT issuer/verifier |
| **Error Tracking** | Sentry | — | Error reporting (optional) |
| **Geo Data** | MaxMind GeoIP2 | — | IP geolocation (optional) |
| **AI** | Anthropic Claude | — | AI ops (Phase 7) |
| **Social CAPI** | Facebook CAPI | — | Conversion events (Phase 3+) |

| **Dev/CI** | Technology | Version | Purpose |
|---|---|---|---|
| **Test Runner** | vitest | 2.0 | Unit + integration tests |
| **Load Test** | autocannon | 7.15 | Click path load testing |
| **Linting** | eslint | 8.57 | Code linting |
| **Package Manager** | npm | — | Dependency management |
| **CI** | GitHub Actions | — | Secret scan + backend tests + frontend build |
| **Container** | Docker Compose | — | Local dev (Redis + Postgres) |
| **Tunneling** | ngrok | 5.0-beta | Expose localhost for remote testing |
