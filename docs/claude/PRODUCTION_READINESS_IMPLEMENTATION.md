# Production Readiness Implementation — Section 2 & 3

**Date:** 2026-09-14
**Branch:** dev-gauri
**Commits:** `1e2139c`, `372758c`, `88e1423`, `d34e849`, `dfa8ebf`

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
| Postgres migrations | PASS | 1 |
| ClickHouse migrations | PASS | 1 |
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

## Batch 1: Critical Fixes (`88e1423`)

### 1. Health Endpoint Split: `/healthz` + `/readyz`

| Endpoint | Purpose | Response | Use case |
|----------|---------|----------|----------|
| `/healthz` | Liveness — process can answer | Always 200 | k8s livenessProbe |
| `/readyz` | Readiness — all dependencies healthy | 200 or 503 | k8s readinessProbe |
| `/health` | Backward-compatible alias for `/readyz` | 200 or 503 | Existing probes |

Files: `src/lib/http/health.ts` (added `buildLivenessReport`, `buildReadinessReport`, `mountHealthRoutes`), all 5 surfaces mounted.

### 2. VACUUM After Retention

`vacuumAfterRetention()` in `src/lib/retention/retention.ts`. Runs `VACUUM (ANALYZE)` on tables that had deletions. Zero overhead on no-op runs.

### 3. Automated Postgres Backup

New `scripts/backup-postgres.ts` — `pg_dump` custom format with compression, timestamped filenames, auto-pruning (default 7 days). Usage: `npm run backup:postgres`

---

## Batch 2: High/Medium Priority Fixes (`d34e849`)

### 4. Partition-Based Retention (High Priority)

**Problem:** ctid batch deletes are O(n) with vacuum pressure.

**Solution:**
- Migration `1700000062000_partition-retention.sql` converts `clicks`, `conversions`, `postback_logs` to monthly RANGE partitions
- Updated `retention.ts`:
 - `ensureMonthlyPartitions()` — idempotently creates partitions for last/current/next/following months
 - `dropOldPartitions()` — drops whole-month partitions older than cutoff (O(1))
 - `pruneDefaultOlderThan()` — ctid fallback for partial months and DEFAULT partition
 - VACUUM only when ctid fallback deleted rows

### 5. Postgres Pool Metrics (Medium Priority)

- `getPoolStats()` in `src/lib/db/pool.ts` exports `total/idle/waiting`
- `tracker_pg_pool` gauge in `src/lib/metrics.ts`
- Pool utilization included in `/readyz` response

### 6. Health Endpoint Depth — Disk + Pool (Medium Priority)

`/readyz` now includes:
- `pool`: { total, idle, waiting, utilization }
- `disk`: { path, usedPct, freeBytes, totalBytes } from `fs.statfs()`

### 7. migrate:status Script (Medium Priority)

New `scripts/migrate-status.ts` — lists applied vs pending migrations. Usage: `npm run migrate:status`

---

## Remaining Gaps

| Priority | Gap |
|----------|-----|
| Medium | Per-surface Postgres pool limits (PgBouncer sidecar) |
| Medium | ClickHouse replicas + Distributed table |
| Medium | Run EXPLAIN ANALYZE on top query paths and document indexes |
| Low | ClickHouse user/role access control |
| Low | clickhouse-backup tooling |
| Low | ClickHouse TTL verification job |

---

## Files Changed

| File | Change |
|------|--------|
| `docs/claude/MULTI_TENANT_ISOLATION_AUDIT.md` | **NEW** |
| `api-backend/docs/db-redis-clickhouse-readiness.md` | **NEW** |
| `api-backend/migrations/1700000062000_partition-retention.sql` | **NEW** |
| `api-backend/scripts/migrate-status.ts` | **NEW** |
| `api-backend/src/lib/retention/retention.ts` | +105 lines — partition retention |
| `api-backend/src/lib/http/health.ts` | +38 lines — disk + pool |
| `api-backend/src/lib/db/pool.ts` | +6 lines — `getPoolStats()` |
| `api-backend/src/lib/metrics.ts` | +9 lines — `tracker_pg_pool` gauge |
| `api-backend/src/surfaces/dashboard/main.ts` | Mount health routes |
| `api-backend/src/surfaces/public-api/main.ts` | Mount health routes |
| `api-backend/src/surfaces/platform-admin/main.ts` | Mount health routes |
| `api-backend/src/surfaces/tracking/app.ts` | `/healthz` + `/readyz` |
| `api-backend/src/surfaces/workers/main.ts` | `/healthz` + `/readyz` |
| `api-backend/package.json` | Add `migrate:status` |
| `api-backend/scripts/backup-postgres.ts` | Fix import path |
| `api-backend/src/lib/queues.ts` | **NEW** — shared queue registry |
| `api-backend/src/lib/http/health.ts` | +26 lines — queue depth in readiness |
| `api-backend/src/lib/integrations/enqueue.ts` | Update import path |
| `api-backend/src/surfaces/workers/queues.ts` | Re-export from shared module |
