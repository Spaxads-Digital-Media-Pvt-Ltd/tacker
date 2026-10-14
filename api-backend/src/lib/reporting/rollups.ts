/**
 * Reporting rollups (audit F-20): clicks and conversions pre-aggregated per 15-minute UTC bucket
 * (stats_clicks_15m / stats_conversions_15m — migration 072), maintained here by the reporting-rollup
 * worker and read by the Postgres provider (postgres.ts) for every bucket they're complete for.
 *
 * State: rollups are complete for buckets in [low_mark, high_mark), except buckets listed in
 * stats_dirty_buckets. Each run (every minute):
 *  1. freezes the buckets that are now older than FREEZE_MS: [high_mark, floor15(now − 3h)) is rolled
 *     up and high_mark moves up — in ONE transaction for all networks, so a reader never sees a mark
 *     ahead of its rows;
 *  2. re-rolls the dirty buckets inside the window (the clicks/conversions triggers mark a bucket
 *     dirty when a row lands in or changes in an already-old bucket — a late click, a conversion
 *     approved days later) and clears the marks;
 *  3. backfills one chunk below low_mark, down to backfill_floor (the oldest raw row when the rollups
 *     were first built).
 * Every step deletes and re-inserts whole buckets inside a transaction — idempotent, safe to re-run.
 * Rolled per network, so each scan uses the (network_id, created_at) indexes.
 */
import type { PoolClient } from 'pg';
import { pool, query } from '../db/pool.js';

export const BUCKET_MS = 15 * 60_000;
/** Buckets older than this are frozen into the rollups; newer ones are always read raw. */
export const FREEZE_MS = 3 * 3600_000;
const DEFAULT_BACKFILL_CHUNK_MS = 24 * 3600_000;
/** At most this much is frozen per run (after the worker was down the window catches up gradually;
 * meanwhile the not-yet-frozen part is simply read raw). */
const MAX_FREEZE_STEP_MS = 6 * 3600_000;
const DIRTY_BATCH = 500;
const STATE_ID = 'v1';
export const ORIGIN_SQL = `TIMESTAMPTZ '2000-01-01 00:00:00+00'`;
export const binSql = (col: string) => `date_bin('15 minutes', ${col}, ${ORIGIN_SQL})`;

export const floorBucket = (ms: number): number => Math.floor(ms / BUCKET_MS) * BUCKET_MS;

type Db = Pick<PoolClient, 'query'>;

async function networkIds(db: Db): Promise<string[]> {
  return (await db.query<{ id: string }>('SELECT id FROM networks ORDER BY id')).rows.map((r) => r.id);
}

/** Roll up one network's raw rows in [from, to) (whole buckets), replacing what was there. */
async function rollRange(db: Db, networkId: string, from: Date, to: Date): Promise<void> {
  const p = [networkId, from, to];
  await db.query('DELETE FROM stats_clicks_15m WHERE network_id = $1 AND bucket >= $2 AND bucket < $3', p);
  await db.query('DELETE FROM stats_conversions_15m WHERE network_id = $1 AND bucket >= $2 AND bucket < $3', p);
  await db.query(
    `INSERT INTO stats_clicks_15m (network_id, bucket, offer_id, publisher_id, smart_link_id, country, device,
                                   clicks, unique_clicks, invalid_clicks, fraud_score_sum)
     SELECT network_id, ${binSql('created_at')}, offer_id, publisher_id, smart_link_id, country, device,
            COUNT(*), COUNT(*) FILTER (WHERE is_unique), COUNT(*) FILTER (WHERE array_length(fraud_flags, 1) > 0),
            COALESCE(SUM(fraud_score), 0)
       FROM clicks
      WHERE network_id = $1 AND created_at >= $2 AND created_at < $3
      GROUP BY 1, 2, 3, 4, 5, 6, 7`, p);
  await db.query(
    `INSERT INTO stats_conversions_15m (network_id, bucket, offer_id, publisher_id, advertiser_id, smart_link_id, country,
                                        device, currency, total_conversions, conversions, payout, revenue)
     SELECT c.network_id, ${binSql('c.created_at')}, c.offer_id, c.publisher_id, c.advertiser_id,
            k.smart_link_id, k.country, k.device, c.currency,
            COUNT(*), COUNT(*) FILTER (WHERE c.status = 'approved'),
            COALESCE(SUM(c.payout) FILTER (WHERE c.status = 'approved'), 0),
            COALESCE(SUM(c.revenue) FILTER (WHERE c.status = 'approved'), 0)
       FROM conversions c LEFT JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
      WHERE c.network_id = $1 AND c.created_at >= $2 AND c.created_at < $3
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`, p);
}

async function inTx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

interface State { low_mark: Date; high_mark: Date; backfill_floor: Date | null }

