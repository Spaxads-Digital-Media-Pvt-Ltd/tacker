/**
 * Data retention / pruning (spec §7 storage, §11 data lifecycle). Raw clicks are the highest-volume
 * table and carry PII (IP, UA) — they get the shortest window. postback_logs are operational and
 * pruned with the click window. Conversions are FINANCIAL records referenced by the append-only
 * ledger, so they get a much longer default window and are pruned last; the ledger itself is NEVER
 * touched here (spec: append-only, no UPDATE/DELETE).
 *
 * Deletes run in bounded batches (by ctid) so a large purge never takes a long table lock or a
 * giant transaction — safe to run on a live hot-path table.
 *
 * Scaling path (documented, not yet implemented — pending the Phase 8 OLAP decision): once daily
 * volume warrants it, convert clicks/conversions to monthly RANGE partitions on created_at and
 * replace these batch deletes with DROP PARTITION (instant, no vacuum pressure). The retention
 * windows below map 1:1 onto "drop partitions older than N days".
 */
import { query } from '../db/pool.js';
import { env } from '../../config/env.js';
import { surfaceLogger } from '../logger.js';

const log = surfaceLogger('workers');
const BATCH = 5_000;
const MAX_BATCHES = 1_000; // safety valve: at most 5M rows/table/run

export interface RetentionResult {
  clicksDeleted: number;
  postbackLogsDeleted: number;
  conversionsDeleted: number;
}

/** Batch-delete rows in `table` older than `cutoff`. Returns total deleted. */
async function pruneOlderThan(table: 'clicks' | 'postback_logs' | 'conversions', cutoff: Date): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    // ctid subselect keeps each statement cheap and index-free on the delete path.
    const { rowCount } = await query(
      `DELETE FROM ${table}
        WHERE ctid IN (SELECT ctid FROM ${table} WHERE created_at < $1 LIMIT ${BATCH})`,
      [cutoff.toISOString()],
    );
    const n = rowCount ?? 0;
    total += n;
    if (n < BATCH) break; // drained
  }
  return total;
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runRetention(): Promise<RetentionResult> {
  const clickDays = env.CLICK_RETENTION_DAYS;
  const convDays = env.CONVERSION_RETENTION_DAYS;

  const result: RetentionResult = { clicksDeleted: 0, postbackLogsDeleted: 0, conversionsDeleted: 0 };

  if (clickDays > 0) {
    const c = cutoff(clickDays);
    result.clicksDeleted = await pruneOlderThan('clicks', c);
    result.postbackLogsDeleted = await pruneOlderThan('postback_logs', c);
  }
  if (convDays > 0) {
    result.conversionsDeleted = await pruneOlderThan('conversions', cutoff(convDays));
  }

  log.info(
    { ...result, clickDays, convDays },
    'retention prune complete (ledger untouched — append-only)',
  );
  return result;
}
