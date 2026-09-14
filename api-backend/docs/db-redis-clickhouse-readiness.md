# Database / Redis / ClickHouse Production Readiness Audit

**Audit Date:** 2026-01-19
**Branch:** dev-gauri
**Auditor:** Systematic inspection
**Scope:** Postgres, Redis, ClickHouse infrastructure — connections, migrations, retention, backups, health checks, indexing

---

## Executive Summary

| Component | Status | Critical Gaps |
|-----------|--------|---------------|
| Postgres Migrations | PASS | 1 |
| ClickHouse Migrations | PASS | 1 |
| Connection Pooling | PASS | 2 |
| Redis | PASS | 3 |
| ClickHouse | PASS | 3 |
| Data Retention | PASS | 3 |
| Health Endpoints | NEEDS_ACTION | 5 |
| Backup / Recovery | NEEDS_ACTION | 3 |
| Index Coverage | NEEDS_ACTION | 1 |

**Verdict: Infrastructure is in place and functional for development/staging, but several production-critical gaps — backup strategy, health check depth, and pool sizing — must be resolved before production cutover.**

---

## Postgres Migrations

**Status: PASS**

63 Postgres migrations exist in `api-backend/migrations/` (1700000000000 through 1700000061000). Covers networks, users, parties, offers, clicks, conversions, ledger, smart links, tracking domains, API keys, invoices, fraud, AI, traffic controls, segmentations, automation, and platform admin local auth.

`node-pg-migrate` is used with a full script suite in `package.json`:
- `npm run migrate` — apply pending migrations
- `npm run migrate:down` — rollback last batch
- `npm run migrate:create` — scaffold new migration

3 ClickHouse migrations exist in `api-backend/clickhouse/migrations/`:
- `0000_database.sql` — idempotent database creation
- `0001_clicks.sql` — `clicks` table (ReplacingMergeTree, monthly partitions, 24-month TTL)
- `0002_conversions.sql` — `conversions` table (same engine family)

ClickHouse migration runner: `tsx src/lib/clickhouse/cli-migrate.ts` (invoked via `npm run migrate:clickhouse`).

### Gap: No migration drift detection or pre-deploy validation

There is no `migrate:status`, `migrate:validate`, or equivalent script to verify the applied migration set matches expectations before a deploy. A production deploy could apply migrations blindly with no confirmation of success or rollback capability.

### Recommendation

Add `npm run migrate:status` to verify applied vs. pending migrations. Wrap `npm run migrate` in a CI step that fails the pipeline if migration output contains errors.

---

## Connection Pooling

**Status: PASS (with gaps)**

### Postgres Pool

File: `lib/db/pool.ts`

- Single `pg.Pool` with `max: 20` (prod) / `10` (dev)
- 30s idle timeout, 5s connection timeout
- `application_name: 'tracker-api-backend'`
- Error event listener
- Exports: `query()`, `pingDb()`, `closeDb()`

### ClickHouse Pool

File: `lib/clickhouse/client.ts`

- `@clickhouse/client` singleton with `keep_alive: { enabled: true }`
- `max_open_connections` from `CLICKHOUSE_MAX_OPEN_CONNECTIONS` env var
- `pingClickHouse()`, `closeClickHouse()`, `createIsolatedClickHouseClient()` for tests
- URL redaction in logs

### Redis Pool

File: `lib/redis.ts`

- `ioredis` singleton via `getRedis()`, `lazyConnect: false` (eager connect at startup)
- Separate `makeQueueConnection()` factory for BullMQ (`maxRetriesPerRequest: null`)
- `pingRedis()`, `closeRedis()`
- Error event listener

### Gap 1: No pool sizing per-surface

All 5 surfaces (dashboard, tracking, public-api, platform-admin, workers) share a single Postgres pool with `max: 20`. During a reporting burst, the dashboard surface could exhaust the pool and starve the tracking surface. Per-surface pools (or at least per-surface pool targets with PgBouncer) are needed.

### Gap 2: No connection utilization metrics

No Prometheus/metrics export for active/idle/waiting pool connections. There is no way to detect pool exhaustion before it causes request failures.

### Recommendation

1. Add `prom-client` gauge for `pool.totalCount`, `pool.idleCount`, `pool.waitingCount` per surface (the codebase already uses `prom-client` per CLAUDE_MEMORY).
2. Deploy PgBouncer as a sidecar in production to enforce per-surface pool limits.
3. Set `CLICKHOUSE_MAX_OPEN_CONNECTIONS` to a safe value in production (document the current default vs. expected).

---

## Redis

**Status: PASS (with gaps)**

### Verified Capabilities

| Capability | Implementation |
|-----------|---------------|
| Config cache | Shared `getRedis()` client |
| Atomic cap counters | Shared client (single-node safe) |
| Dedup / idempotency | Shared client |
| BullMQ backend | `makeQueueConnection()` with `maxRetriesPerRequest: null` |
| Error handling | `error` event listener on both shared + queue connections |
| Health check | `pingRedis()` — PING → PONG |
| Graceful shutdown | `closeRedis()` — calls `quit()`, resets singleton |
| Error handling | Logs on `error` event |

