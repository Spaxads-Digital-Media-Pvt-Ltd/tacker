#!/usr/bin/env node
/**
 * Mid-run failure test:
 * 1. Run backfill successfully (clean baseline).
 * 2. Drop CH.conversions.
 * 3. Run backfill again — clicks phase succeeds, conversions phase fails-fast.
 * 4. Restore CH.conversions via migration script.
 * 5. Run backfill again — both phases succeed (manual resume).
 */
import { backfillToClickHouse } from '../src/lib/analytics/backfill';
import { getClickHouse, closeClickHouse } from '../src/lib/clickhouse/client';
import { execSync } from 'node:child_process';

const NET_A = '11111111-1111-1111-1111-111111111111';

async function main() {
 const ch = getClickHouse();

 // 1) clean baseline
 await ch.command({ query: 'TRUNCATE TABLE tracker.clicks' });
 await ch.command({ query: 'TRUNCATE TABLE tracker.conversions' });
 console.log('[failfast] Baseline (CH truncated).');

 const r0 = await backfillToClickHouse({
 from: '2026-09-01',
 to: '2026-09-06',
 networkId: NET_A,
 batchSize: 2,
 });
 console.log('[failfast] Baseline run:', JSON.stringify({ clicks: r0.clicks, conversions: r0.conversions }));

 // 2) break CH.conversions so the conversions phase must fail-fast
 await ch.command({ query: 'DROP TABLE IF EXISTS tracker.conversions' });
 console.log('[failfast] Dropped tracker.conversions — conversions phase will fail-fast.');

 // 3) rerun — clicks should still succeed; conversions should fail-fast on first insert
 const r1 = await backfillToClickHouse({
 from: '2026-09-01',
 to: '2026-09-06',
 networkId: NET_A,
 batchSize: 2,
 });
 console.log('[failfast] Run with broken conversions:');
 console.log(' clicks:', JSON.stringify(r1.clicks));
 console.log(' conversions:', JSON.stringify(r1.conversions));

 if (r1.clicks.errors === 0 && r1.clicks.batches >= 1 && r1.conversions.errors === 1 && r1.conversions.batches === 0) {
 console.log('[failfast] PASS: fail-fast isolated the failure to conversions phase.');
 } else {
 console.log('[failfast] UNEXPECTED shape — review.');
 }

 // 4) restore via migration
 const MIGRATION = 'C:\\Users\\vivek\\tacker\\api-backend\\clickhouse\\migrations\\0002_conversions.sql';
 execSync(`docker exec -i tacker-clickhouse-1 clickhouse-client < "${MIGRATION}"`, {
 stdio: 'inherit',
 });
 console.log('[failfast] Restored tracker.conversions.');

 // 5) rerun — manual resume; both phases complete cleanly
 const r2 = await backfillToClickHouse({
 from: '2026-09-01',
 to: '2026-09-06',
 networkId: NET_A,
 batchSize: 2,
 });
 console.log('[failfast] Resume run:');
 console.log(' clicks:', JSON.stringify(r2.clicks));
 console.log(' conversions:', JSON.stringify(r2.conversions));

 // Verify FINAL counts
 const clickCount = await ch.query({
 query: 'SELECT toUInt64(count()) AS n FROM tracker.clicks FINAL',
 format: 'JSONEachRow',
 });
 const clickRows = await clickCount.json<{ n: string }>();
 const cvCount = await ch.query({
 query: 'SELECT toUInt64(count()) AS n FROM tracker.conversions FINAL',
 format: 'JSONEachRow',
 });
 const cvRows = await cvCount.json<{ n: string }>();
 console.log(`[failfast] FINAL CH clicks: ${clickRows[0]?.n}, conversions: ${cvRows[0]?.n}`);

 await closeClickHouse();
}

main().catch(e => {
 console.error('[failfast] FATAL:', e);
 process.exit(1);
});
