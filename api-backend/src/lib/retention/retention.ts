/**
 * Data retention / pruning (spec §7 storage, §11 data lifecycle). Raw clicks are the highest-volume
 * table and carry PII (IP, UA) — they get the shortest window. postback_logs are operational and
 * pruned with the click window. Conversions are FINANCIAL records referenced by the append-only
 * ledger, so they get a much longer default window and are pruned last; the ledger itself is NEVER
 * touched here (spec: append-only, no UPDATE/DELETE).
 *
 * `clicks`, `conversions`, and `postback_logs` are monthly RANGE-partitioned on `created_at`
 * (migration 1700000062000_partition-retention). Retention runs `DROP PARTITION` on partitions
 * fully older than the cutoff — this is O(1) on Postgres (catalog operation), generates zero
 * dead tuples, and needs no VACUUM afterwards.
 *
 * For partitions that straddle the cutoff boundary (i.e. the most recent month), we fall back to
 * the bounded ctid batch-delete path to avoid dropping rows that are still in window. The
 * `PARTITION_DEFAULT` partition holding pre-existing data is also pruned with ctid since it is
 * not month-bounded.
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

/**
 * ctid-batch fallback for the DEFAULT partition (pre-existing data + the partial current-month
 * partition). Bounded so we never hold a long table lock.
 */
async function pruneDefaultOlderThan(
 table: 'clicks' | 'postback_logs' | 'conversions',
 cutoff: Date,
): Promise<number> {
 let total = 0;
 for (let i = 0; i < MAX_BATCHES; i++) {
 const { rowCount } = await query(
 `DELETE FROM ${table}
 WHERE ctid IN (SELECT ctid FROM ${table} WHERE created_at < $1 LIMIT ${BATCH})`,
 [cutoff.toISOString()],
 );
 const n = rowCount ?? 0;
 total += n;
 if (n < BATCH) break;
 }
 return total;
}

function cutoff(days: number): Date {
 return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runRetention(): Promise<RetentionResult> {
 const clickDays = env.CLICK_RETENTION_DAYS;
 const convDays = env.CONVERSION_RETENTION_DAYS;

 const result: RetentionResult = {
 clicksDeleted: 0,
 postbackLogsDeleted: 0,
 conversionsDeleted: 0,
 partitionsDropped: [],
 };

 // 1. Make sure future-month partitions exist so inserts don't accumulate in DEFAULT.
 await ensureMonthlyPartitions();

 // 2. Drop whole-month partitions that are fully out of window (O(1), no vacuum pressure).
 if (clickDays > 0) {
 const c = cutoff(clickDays);
 const dropped = await dropOldPartitions('clicks', c);
 result.partitionsDropped.push(...dropped.filter((n) => n.startsWith('clicks_')));

 const droppedLogs = await dropOldPartitions('postback_logs', c);
 result.partitionsDropped.push(...droppedLogs.filter((n) => n.startsWith('postback_logs_')));

 // 3. Fallback for the partial current-month partition (and DEFAULT pre-existing data).
 result.clicksDeleted = await pruneDefaultOlderThan('clicks', c);
 result.postbackLogsDeleted = await pruneDefaultOlderThan('postback_logs', c);
 }
 if (convDays > 0) {
 const c = cutoff(convDays);
 const dropped = await dropOldPartitions('conversions', c);
 result.partitionsDropped.push(...dropped.filter((n) => n.startsWith('conversions_')));
 result.conversionsDeleted = await pruneDefaultOlderThan('conversions', c);
 }

 log.info(
 { ...result, clickDays, convDays },
 'retention prune complete (ledger untouched — append-only)',
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