### Gap 1: No Redis Sentinel / Cluster configuration

`ioredis` supports Sentinel (for HA failover) and Cluster (for sharding). Neither is configured. If the single Redis node fails, the tracking surface (cache-dependent) will degrade silently until reconnect succeeds.

### Gap 2: No key prefix strategy visible at connection layer

There is no visible key prefix/naming convention at the connection layer. This is not a functional bug but makes cache invalidation and debugging harder at scale.

### Gap 3: No memory-usage monitoring

Redis fills silently. There is no `INFO memory` polling or alerting on `used_memory` approaching `maxmemory`.

### Recommendation

1. Configure Sentinel in production (`new Redis([sentinel1, sentinel2], { sentinelOptions, password })`) or use a managed Redis cluster (ElastiCache, Upstash).
2. Add a key prefix constant (e.g., `TRACKER:`) applied consistently across all cache/counter code.
3. Add periodic `INFO memory` checks to the health endpoint or a dedicated monitoring job.

---

## ClickHouse

**Status: PASS (with gaps)**

### Verified Capabilities

| Capability | Implementation |
|-----------|---------------|
| Singleton client | `@clickhouse/client` v1.23.1, lazily created |
| Graceful degradation | `isClickHouseEnabled()` guards all callers; optional in env |
| Keep-alive | `keep_alive: { enabled: true }` |
| Fallback reporting | `ClickHouseWithFallbackReportingProvider` — CH first, PG on infra errors |
| Fail-fast behavior | Once CH marked unreachable (ECONNREFUSED, ETIMEDOUT, etc.), all subsequent calls go to PG for instance lifetime |
| Observability | Unexpected CH failures forwarded to Sentry via `captureError` |
| Structured logging | network_id, dimensions, date range, duration, provider used |
| Verification scripts | `scripts/verify-87.ts`, `scripts/verify-parity.ts`, `scripts/verify-failfast.ts` |
| Isolation for tests | `createIsolatedClickHouseClient()` for test/script isolation |
| URL redaction | Passwords redacted in pino logger |

### Verified Migration State

3 migrations:
1. Database creation (idempotent)
2. `clicks` table — ReplacingMergeTree, monthly partitions, 24-month TTL, 32 columns (network isolation, geo/device/fraud dimensions)
3. `conversions` table — same engine family, monthly partitions, 24-month TTL, denormalized attribution dimensions

### Gap 1: No ClickHouse HA / replica configuration

Single-node ClickHouse. No multi-replica or Distributed table setup. If the node goes down, the `clickhouse_with_fallback` mode silently switches to Postgres for all reporting — no alert fires, no automatic recovery.

### Gap 2: No access control / user management

ClickHouse migration 0000 creates the database. No users, roles, or quotas are configured beyond the default user. In a multi-tenant system, ClickHouse ACLs should restrict which database users can query which tables.

### Gap 3: No backup / recovery strategy

No documented ClickHouse backup procedure. ClickHouse supports `clickhouse-backup` tool and native `BACKUP TABLE` / `RESTORE TABLE`. Neither is configured or documented.

### Recommendation

1. Deploy ClickHouse with 2+ replicas using ReplicatedMergeTree; add a Distributed table for cross-replica queries.
2. Configure ClickHouse users/roles with minimum necessary permissions (separate read-only user for reporting workers).
3. Add `clickhouse-backup` to the infrastructure and schedule periodic full backups.

---

## Data Retention

**Status: PASS (with gaps)**

### Verified Implementation

File: `lib/retention/retention.ts`

- Batch deletes via `ctid` subselect — avoids long table locks
- Batch size: 5,000 rows, max 1,000 batches (5M rows/table/run safety valve)
- Clicks + postback_logs pruned at `CLICK_RETENTION_DAYS` (default 90)
- Conversions pruned at `CONVERSION_RETENTION_DAYS` (default 400)
- Ledger is NEVER touched (append-only)
- Logs summary of deleted counts

### Gap 1: No VACUUM after batch deletes

Batch deletes leave dead tuples that accumulate and degrade query performance. `VACUUM (ANALYZE)` is not called after retention runs.

### Gap 2: No partition-based deletion yet

The code comments document that partition-based `DROP PARTITION` is the planned scaling approach. Currently using row-by-row ctid batch deletes. This is safe but will become slow at scale (hundreds of millions of rows).

### Gap 3: No ClickHouse TTL verification

ClickHouse tables have 24-month TTL configured in migrations, but there is no job that verifies the TTL is actually enforced or that the partition cleanup is working.

### Recommendation

1. Run `VACUUM (ANALYZE)` on `clicks`, `conversions`, `postback_logs` after each retention run.
2. Convert `clicks` and `conversions` to monthly RANGE partitions on `created_at` and replace batch deletes with `DROP PARTITION` — this is documented as the intended path and should be prioritized before production scale.
3. Add a ClickHouse TTL verification job (monthly) that confirms old partitions are being dropped.

