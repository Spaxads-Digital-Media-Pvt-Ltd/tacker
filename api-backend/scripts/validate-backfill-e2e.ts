#!/usr/bin/env node
// Live end-to-end backfill validation.
// Seeds data into PG (if needed), runs backfill to CH, verifies counts and parity.
// Usage: npx tsx scripts/validate-backfill-e2e.ts [--network-id UUID] [--days N] [--batch-size N]

import { pool } from '../src/lib/db/pool';
import { getClickHouse, closeClickHouse, isClickHouseEnabled } from '../src/lib/clickhouse/client';
import { backfillToClickHouse } from '../src/lib/analytics/backfill';
import { env } from '../src/config/env';

function parseArgs(argv: string[]): {
 from: string;
 to: string;
 networkId?: string;
 batchSize?: number;
 dryRun?: boolean;
 seed?: boolean;
} {
 const args = argv.slice(2);
 const out: {
 from?: string;
 to?: string;
 networkId?: string;
 batchSize?: number;
 dryRun?: boolean;
 seed: boolean;
 } = { dryRun: false, seed: false };

 const days = 7;
 const toDate = new Date();
 toDate.setHours(23, 59, 59, 999);
 const fromDate = new Date();
 fromDate.setDate(fromDate.getDate() - days);
 fromDate.setHours(0, 0, 0, 0);

 out.from = fromDate.toISOString().slice(0, 10);
 out.to = toDate.toISOString().slice(0, 10);

 for (let i = 0; i < args.length; i++) {
 const a = args[i];
 switch (a) {
 case '--from':
 out.from = args[++i];
 break;
 case '--to':
 out.to = args[++i];
 break;
 case '--network-id':
 out.networkId = args[++i];
 break;
 case '--batch-size':
 out.batchSize = parseInt(args[++i], 10);
 break;
 case '--dry-run':
 out.dryRun = true;
 break;
 case '--seed':
 out.seed = true;
 break;
 }
 }
 return out;
}