/** First run: start an empty window at the freeze line; the backfill floor is the oldest raw row. */
async function initState(db: Db, now: Date): Promise<State> {
  const high = new Date(floorBucket(now.getTime() - FREEZE_MS));
  let oldest: number | null = null;
  for (const id of await networkIds(db)) {
    const { rows } = await db.query<{ m: Date | null }>(
      `SELECT LEAST((SELECT min(created_at) FROM clicks WHERE network_id = $1),
                    (SELECT min(created_at) FROM conversions WHERE network_id = $1)) AS m`, [id]);
    const m = rows[0]?.m;
    if (m && (oldest == null || m.getTime() < oldest)) oldest = m.getTime();
  }
  const floor = oldest == null ? high : new Date(Math.min(floorBucket(oldest), high.getTime()));
  await db.query(
    `INSERT INTO stats_rollup_state (id, low_mark, high_mark, backfill_floor) VALUES ($1, $2, $2, $3)
     ON CONFLICT (id) DO NOTHING`, [STATE_ID, high, floor]);
  return (await db.query<State>('SELECT low_mark, high_mark, backfill_floor FROM stats_rollup_state WHERE id = $1 FOR UPDATE', [STATE_ID])).rows[0]!;
}

export interface RollupRun { frozen: number; dirty: number; backfilled: boolean; low: Date; high: Date }

/** One maintenance run (the worker calls this every minute). */
export async function runRollup(now: Date = new Date(), opts: { backfillChunkMs?: number } = {}): Promise<RollupRun> {
  // 1. Freeze newly old buckets — all networks and the new high mark in one transaction.
  const s = await inTx(async (db) => {
    let st = (await db.query<State>('SELECT low_mark, high_mark, backfill_floor FROM stats_rollup_state WHERE id = $1 FOR UPDATE', [STATE_ID])).rows[0];
    st ??= await initState(db, now);
    const high = new Date(Math.min(floorBucket(now.getTime() - FREEZE_MS), st.high_mark.getTime() + MAX_FREEZE_STEP_MS));
    if (high > st.high_mark) {
      for (const id of await networkIds(db)) await rollRange(db, id, st.high_mark, high);
      await db.query('UPDATE stats_rollup_state SET high_mark = $2, updated_at = now() WHERE id = $1', [STATE_ID, high]);
      return { ...st, frozenFrom: st.high_mark, high_mark: high };
    }
    return { ...st, frozenFrom: st.high_mark };
  });
  const frozen = Math.round((s.high_mark.getTime() - s.frozenFrom.getTime()) / BUCKET_MS);

  // 2. Re-roll dirty buckets inside the window; marks outside it are moot (read raw / re-rolled later).
  const dirty = await inTx(async (db) => {
    await db.query('DELETE FROM stats_dirty_buckets WHERE bucket < $1 OR bucket >= $2', [s.low_mark, s.high_mark]);
    const { rows } = await db.query<{ network_id: string; bucket: Date }>(
      `DELETE FROM stats_dirty_buckets d
        WHERE (d.network_id, d.bucket) IN (
          SELECT network_id, bucket FROM stats_dirty_buckets
           WHERE bucket >= $1 AND bucket < $2 ORDER BY bucket LIMIT ${DIRTY_BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING d.network_id, d.bucket`, [s.low_mark, s.high_mark]);
    for (const r of rows) await rollRange(db, r.network_id, r.bucket, new Date(r.bucket.getTime() + BUCKET_MS));
    return rows.length;
  });

  // 3. Backfill one chunk below the low mark.
  const chunk = opts.backfillChunkMs ?? DEFAULT_BACKFILL_CHUNK_MS;
  const back = await inTx(async (db) => {
    const st = (await db.query<State>('SELECT low_mark, high_mark, backfill_floor FROM stats_rollup_state WHERE id = $1 FOR UPDATE', [STATE_ID])).rows[0]!;
    const floor = st.backfill_floor ?? st.low_mark;
    if (st.low_mark <= floor) return { done: false, low: st.low_mark };
    const start = new Date(Math.max(floor.getTime(), floorBucket(st.low_mark.getTime() - chunk)));
    for (const id of await networkIds(db)) await rollRange(db, id, start, st.low_mark);
    await db.query('UPDATE stats_rollup_state SET low_mark = $2, updated_at = now() WHERE id = $1', [STATE_ID, start]);
    return { done: true, low: start };
  });
  return { frozen, dirty, backfilled: back.done, low: back.low, high: s.high_mark };
}

export interface RollupWindow {
  /** Rollups are complete for buckets in [low, high) … */
  low: Date;
  high: Date;
  /** … except these buckets of this network (read raw). */
  dirty: Date[];
}

/** What the rollups can answer for a network right now (null = nothing yet → read raw). */
export async function rollupWindow(networkId: string): Promise<RollupWindow | null> {
  const { rows } = await query<{ low_mark: Date; high_mark: Date; dirty: Date[] | null }>(
    `SELECT s.low_mark, s.high_mark,
            (SELECT array_agg(d.bucket) FROM stats_dirty_buckets d
              WHERE d.network_id = $2 AND d.bucket >= s.low_mark AND d.bucket < s.high_mark) AS dirty
       FROM stats_rollup_state s WHERE s.id = $1`, [STATE_ID, networkId]);
  const s = rows[0];
  if (!s || s.low_mark >= s.high_mark) return null;
  return { low: s.low_mark, high: s.high_mark, dirty: s.dirty ?? [] };
}
