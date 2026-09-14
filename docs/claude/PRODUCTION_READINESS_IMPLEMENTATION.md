# Production Readiness Implementation — Section 2 & 3

**Date:** 2026-09-14
**Branch:** dev-gauri → main
**Commits:** `1e2139c`, `372758c`, `88e1423`

---

## Section 2: Multi-Tenant Isolation Audit (`1e2139c`)

### What was audited

Systematic inspection of all **51 route modules** across **5 surfaces** (dashboard, tracking, public-api, platform-admin, workers). Every query pattern was verified for `network_id` scoping.

### Finding: PASS — 0 isolation gaps

Four complementary layers enforce isolation:

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| 1 | `ScopedDb` structural enforcement (`lib/db/scoped-db.ts`) | Auto-injects `network_id` + optional `owner_id` into every query. Deny-by-default: throws if no `networkId`, throws if owner-scoped table queried without `ownerId`. |
| 2 | `TABLE_SCOPES` deny-by-default (`lib/db/table-registry.ts`) | 80+ registered tables. Throws on unregistered tables. |
| 3 | Explicit `network_id = $1` in raw SQL | All reporting engine queries, bulk operations, and raw queries use parameterized `network_id`. |
| 4 | Audience-aware DTOs | Publishers see payout only; advertisers see no payout; platform admins see cross-tenant aggregates by design. |

### Platform Admin exception

`platform-admin` surface is **intentionally NOT tenant-scoped** — it's the cross-tenant management surface (§3C spec). Tables `platform_admins` and `subscription_plans` are global.

### Documentation

[`docs/claude/MULTI_TENANT_ISOLATION_AUDIT.md`](docs/claude/MULTI_TENANT_ISOLATION_AUDIT.md)

---

## Section 3: Database / Redis / ClickHouse Readiness Audit (`372758c`)

### What was audited

Connection pooling, migrations, retention, health endpoints, ClickHouse fallback, backup strategy, and index coverage across all three datastores.

### Findings

| Component | Status | Gaps |
|-----------|--------|------|
| Postgres migrations (61 files) | PASS | 1 |
| ClickHouse migrations (3 files) | PASS | 1 |
| Connection pooling | PASS | 2 |
| Redis | PASS | 3 |
| ClickHouse | PASS | 3 |
| Data retention | PASS | 3 |
| Health endpoints | NEEDS_ACTION | 5 |
| Backup / Recovery | NEEDS_ACTION | 3 |
| Index coverage | NEEDS_ACTION | 1 |

**15 gaps identified** — 3 critical, 4 high, 5 medium, 3 low priority.

### Documentation

[`api-backend/docs/db-redis-clickhouse-readiness.md`](api-backend/docs/db-redis-clickhouse-readiness.md)

---

## Critical Fixes Implemented (`88e1423`)

Three of the 15 gaps were addressed (all critical priority).

### 1. Health Endpoint Split: `/healthz` + `/readyz`

**Problem:** Only tracking and workers had a `/health` endpoint. Dashboard, public-api, and platform-admin had none. A single `/health` endpoint cannot distinguish "process alive" from "ready to serve traffic."

**Solution:**

| Endpoint | Purpose | Response | Use case |
|----------|---------|----------|----------|
| `/healthz` | Liveness — process can answer | Always 200 | k8s livenessProbe (restart if fails) |
| `/readyz` | Readiness — all dependencies healthy | 200 or 503 | k8s readinessProbe (route traffic if ready) |
| `/health` | Backward-compatible alias for `/readyz` | 200 or 503 | Existing probes |

**Files changed:**

- [`src/lib/http/health.ts`](api-backend/src/lib/http/health.ts) — Added `buildLivenessReport()` (no DB calls, always 200) and `buildReadinessReport()` (full dependency checks). Added `mountHealthRoutes()` helper for Express surfaces.
- [`src/surfaces/dashboard/main.ts`](api-backend/src/surfaces/dashboard/main.ts) — Mounted via `mountHealthRoutes(app, 'dashboard')`
- [`src/surfaces/public-api/main.ts`](api-backend/src/surfaces/public-api/main.ts) — Mounted via `mountHealthRoutes(app, 'public-api')`
- [`src/surfaces/platform-admin/main.ts`](api-backend/src/surfaces/platform-admin/main.ts) — Mounted via `mountHealthRoutes(app, 'platform-admin')`
- [`src/surfaces/tracking/app.ts`](api-backend/src/surfaces/tracking/app.ts) — Added Fastify handlers for `/healthz` and `/readyz`
- [`src/surfaces/workers/main.ts`](api-backend/src/surfaces/workers/main.ts) — Added raw http handlers for `/healthz` and `/readyz`

