#!/usr/bin/env node
// Backfill historical PostgreSQL data into ClickHouse.
// Usage: npx tsx scripts/backfill-clickhouse.ts --from YYYY-MM-DD --to YYYY-MM-DD [--network-id UUID] [--batch-size N] [--dry-run]

import { backfillToClickHouse } from '../src/lib/analytics/backfill';

function parseArgs(argv: string[]): {
 from: string;
 to: string;
 networkId?: string;
 batchSize?: number;
 dryRun: boolean;
} {
 const args = argv.slice(2);
 const out: {
 from?: string;
 to?: string;
 networkId?: string;
 batchSize?: number;
 dryRun: boolean;
 } = { dryRun: false };

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
 default:
 console.error(`Unknown flag: ${a}`);
 console.error('Usage: backfill-clickhouse.ts --from YYYY-MM-DD --to YYYY-MM-DD [--network-id UUID] [--batch-size N] [--dry-run]');
 process.exit(1);
 }
 }

 if (!out.from || !out.to) {
 console.error('Missing required flags: --from and --to');
 console.error('Usage: backfill-clickhouse.ts --from YYYY-MM-DD --to YYYY-MM-DD [--network-id UUID] [--batch-size N] [--dry-run]');
 process.exit(1);
 }

 // Validate date format
 if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from!) || !/^\d{4}-\d{2}-\d{2}$/.test(out.to!)) {
 console.error('Dates must be in YYYY-MM-DD format');
 process.exit(1);
 }

 if (out.batchSize && (out.batchSize < 1 || out.batchSize > 50000)) {
 console.error('--batch-size must be between 1 and 50000');
 process.exit(1);
 }

 return out as { from: string; to: string; networkId?: string; batchSize?: number; dryRun: boolean };
}

async function main() {
 const args = parseArgs(process.argv);
 const { from, to, networkId, batchSize, dryRun } = args;

 console.log(`[backfill] Starting ${dryRun ? 'dry-run ' : ''}backfill`);
 console.log(`[backfill] Date range: ${from} to ${to}`);
 if (networkId) console.log(`[backfill] Network filter: ${networkId}`);
 if (batchSize) console.log(`[backfill] Batch size: ${batchSize}`);

 try {
 const result = await backfillToClickHouse({
 from,
 to,
 networkId,
 batchSize,
 dryRun,
 });

 console.log('\n[backfill] Complete.');
 console.log(`[backfill] Clicks: ${result.clicks.rows} rows in ${result.clicks.batches} batches (${result.clicks.errors} errors)`);
 console.log(`[backfill] Conversions: ${result.conversions.rows} rows in ${result.conversions.batches} batches (${result.conversions.errors} errors)`);
 console.log(`[backfill] Duration: ${result.durationMs}ms`);

 if (result.clicks.errors > 0 || result.conversions.errors > 0) {
 process.exitCode = 1;
 }
 } catch (err) {
 console.error('[backfill] Fatal error:', err instanceof Error ? err.message : err);
 process.exit(1);
 }
}

main();
