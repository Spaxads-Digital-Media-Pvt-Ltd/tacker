# Status Log

Tracks progress on the production readiness audit (`docs/db-redis-clickhouse-readiness.md`).

## Completed

| Date | Commit | Fix |
|------|--------|-----|
| 2026-09-14 | `88e1423` | Health endpoint split: `/healthz` (liveness) + `/readyz` (readiness) across all 5 surfaces |
| 2026-09-14 | `88e1423` | VACUUM (ANALYZE) after retention ctid deletes |
| 2026-09-14 | `88e1423` | Automated Postgres backup script (`npm run backup:postgres`) |
| 2026-09-14 | `d34e849` | Partition-based retention: monthly RANGE partitions with O(1) DROP PARTITION |
| 2026-09-14 | `d34e849` | Pool metrics: `getPoolStats()` + `tracker_pg_pool` gauge |
| 2026-09-14 | `d34e849` | Health endpoint depth: disk usage + pool utilization in readiness |
| 2026-09-14 | `d34e849` | `migrate:status` script for node-pg-migrate |
| 2026-09-14 | `dfa8ebf` | BullMQ queue depth check in health endpoint (audit gap #10) |

## Remaining (per audit)

| Priority | Gap |
|----------|-----|
| Medium | Per-surface Postgres pool limits (PgBouncer sidecar) |
| Medium | ClickHouse replicas + Distributed table |
| Medium | Run EXPLAIN ANALALYZE on top query paths and document indexes |
| Low | ClickHouse user/role access control |
| Low | clickhouse-backup tooling |
| Low | ClickHouse TTL verification job |