**Readiness policy:**
- `ok` → 200 (all dependencies healthy)
- `degraded` → 200 (PG or Redis down, but fallback available)
- `unready` → 503 (critical dependency down, cannot serve)

### 2. VACUUM After Retention

**Problem:** Batch deletes leave dead tuples that accumulate and degrade query performance. No `VACUUM` was run after retention pruning.

**Solution:**

- Added `vacuumAfterRetention()` function in [`src/lib/retention/retention.ts`](api-backend/src/lib/retention/retention.ts)
- Runs `VACUUM (ANALYZE)` on tables that had deletions, only when deletions actually occurred
- Zero overhead when nothing was pruned
- Logs per-table vacuum results; errors caught and logged but don't fail the retention job

**Behavior:**
- Clicks deleted → VACUUM `clicks` + `postback_logs`
- Conversions deleted → VACUUM `conversions`
- Ledger never touched (append-only)

### 3. Automated Postgres Backup

**Problem:** No automated backup strategy. Volume loss = total data loss. No off-site storage.

**Solution:**

New file: [`scripts/backup-postgres.ts`](api-backend/scripts/backup-postgres.ts)

**Features:**
- `pg_dump --format=custom --compress=9 --no-owner --no-privileges`
- Timestamped filenames: `backup-2026-09-14T15-30-00.dump`
- Auto-prunes backups older than `BACKUP_RETENTION_DAYS` (default: 7 days)
- Credentials redacted in logs
- Errors thrown with clear messages; exit code 1 on failure

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (required) | Target database connection string |
| `BACKUP_DIR` | `./backups` | Directory for dump files |
| `BACKUP_RETENTION_DAYS` | `7` | Keep backups for this many days |

**Usage:**
```
npm run backup:postgres
```

**Cron example:**
```
0 2 * * * cd /app && npm run backup:postgres >> /var/log/backup.log 2>&1
```

---

## Remaining Gaps (Not Yet Implemented)

These are documented in [`api-backend/docs/db-redis-clickhouse-readiness.md`](api-backend/docs/db-redis-clickhouse-readiness.md) for future implementation:

| Priority | Gap |
|----------|-----|
| **High** | Convert retention from ctid batch deletes to partition-based `DROP PARTITION` |
| **High** | Add Redis Sentinel or managed HA Redis in production |
| **Medium** | Add per-surface Postgres pool limits (PgBouncer sidecar) |
| **Medium** | Add connection pool metrics via prom-client |
| **Medium** | Configure ClickHouse replicas + Distributed table |
| **Medium** | Add disk space + BullMQ queue depth to health checks |
| **Medium** | Add `migrate:status` for pre-deploy validation |
| **Medium** | Run EXPLAIN ANALYZE on top query paths and document indexes |
| **Low** | Configure ClickHouse user/role access control |
| **Low** | Add `clickhouse-backup` tooling |
| **Low** | Add ClickHouse TTL verification job |

---

## Files Changed Summary

| File | Change |
|------|--------|
| `docs/claude/MULTI_TENANT_ISOLATION_AUDIT.md` | **NEW** — 229 lines |
| `api-backend/docs/db-redis-clickhouse-readiness.md` | **NEW** — 333 lines |
| `api-backend/src/lib/http/health.ts` | +65 lines — liveness/readiness split |
| `api-backend/src/lib/retention/retention.ts` | +17 lines — VACUUM after retention |
| `api-backend/scripts/backup-postgres.ts` | **NEW** — 93 lines |
| `api-backend/src/surfaces/dashboard/main.ts` | Mount health routes |
| `api-backend/src/surfaces/public-api/main.ts` | Mount health routes |
| `api-backend/src/surfaces/platform-admin/main.ts` | Mount health routes |
| `api-backend/src/surfaces/tracking/app.ts` | Add `/healthz` + `/readyz` |
| `api-backend/src/surfaces/workers/main.ts` | Add `/healthz` + `/readyz` |
| `api-backend/package.json` | Add `backup:postgres` script |
