/**
 * Data retention / pruning (spec §7 storage, §11 data lifecycle). Raw clicks are the highest-volume
 * table and carry PII (IP, UA) — they get the shortest window. postback_logs are operational and
 * pruned with the click window. Conversions are FINANCIAL records referenced by the append-only
 * ledger, so they get a much longer default window and are pruned last; the ledger itself is NEVER
 * touched here (spec: append-only, no UPDATE/DELETE).
 *
 * THE LEDGER RULE (audit F-21): a conversion that ANY ledger entry references — its earning /
 * billing, and the reversal of either — is never pruned, whatever its age: the ledger is kept forever,
 * so the conversion it points at is too (tax / audit trails run 5–7 years and more). Only conversions
 * that never touched the ledger (rejected, never-approved, unattributed) age out with the window.
 * Clicks still prune on their window: nothing financial references a click — a conversion carries its
 * own payout / revenue / currency and the ledger references conversions, never clicks — so a pruned
 * click only takes its click-side detail (country, device, subs) out of row-level reports (the rollups
 * keep the aggregates, F-20).
 *
 * Windows are per network (Settings › Retention — networks.settings.retention.{clickDays,
 * conversionDays}; 0 = keep forever), falling back to CLICK_RETENTION_DAYS / CONVERSION_RETENTION_DAYS.
 * Each network is pruned on its own window through the (network_id, created_at) indexes.
 *
 * `clicks`, `conversions`, and `postback_logs` are regular tables (they must keep global unique
 * keys on click_id / conversion_id / (offer_id, transaction_id), which Postgres can't enforce on a
 * table partitioned by created_at — see migration 1700000064000). Pruning uses the bounded ctid
 * batch-delete path. The partition helpers below only act on a table that IS partitioned and are
 * otherwise no-ops.
 *
 * Per-run safety: at most 5M rows/table on the ctid fallback (BATCH * MAX_BATCHES).
 */
import { query } from '../db/pool.js';
import { env } from '../../config/env.js';
import { surfaceLogger } from '../logger.js';

const log = surfaceLogger('workers');
const BATCH = 5_000;
const MAX_BATCHES = 1_000; // safety valve: at most 5M rows/table/run on the ctid fallback

export interface RetentionResult {
 clicksDeleted: number;
 postbackLogsDeleted: number;
 conversionsDeleted: number;
 /** Names of partitions dropped (e.g. ["clicks_2024_01", "conversions_2024_01"]). */
 partitionsDropped: string[];
}

/** YYYYMM → integer month-key. Postgres partition naming uses `_YYYY_MM` (zero-padded). */
function monthKey(d: Date): { year: number; month: number } {
 return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Build the partition name used by Postgres for our monthly RANGE partitions. */
function partitionName(table: string, year: number, month: number): string {
 const mm = String(month).padStart(2, '0');
 return `${table}_${year}_${mm}`;
}

/**
 * Drop whole partitions older than `cutoff`. Returns the names of dropped partitions.
 *
 * Only operates on partitions whose UPPER bound is ≤ cutoff — a partition that straddles the
 * cutoff still contains some rows in window, so we leave it for the ctid fallback path.
 */
async function dropOldPartitions(table: 'clicks' | 'conversions' | 'postback_logs', cutoff: Date): Promise<string[]> {
 // Partitions are named `{table}_YYYY_MM`; the parent table also has `PARTITION DEFAULT` (named
 // after the parent table itself, with no year suffix). List partitions and their bounds.
 const rows = await query<{ partition_name: string; upper_bound: string | null }>(
 `SELECT child.relname AS partition_name, pg_get_expr(child.relpartbound, child.oid) AS upper_bound
 FROM pg_inherits i
 JOIN pg_class parent ON parent.oid = i.inhparent
 JOIN pg_class child ON child.oid = i.inhrelid
 WHERE parent.relname = $1
 ORDER BY child.relname`,
 [table],
 );

 const dropped: string[] = [];
 for (const r of rows.rows) {
 // Skip the DEFAULT partition (no range bound)
 if (r.upper_bound === null) continue;
 // Parse "FROM ('...') TO ('...')" — extract the upper bound as ISO timestamp
 const match = r.upper_bound.match(/TO \('([^']+)'\)/);
 if (!match) continue;
 const upperStr = match[1]!;
 const upper = new Date(upperStr);
 if (Number.isNaN(upper.getTime())) continue;
 if (upper.getTime() <= cutoff.getTime()) {
 try {
 await query(`DROP TABLE IF EXISTS "${r.partition_name}"`);
 dropped.push(r.partition_name);
 log.info({ table, partition: r.partition_name, upper: upper.toISOString() }, 'partition dropped');
 } catch (err) {
 log.error({ err, table, partition: r.partition_name }, 'partition drop failed');
 }
 }
 }
 return dropped;
}

/**
 * Ensure monthly partitions exist for the previous month, current month, and next month.
 * Without this, inserts would route to the DEFAULT partition, breaking future partition drops.
 *
 * Runs cheap, idempotent DDL — safe on every retention invocation.
 */
async function ensureMonthlyPartitions(): Promise<void> {
 const now = new Date();
 const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
 const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
 const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
 const monthAfter = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));

 const months = [lastMonth, thisMonth, nextMonth, monthAfter];
 for (const table of ['clicks', 'conversions', 'postback_logs'] as const) {
 const kind = await query<{ relkind: string }>(`SELECT relkind FROM pg_class WHERE oid = $1::regclass`, [table]);
 if (kind.rows[0]?.relkind !== 'p') continue;
 for (const m of months) {
 const { year, month } = monthKey(m);
 const name = partitionName(table, year, month);
 const startIso = m.toISOString();
 const endIso = new Date(Date.UTC(year, month, 1)).toISOString();
 // Idempotent: CREATE TABLE IF NOT EXISTS swallows already-exists.
 try {
 await query(
 `CREATE TABLE IF NOT EXISTS "${name}"
 PARTITION OF ${table}
 FOR VALUES FROM ('${startIso}') TO ('${endIso}')`,
 );
 } catch (err) {
 // Race against another worker that already created it — safe to ignore "already exists".
 const msg = (err as Error).message ?? '';
 if (!msg.includes('already exists')) {
 log.warn({ err, table, partition: name }, 'ensure partition failed');
 }
 }
 }
 }
}