---

## Health Endpoints

**Status: NEEDS_ACTION**

File: `lib/http/health.ts`

### Verified

| Check | Implemented |
|-------|------------|
| Postgres ping | `pingDb()` — SELECT 1 |
| Redis ping | `pingRedis()` — PING → PONG |
| ClickHouse ping | `pingClickHouse()` — ping with `configured` / `healthy` distinction |
| Reporting provider mode | Reports `configured` vs `active` (postgres, clickhouse, clickhouse_with_fallback, postgres(fallback)) |
| Uptime | `process.uptime()` in seconds |
| Three-state status | `ok` / `degraded` / `unready` |

### Missing Checks

| Check | Risk |
|-------|------|
| Disk space on Postgres/ClickHouse volumes | Disks fill silently → writes fail → data loss |
| Memory pressure | OOM kills on containerized deploy |
| BullMQ queue depth | Backlog grows unbounded → processing lag → stale data |
| Database connection utilization | Pool exhaustion goes undetected until requests fail |
| TLS certificate expiry | Certificates expire → service interruption |
| Liveness vs. readiness split | Single endpoint cannot distinguish "process alive" from "ready to serve traffic" |

### Recommendation

1. Add `fs.statvfs` or equivalent for disk space check (flag degraded above 80%, unready above 95%).
2. Add BullMQ queue depth check — flag `degraded` if queue length exceeds a configurable threshold.
3. Split into `/healthz` (liveness — process alive) and `/readyz` (readiness — all dependencies healthy).

---

## Backup / Recovery

**Status: NEEDS_ACTION**

### Verified

- Docker Compose has named volumes: `pg-data`, `redis-data`, `clickhouse-data`
- Redis AOF persistence enabled (`--appendonly yes`)
- All services have health checks

### Missing

| Item | Risk |
|------|------|
| Automated Postgres backup | Volume loss = total data loss |
| pg_basebackup / pg_dump schedule | No point-in-time recovery (PITR) |
| ClickHouse backup | No tooling for CH restore |
| Backup verification | No test that restores from backup successfully |
| Off-site backup storage | Local volume loss takes everything |

### Recommendation

1. Add `pg_dump` or `pg_basebackup` to a cron job in production (daily full backup, WAL archiving for PITR).
2. Add `clickhouse-backup` tool for ClickHouse.
3. Store backups in a separate storage system (S3, GCS) — not on the same volume as the database.
4. Test restores quarterly — a backup that can't be restored is not a backup.

---

## Index Coverage

**Status: NEEDS_ACTION**

### Verified

First migration (`1700000000000_init-networks.sql`) creates:
- `networks_slug_key` (UNIQUE)
- `networks_status_idx`

Subsequent migrations (62 total) likely add indexes for foreign keys and common query patterns, but there is no documented index audit and no performance testing to validate that high-volume queries (click insertion, reporting aggregations, dedup checks) are hitting indexes efficiently.

### Gap: No index audit or EXPLAIN validation

At production scale with millions of rows, missing indexes on `clicks(created_at)`, `conversions(network_id, created_at)`, or `ledger_entries(network_id, created_at)` would cause full table scans and query timeouts.

### Recommendation

1. Run `EXPLAIN ANALYZE` on the top 10 most frequent query paths in a loaded staging environment.
2. Ensure `clicks.created_at`, `conversions.network_id + created_at`, and `ledger_entries.network_id + created_at` have appropriate indexes.
3. Document index coverage in a dedicated `docs/indexes.md` file.

---

## Recommendations Summary

| # | Priority | Recommendation |
|---|----------|---------------|
| 1 | Critical | Add automated Postgres backup (`pg_basebackup` + WAL archiving) with off-site storage |
| 2 | Critical | Add `/healthz` (liveness) and `/readyz` (readiness) split |
| 3 | Critical | Test restore from backup — a backup that can't be restored is not a backup |
| 4 | High | Convert retention from ctid batch deletes to partition-based `DROP PARTITION` before production scale |
| 5 | High | Add VACUUM (ANALYZE) after retention runs |
| 6 | High | Add Redis Sentinel or managed HA Redis in production |
| 7 | Medium | Add per-surface Postgres pool limits (PgBouncer sidecar or separate pools) |
| 8 | Medium | Add connection pool metrics (active/idle/waiting) via prom-client |
| 9 | Medium | Configure ClickHouse replicas + Distributed table for HA |
| 10 | Medium | Add disk space + BullMQ queue depth checks to health endpoint |
| 11 | Medium | Add `migrate:status` / pre-deploy validation for migration drift detection |
| 12 | Medium | Run EXPLAIN ANALYZE on top query paths and document index coverage |
| 13 | Low | Configure ClickHouse user/role access control |
| 14 | Low | Add `clickhouse-backup` tooling for ClickHouse |
| 15 | Low | Add ClickHouse TTL verification job |

---

*Audit performed via systematic inspection of connection layer code, migration files, retention logic, health endpoint, docker-compose, and package.json scripts. No automated load testing was performed.*
