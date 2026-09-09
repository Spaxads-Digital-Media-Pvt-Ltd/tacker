import { getClickHouse } from '../clickhouse/client';
import { pool } from '../db/pool';
import {
 mapPgClickToCh,
 mapPgConversionToCh,
 type PgClickRow,
 type PgConversionRow,
} from './backfill-mapper';

export interface BackfillOptions {
 from: string;
 to: string;
 networkId?: string;
 batchSize?: number;
 dryRun?: boolean;
}

export interface BackfillResult {
 clicks: { rows: number; batches: number; errors: number };
 conversions: { rows: number; batches: number; errors: number };
 durationMs: number;
}

const DEFAULT_BATCH_SIZE = 5000;

// ClickHouse DateTime64(3) JSONEachRow rejects `Z` suffix. Convert ISO to
// `YYYY-MM-DD HH:MM:SS.SSS` (UTC) to match what the writer's `parseDateTime64BestEffort`
// would accept on SELECT, and what CH accepts on INSERT.
function pgTimestampToCh(ts: string | Date): string {
 const d = ts instanceof Date ? ts : new Date(ts);
 const pad = (n: number, w = 2) => String(n).padStart(w, '0');
 return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
 `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
 `${pad(d.getUTCMilliseconds(), 3)}`;
}

async function backfillClicks(opts: BackfillOptions): Promise<{ rows: number; batches: number; errors: number }> {
 const ch = getClickHouse();
 const batchSize = opts.batchSize || DEFAULT_BATCH_SIZE;
 const { from, to, networkId, dryRun } = opts;

 let totalRows = 0;
 let totalBatches = 0;
 let totalErrors = 0;

 let lastCreatedAt: string | null = null;
 let lastId: string | null = null;

 while (true) {
 let where = 'WHERE created_at >= $1 AND created_at < $2';
 const params: (string | number)[] = [from, to];
 let pIdx = 2;

 if (networkId) {
 where += ` AND network_id = $${++pIdx}`;
 params.push(networkId);
 }

 if (lastCreatedAt && lastId) {
 where += ` AND (created_at, id) > ($${++pIdx}::timestamptz, $${++pIdx}::uuid)`;
 params.push(lastCreatedAt, lastId);
 }

 where += ' ORDER BY created_at ASC, id ASC';
 where += ` LIMIT ${batchSize}`;

 const { rows } = await pool.query<PgClickRow>(`
 SELECT
 click_id,
 network_id,
 offer_id,
 publisher_id,
 smart_link_id,
 id,
 created_at,
 host(ip) AS ip,
 country, region, city, isp,
 device, os, browser,
 referrer,
 user_agent,
 sub1, sub2, sub3, sub4, sub5,
 is_unique,
 fraud_score,
 fraud_flags,
 resolved_payout::text AS resolved_payout,
 resolved_revenue::text AS resolved_revenue,
 currency
 FROM clicks
 ${where}
 `, params);

 if (rows.length === 0) break;

 if (dryRun) {
 console.log(`[dry-run] Would insert ${rows.length} clicks (batch ${totalBatches + 1})`);
 totalRows += rows.length;
 totalBatches++;
 const last = rows[rows.length - 1];
 lastCreatedAt = last.created_at as unknown as string;
 lastId = last.id as unknown as string;
 continue;
 }

 // Map to ClickHouse rows; PG timestamptz → CH DateTime64(3) string
 const chRows = rows.map(r => ({
 ...mapPgClickToCh(r),
 timestamp: pgTimestampToCh(r.created_at),
 }));

 try {
 await ch.insert({
 table: 'clicks',
 format: 'JSONEachRow',
 columns: [
 'click_id', 'network_id', 'offer_id', 'publisher_id', 'smart_link_id',
 'timestamp', 'ip', 'country', 'region', 'city', 'isp',
 'device', 'os', 'browser', 'referrer', 'user_agent',
 'sub1', 'sub2', 'sub3', 'sub4', 'sub5',
 'is_unique', 'fraud_score', 'fraud_flags',
 'payout', 'revenue', 'currency',
 ],
 values: chRows,
 });
 totalRows += chRows.length;
 totalBatches++;
 const last = rows[rows.length - 1];
 lastCreatedAt = last.created_at as unknown as string;
 lastId = last.id as unknown as string;
 } catch (err) {
 totalErrors++;
 console.error(`[backfill] ClickHouse insert failed for clicks batch ${totalBatches + 1}:`, err instanceof Error ? err.message : err);
 break;
 }
 }

 return { rows: totalRows, batches: totalBatches, errors: totalErrors };
}

async function backfillConversions(opts: BackfillOptions): Promise<{ rows: number; batches: number; errors: number }> {
 const ch = getClickHouse();
 const batchSize = opts.batchSize || DEFAULT_BATCH_SIZE;
 const { from, to, networkId, dryRun } = opts;

 let totalRows = 0;
 let totalBatches = 0;
 let totalErrors = 0;

 let lastCreatedAt: string | null = null;
 let lastId: string | null = null;

 while (true) {
 // Conversions don't carry geo/sub data in PG (inherited from click). LEFT JOIN
 // clicks to recover those columns so CH can denormalize them.
 let where = `WHERE c.created_at >= $1 AND c.created_at < $2`;
 const params: (string | number)[] = [from, to];
 let pIdx = 2;

 if (networkId) {
 where += ` AND c.network_id = $${++pIdx}`;
 params.push(networkId);
 }

 if (lastCreatedAt && lastId) {
 where += ` AND (c.created_at, c.id) > ($${++pIdx}::timestamptz, $${++pIdx}::uuid)`;
 params.push(lastCreatedAt, lastId);
 }

 where += ' ORDER BY c.created_at ASC, c.id ASC';
 where += ` LIMIT ${batchSize}`;

 const { rows } = await pool.query<PgConversionRow & { id: string }>(`
 SELECT
 c.conversion_id,
 c.network_id,
 c.click_id,
 c.offer_id,
 c.publisher_id,
 c.advertiser_id,
 c.goal_id,
 c.id,
 c.created_at,
 c.status,
 c.reason,
 c.source,
 c.event_name,
 c.payout::text AS payout,
 c.revenue::text AS revenue,
 c.currency,
 cl.country, cl.region, cl.city, cl.isp,
 cl.device, cl.os, cl.browser,
 cl.sub1, cl.sub2, cl.sub3, cl.sub4, cl.sub5,
 cl.smart_link_id,
 c.fraud_score,
 c.fraud_flags
 FROM conversions c
 LEFT JOIN clicks cl
 ON cl.network_id = c.network_id AND cl.click_id = c.click_id
 ${where}
 `, params);

 if (rows.length === 0) break;

 if (dryRun) {
 console.log(`[dry-run] Would insert ${rows.length} conversions (batch ${totalBatches + 1})`);
 totalRows += rows.length;
 totalBatches++;
 const last = rows[rows.length - 1];
 lastCreatedAt = last.created_at as unknown as string;
 lastId = last.id;
 continue;
 }

 const chRows = rows.map(r => ({
 ...mapPgConversionToCh(r),
 timestamp: pgTimestampToCh(r.created_at),
 }));

 try {
 await ch.insert({
 table: 'conversions',
 format: 'JSONEachRow',
 columns: [
 'conversion_id', 'network_id', 'click_id', 'offer_id', 'publisher_id',
 'advertiser_id', 'goal_id', 'timestamp', 'status', 'reason', 'source',
 'event_name', 'payout', 'revenue', 'currency',
 'country', 'region', 'city', 'isp',
 'device', 'os', 'browser',
 'sub1', 'sub2', 'sub3', 'sub4', 'sub5',
 'fraud_score', 'fraud_flags',
 ],
 values: chRows,
 });
 totalRows += chRows.length;
 totalBatches++;
 const last = rows[rows.length - 1];
 lastCreatedAt = last.created_at as unknown as string;
 lastId = last.id;
 } catch (err) {
 totalErrors++;
 console.error(`[backfill] ClickHouse insert failed for conversions batch ${totalBatches + 1}:`, err instanceof Error ? err.message : err);
 break;
 }
 }

 return { rows: totalRows, batches: totalBatches, errors: totalErrors };
}

export async function backfillToClickHouse(opts: BackfillOptions): Promise<BackfillResult> {
 const started = Date.now();

 const clicks = await backfillClicks(opts);
 const conversions = await backfillConversions(opts);

 const durationMs = Date.now() - started;

 return { clicks, conversions, durationMs };
}