/** Never prune a conversion any ledger entry references (THE LEDGER RULE above). */
const NOT_LEDGERED = `NOT EXISTS (SELECT 1 FROM ledger_entries le
 WHERE le.network_id = t.network_id AND le.conversion_id = t.conversion_id)`;

/**
 * Delete one network's rows older than `cutoff` in bounded ctid batches (never a long table lock),
 * through the (network_id, created_at) index. `extra` narrows what may go (the ledger rule).
 */
async function pruneNetwork(
 table: 'clicks' | 'postback_logs' | 'conversions',
 networkId: string,
 cutoff: Date,
 extra?: string,
): Promise<number> {
 let total = 0;
 for (let i = 0; i < MAX_BATCHES; i++) {
 const { rowCount } = await query(
 `DELETE FROM ${table}
 WHERE ctid IN (SELECT t.ctid FROM ${table} t
 WHERE t.network_id = $1 AND t.created_at < $2${extra ? ` AND ${extra}` : ''} LIMIT ${BATCH})`,
 [networkId, cutoff.toISOString()],
 );
 const n = rowCount ?? 0;
 total += n;
 if (n < BATCH) break;
 }
 return total;
}

function cutoff(days: number, now: Date): Date {
 return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface RetentionWindows {
 /** Clicks and postback logs, in days; 0 = keep forever. */
 clickDays: number;
 /** Conversions that never touched the ledger, in days; 0 = keep forever. */
 conversionDays: number;
}

/** A network's windows: its Settings › Retention values, else the env defaults. */
export function retentionWindows(settings: Record<string, unknown> | null | undefined): RetentionWindows {
 const r = (settings?.['retention'] ?? {}) as { clickDays?: unknown; conversionDays?: unknown };
 const days = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : dflt);
 return {
 clickDays: days(r.clickDays, env.CLICK_RETENTION_DAYS),
 conversionDays: days(r.conversionDays, env.CONVERSION_RETENTION_DAYS),
 };
}

export async function runRetention(now: Date = new Date()): Promise<RetentionResult> {
 const result: RetentionResult = {
 clicksDeleted: 0,
 postbackLogsDeleted: 0,
 conversionsDeleted: 0,
 partitionsDropped: [],
 };

 // 1. Make sure future-month partitions exist so inserts don't accumulate in DEFAULT.
 await ensureMonthlyPartitions();

 const networks = (await query<{ id: string; settings: Record<string, unknown> | null }>(
 'SELECT id, settings FROM networks ORDER BY id')).rows.map((n) => ({ id: n.id, ...retentionWindows(n.settings) }));

 // 2. Whole-month partition drops (only when a table is partitioned — today none is): click
 // partitions only past the LONGEST click window of any network (a partition holds every network's
 // rows); conversion partitions never (they can hold ledgered conversions — the ledger rule).
 const clickWindows = networks.map((n) => n.clickDays);
 if (clickWindows.length && clickWindows.every((d) => d > 0)) {
 const c = cutoff(Math.max(...clickWindows), now);
 const dropped = await dropOldPartitions('clicks', c);
 result.partitionsDropped.push(...dropped.filter((n) => n.startsWith('clicks_')));
 const droppedLogs = await dropOldPartitions('postback_logs', c);
 result.partitionsDropped.push(...droppedLogs.filter((n) => n.startsWith('postback_logs_')));
 }

 // 3. Each network on its own windows.
 for (const n of networks) {
 if (n.clickDays > 0) {
 const c = cutoff(n.clickDays, now);
 result.clicksDeleted += await pruneNetwork('clicks', n.id, c);
 result.postbackLogsDeleted += await pruneNetwork('postback_logs', n.id, c);
 }
 if (n.conversionDays > 0) {
 result.conversionsDeleted += await pruneNetwork('conversions', n.id, cutoff(n.conversionDays, now), NOT_LEDGERED);
 }
 }

 log.info(
 { ...result, networks: networks.length },
 'retention prune complete (ledgered conversions kept; ledger untouched — append-only)',
 );

 // VACUUM only when the fallback path deleted rows (partition drops do not produce dead tuples).
 if (result.clicksDeleted > 0 || result.conversionsDeleted > 0) {
 await vacuumAfterRetention(result);
 }

 return result;
}

/** VACUUM (ANALYZE) tables whose DEFAULT partition lost rows so the planner has fresh stats. */
async function vacuumAfterRetention(result: RetentionResult): Promise<void> {
 const tables: Array<'clicks' | 'conversions' | 'postback_logs'> = [];
 if (result.clicksDeleted > 0) tables.push('clicks', 'postback_logs');
 if (result.conversionsDeleted > 0) tables.push('conversions');

 for (const table of tables) {
 try {
 await query(`VACUUM (ANALYZE) ${table}`);
 log.info({ table }, 'vacuum complete');
 } catch (err) {
 log.error({ err, table }, 'vacuum failed');
 }
 }
}
