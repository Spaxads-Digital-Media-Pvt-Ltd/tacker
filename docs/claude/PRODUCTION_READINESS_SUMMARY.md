# Production Readiness Fixes — Summary

**Branch:** `dev-gauri`
**Commits:** `88e1423`, `d34e849`, `dfa8ebf`
**Date:** 2026-09-14

---

## Overview

This document summarizes all fixes implemented from the production readiness audit. Across three commits, 8 gaps were closed across the following areas: health checks, database retention, connection pooling, backup automation, migration tooling, and observability.

---

## Fixes Implemented

### 1. Health Endpoint Split (`/healthz` + `/readyz`)
**Commit:** `88e1423` | **Priority:** Critical

All 5 surfaces now expose a standardised health contract:
- **`/healthz`** — liveness probe. Always 200 when the process is alive. Used by orchestrators (k8s livenessProbe) to decide whether to restart.
- **`/readyz`** — readiness probe. 200 when all dependencies are healthy, 503 otherwise. Used by orchestrators (k8s readinessProbe) to decide whether to route traffic.
- **`/health`** — backward-compat alias for `/readyz`.

Affected surfaces: dashboard, tracking, public-api, platform-admin, workers.

---

### 2. VACUUM After Retention Deletes
**Commit:** `88e1423` | **Priority:** Critical

Retention jobs now run `VACUUM (ANALYZE)` after any ctid-batch delete to reclaim dead tuples and update planner statistics. This prevents table bloat on high-churn tables.

---

### 3. Automated Postgres Backup
**Commit:** `88e1423` | **Priority:** Critical

New script at `scripts/backup-postgres.ts` produces compressed `pg_dump` custom-format backups. Usage: `npm run backup:postgres`.

---

### 4. Partition-Based Retention
**Commit:** `d34e849` | **Priority:** High

Postgres tables (`clicks`, `conversions`, `postback_logs`) were converted from plain tables to monthly **RANGE (LIST)** partitions on `created_at`.

- New migration: `1700000062000_partition-retention.sql`
- DROP PARTITION is O(1) vs the previous ctid-batch deletes that caused table bloat.
- Retention logic in `lib/retention/retention.ts` now drops whole-month partitions first, then uses ctid fallback only for partial months or the DEFAULT partition.
- Indexes rebuilt on the partitioned tables for efficient partition pruning.

---

### 5. Postgres Pool Metrics
**Commit:** `d34e849` | **Priority:** Medium

Added `getPoolStats()` to `lib/db/pool.ts` exposing total/idle/waiting connection counts from the pg Pool. Exposed as a `tracker_pg_pool` gauge in `lib/metrics.ts` with labels `state: [total, idle, waiting]`.

---

### 6. Health Endpoint Depth
**Commit:** `d34e849` | **Priority:** Medium

`/readyz` now includes:
- **Pool utilisation** — percentage of max pool slots in use.
- **Disk usage** — `usedPct`, `freeBytes`, `totalBytes` on the backing volume via `node:fs/statfs`.

---

### 7. `migrate:status` Script
**Commit:** `d34e849` | **Priority:** Medium

New `scripts/migrate-status.ts` reads the `pgmigrations` table and reports applied vs pending migrations. Usage: `npm run migrate:status`. Added to `package.json`.

---

### 8. BullMQ Queue Depth in Health Endpoint
**Commit:** `dfa8ebf` | **Priority:** Medium

`/readyz` now includes a `queues` field showing BullMQ backlog for all 7 queues (click-persist, outbound-postback, fraud-score, reconciliation, retention, facebook-capi, offer-feed-sync).

```json
"queues": {
 "click-persist": { "waiting": 0, "active": 3, "delayed": 0, "total": 3 },
 "outbound-postback": { "waiting": 1, "active": 0, "delayed": 0, "total": 1 }
}
```

Omitted when Redis is unreachable. Queue registry moved to `lib/queues.ts` (shared) to avoid circular imports.

---

## Files Changed

| File | Change |
|------|--------|
| `api-backend/src/lib/http/health.ts` | Health split + pool/disk/queue depth |
| `api-backend/src/lib/db/pool.ts` | `getPoolStats()` |
| `api-backend/src/lib/metrics.ts` | `tracker_pg_pool` gauge |
| `api-backend/src/lib/redis.ts` | Queue connection helper (pre-existing) |
| `api-backend/src/lib/queues.ts` | **NEW** — shared queue registry |
| `api-backend/src/lib/retention/retention.ts` | Partition-based retention + VACUUM |
| `api-backend/src/lib/integrations/enqueue.ts` | Updated import path |
| `api-backend/src/surfaces/workers/queues.ts` | Re-export from shared module |
| `api-backend/src/surfaces/workers/main.ts` | `/healthz` + `/readyz` |
| `api-backend/src/surfaces/tracking/app.ts` | `/healthz` + `/readyz` |
| `api-backend/src/surfaces/dashboard/main.ts` | Mount health routes |
| `api-backend/src/surfaces/public-api/main.ts` | Mount health routes |
| `api-backend/src/surfaces/platform-admin/main.ts` | Mount health routes |
| `api-backend/migrations/1700000062000_partition-retention.sql` | **NEW** — partition migration |
| `api-backend/scripts/backup-postgres.ts` | **NEW** — pg_dump backup script |
| `api-backend/scripts/migrate-status.ts` | **NEW** — migration status checker |
| `api-backend/package.json` | Add `backup:postgres`, `migrate:status` scripts |
| `docs/claude/PRODUCTION_READINESS_IMPLEMENTATION.md` | Work report |
| `docs/claude/STATUS_LOG.md` | Progress log |