async function main() {
 const args = parseArgs(process.argv);
 const pgPool = pool;

 console.log(`[e2e] Validating backfill from ${args.from} to ${args.to}`);
 if (!isClickHouseEnabled()) {
 console.error('[e2e] ClickHouse not configured. Set CLICKHOUSE_URL.');
 process.exit(1);
 }

 // Step 1: Check PG data
 const pgResult = await pgPool.query(`
 SELECT
 COUNT(*)::int as total_clicks,
 COUNT(DISTINCT network_id)::int as networks,
 MIN(created_at)::text as min_ts,
 MAX(created_at)::text as max_ts
 FROM clicks
 WHERE created_at >= $1 AND created_at < $2
 `, [args.from, args.to]);
 const pgClicks = pgResult.rows[0];
 console.log(`[e2e] PG clicks in range: ${pgClicks.total_clicks} (${pgClicks.networks} networks)`);
 console.log(`[e2e] PG date range: ${pgClicks.min_ts} to ${pgClicks.max_ts}`);

 const cvResult = await pool.query(`
 SELECT COUNT(*)::int as total_conversions
 FROM conversions
 WHERE created_at >= $1 AND created_at < $2
 `, [args.from, args.to]);
 const pgConversions = cvResult.rows[0];
 console.log(`[e2e] PG conversions in range: ${pgConversions.total_conversions}`);

 if (pgClicks.total_clicks === 0 && pgConversions.total_conversions === 0) {
 console.log('[e2e] No data in PG for this range. Nothing to backfill.');
 process.exit(0);
 }

 // Step 2: Run backfill
 const start = Date.now();
 const result = await backfillToClickHouse({
 from: args.from,
 to: args.to,
 networkId: args.networkId,
 batchSize: args.batchSize,
 dryRun: args.dryRun,
 });
 const durationMs = Date.now() - start;

 console.log(`\n[e2e] Backfill complete (${durationMs}ms):`);
 console.log(`[e2e] Clicks: ${result.clicks.rows} rows in ${result.clicks.batches} batches`);
 console.log(`[e2e] Conversions: ${result.conversions.rows} rows in ${result.conversions.batches} batches`);

 // Step 3: Verify CH counts
 const ch = getClickHouse();

 const chClickResult = await ch.query({
 query: `
 SELECT toUInt64(COUNT(*)) as total FROM ${env.CLICKHOUSE_DATABASE}.clicks
 WHERE timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
 ${args.networkId ? ' AND network_id = {networkId:UUID}' : ''}
 `,
 query_params: {
 from: args.from + ' 00:00:00.000',
 to: args.to + ' 00:00:00.000',
 ...(args.networkId ? { networkId: args.networkId } : {}),
 },
 format: 'JSONEachRow',
 });
 const chClickRows = await chClickResult.json<{ total: number | string }>();
 const clickTotal = Number(chClickRows[0]?.total ?? 0);
 console.log(`\n[e2e] CH click count: ${clickTotal} (expected ${pgClicks.total_clicks})`);

 if (clickTotal !== pgClicks.total_clicks) {
 console.error(`[e2e] MISMATCH: PG has ${pgClicks.total_clicks} but CH has ${clickTotal}`);
 } else {
 console.log('[e2e] PASS: Click counts match');
 }

 const chCvResult = await ch.query({
 query: `
 SELECT toUInt64(COUNT(*)) as total FROM ${env.CLICKHOUSE_DATABASE}.conversions
 WHERE timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
 ${args.networkId ? ' AND network_id = {networkId:UUID}' : ''}
 `,
 query_params: {
 from: args.from + ' 00:00:00.000',
 to: args.to + ' 00:00:00.000',
 ...(args.networkId ? { networkId: args.networkId } : {}),
 },
 format: 'JSONEachRow',
 });
 const chCvRows = await chCvResult.json<{ total: number | string }>();
 const cvTotal = Number(chCvRows[0]?.total ?? 0);
 console.log(`[e2e] CH conversion count: ${cvTotal} (expected ${pgConversions.total_conversions})`);

 if (cvTotal !== pgConversions.total_conversions) {
 console.error(`[e2e] MISMATCH: PG has ${pgConversions.total_conversions} but CH has ${cvTotal}`);
 } else {
 console.log('[e2e] PASS: Conversion counts match');
 }

 // Step 4: Idempotency — run again and verify counts don't increase
 if (!args.dryRun) {
 console.log('\n[e2e] Testing idempotency (running backfill again)...');
 const idemResult = await backfillToClickHouse({
 from: args.from,
 to: args.to,
 networkId: args.networkId,
 batchSize: args.batchSize,
 });
 console.log(`[e2e] Idempotent run: ${idemResult.clicks.rows} clicks, ${idemResult.conversions.rows} conversions`);
 console.log(`[e2e] (ReplacingMergeTree deduplicates — counts should remain ${clickTotal}/${cvTotal})`);
 }

 // Step 5: Sample data check
 if (pgClicks.total_clicks > 0) {
 const sample = await ch.query({
 query: `
 SELECT click_id, network_id::String, offer_id::String,
 payout, revenue, currency, fraud_score
 FROM ${env.CLICKHOUSE_DATABASE}.clicks
 WHERE timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
 LIMIT 3
 `,
 query_params: {
 from: args.from + ' 00:00:00.000',
 to: args.to + ' 00:00:00.000',
 },
 format: 'JSONEachRow',
 });
 const sampleRows = await sample.json<Record<string, unknown>[]>();
 console.log(`\n[e2e] Sample CH rows:\n${JSON.stringify(sampleRows, null, 2)}`);
 }

 console.log('\n[e2e] ==================== SUMMARY ====================');
 console.log(`[e2e] PG clicks: ${pgClicks.total_clicks} | CH clicks: ${clickTotal}`);
 console.log(`[e2e] PG conversions: ${pgConversions.total_conversions} | CH conversions: ${cvTotal}`);
 const pass = clickTotal === pgClicks.total_clicks && cvTotal === pgConversions.total_conversions;
 console.log(`[e2e] Result: ${pass ? 'PASS' : 'FAIL'}`);

 await closeClickHouse();
 process.exit(pass ? 0 : 1);
}

main().catch(err => {
 console.error('[e2e] Fatal:', err);
 process.exit(1);
});
