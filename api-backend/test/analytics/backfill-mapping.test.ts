import { describe, it, expect, beforeAll } from 'vitest';
import { backfillToClickHouse } from '../../src/lib/analytics/backfill';

const SKIP = !process.env.CLICKHOUSE_URL;

describe('backfill field mapping', () => {
 beforeAll(() => {
 if (SKIP) return;
 });

 it('accepts valid date range', async () => {
 if (SKIP) return;
 const result = await backfillToClickHouse({
 from: '2026-01-01',
 to: '2026-01-02',
 batchSize: 100,
 });
 expect(result.clicks).toBeDefined();
 expect(result.conversions).toBeDefined();
 });

 it('handles dry-run mode without errors', async () => {
 if (SKIP) return;
 const result = await backfillToClickHouse({
 from: '2026-01-01',
 to: '2026-01-02',
 batchSize: 100,
 dryRun: true,
 });
 expect(result.clicks.errors).toBe(0);
 expect(result.conversions.errors).toBe(0);
 });
});
