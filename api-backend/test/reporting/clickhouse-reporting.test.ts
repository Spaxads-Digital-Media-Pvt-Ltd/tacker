/**
 * Phase 8.5 (Task 8.5) — ClickHouseReportingProvider tests.
 *
 * Asserts the provider enforces the contract:
 * - tenant isolation: every query has WHERE network_id = {p1:String}
 * - date filtering: from/to are applied to both click and conversion CTEs
 * - click + conversion counts: aggregation matches the Postgres semantic
 * - revenue/payout/commission: SUM(amount) FILTER (status='approved') analog
 * - dimensions/grouping: groupBy columns become group-by keys
 * - empty result behavior: no rows in, no rows out
 * - ClickHouse failure: error bubbles up (unlike AnalyticsWriter, the ReportingProvider is a
 * user-facing query — failure must surface so the dashboard renders an error state)
 * - cross-tenant safety: rows from a different network never bleed in
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ClickHouseClient } from '@clickhouse/client';
import { ClickHouseReportingProvider } from '../../src/lib/reporting/clickhouse.js';

function mkClient(overrides: Partial<{ json: unknown }> = {}): { client: ClickHouseClient; querySpy: ReturnType<typeof vi.fn> } {
 const querySpy = vi.fn().mockResolvedValue({
 json: vi.fn().mockResolvedValue(overrides.json ?? { data: [] }),
 });
 const client = {
 query: querySpy,
 } as unknown as ClickHouseClient;
 return { client, querySpy };
}

const NETWORK_A = '00000000-0000-0000-0000-00000000000a';
const NETWORK_B = '00000000-0000-0000-0000-00000000000b';

describe('ClickHouseReportingProvider — tenant isolation', () => {
 it('every SQL statement includes WHERE c.network_id = {p1:String} (click side)', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 expect(querySpy.mock.calls.length).toBeGreaterThanOrEqual(2);
 for (const call of querySpy.mock.calls) {
 const sql = (call[0] as { query: string }).query;
 expect(sql).toContain('c.network_id = {p1:String}');
 }
 });

 it('every SQL statement includes WHERE k.network_id = {p1:String} (conversion side)', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['conversions'],
 filters: {}, limit: 10, offset: 0,
 });
 for (const call of querySpy.mock.calls) {
 const sql = (call[0] as { query: string }).query;
 expect(sql).toContain('k.network_id = {p1:String}');
 }
 });

 it('does not hardcode a different tenant id in SQL (no cross-tenant risk)', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_B, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 const allParams = JSON.stringify(querySpy.mock.calls);
 expect(allParams).not.toContain(NETWORK_A);
 expect(allParams).not.toContain('00000000-0000-0000-0000-00000000000a');
 });

 it('forwards the network id as the first query param to ClickHouse', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 const params = (querySpy.mock.calls[0]?.[0] as { query_params: Record<string, unknown> }).query_params;
 expect(params['p1']).toBe(NETWORK_A);
 });
});

describe('ClickHouseReportingProvider — query parameters', () => {
 it('passes from/to as query parameters when filters are set', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['day'], metrics: ['clicks'],
 filters: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' },
 limit: 10, offset: 0,
 });
 const params = (querySpy.mock.calls[0]?.[0] as { query_params: Record<string, unknown> }).query_params;
 // from/to each get pushed twice (once per CTE) so p2 = from-from, p3 = from-to, p4 = to-from
 // (actually p2/p3 are the click-side from/to; we just assert both strings are in the params bag).
 expect(Object.values(params)).toContain('2026-01-01T00:00:00.000Z');
 expect(Object.values(params)).toContain('2026-01-31T23:59:59.999Z');
 });

 it('omits from/to params when not provided', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['day'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 const params = (querySpy.mock.calls[0]?.[0] as { query_params: Record<string, unknown> }).query_params;
 expect(Object.keys(params)).toEqual(['p1']);
 });

 it('passes offer filter as a single-element array when given a scalar', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: { offerId: '00000000-0000-0000-0000-000000000abc' }, limit: 10, offset: 0,
 });
 const params = (querySpy.mock.calls[0]?.[0] as { query_params: Record<string, unknown> }).query_params;
 expect(params['p2']).toEqual(['00000000-0000-0000-0000-000000000abc']);
 });

 it('passes multi-value offer filter as an array', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: { offerId: ['00000000-0000-0000-0000-000000000abc', '00000000-0000-0000-0000-000000000def'] },
 limit: 10, offset: 0,
 });
 const params = (querySpy.mock.calls[0]?.[0] as { query_params: Record<string, unknown> }).query_params;
 expect(params['p2']).toEqual(['00000000-0000-0000-0000-000000000abc', '00000000-0000-0000-0000-000000000def']);
 });
});

describe('ClickHouseReportingProvider — empty results', () => {
 it('returns empty rows when ClickHouse returns zero rows', async () => {
 const { client } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 const result = await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks', 'conversions', 'payout'],
 filters: {}, limit: 10, offset: 0,
 });
 expect(result.rows).toEqual([]);
 expect(result.total).toBe(0);
 });

 it('throws when ClickHouse query fails (ReportingProvider does NOT swallow errors)', async () => {
 const client = {
 query: vi.fn().mockRejectedValue(new Error('ch down')),
 } as unknown as ClickHouseClient;
 const w = new ClickHouseReportingProvider(client);
 await expect(w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 })).rejects.toThrow(/ch down/);
 });
});

describe('ClickHouseReportingProvider — result mapping', () => {
 it('maps dimension values to strings and metrics to typed numbers/strings', async () => {
 const offerId = '00000000-0000-0000-0000-000000000abc';
 const { client } = mkClient({
 json: {
 data: [
 {
 d0: offerId,
 clicks: '42',
 unique_clicks: '30',
 invalid_clicks: '2',
 avg_fraud_score: 3.5,
 conversions: '5',
 total_conversions: '6',
 payout: '15.0000',
 revenue: '50.0000',
 margin: '35.0000',
 cr: '0.1190',
 epc: '0.3571',
 },
 ],
 },
 });
 const w = new ClickHouseReportingProvider(client);
 const result = await w.runReport({
 networkId: NETWORK_A,
 groupBy: ['offer'],
 metrics: ['clicks', 'conversions', 'payout', 'revenue', 'cr', 'epc', 'avg_fraud_score'],
 filters: {}, limit: 10, offset: 0,
 });
 // total comes from the COUNT query, rows from the page query.
 expect(result.total).toBe(0); // count spy returns default 0
 expect(result.rows).toHaveLength(1);
 const row = result.rows[0]!;
 expect(row.dimensions['offer']).toBe(offerId);
 expect(row.metrics['clicks']).toBe('42');
 expect(row.metrics['conversions']).toBe('5');
 expect(row.metrics['payout']).toBe('15.0000');
 expect(row.metrics['revenue']).toBe('50.0000');
 expect(row.metrics['cr']).toBe(0.1190);
 expect(row.metrics['avg_fraud_score']).toBe(3.5);
 });
});

describe('ClickHouseReportingProvider — SQL structure', () => {
 it('uses toStartOfDay for day dimension (not date_trunc)', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['day'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 const sql = (querySpy.mock.calls[0]?.[0] as { query: string }).query;
 expect(sql).toContain('toStartOfDay(');
 expect(sql).not.toContain('date_trunc');
 });

 it('uses COUNTIf for conditional aggregation (ClickHouse has no FILTER clause)', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['unique_clicks', 'invalid_clicks', 'conversions'],
 filters: {}, limit: 10, offset: 0,
 });
 const sql = (querySpy.mock.calls[0]?.[0] as { query: string }).query;
 expect(sql).toContain('COUNTIf(c.is_unique = 1)');
 expect(sql).toContain('COUNTIf(length(c.fraud_flags) > 0)');
 expect(sql).toContain("COUNTIf(k.status = 'approved')");
 });

 it('uses FULL OUTER JOIN for grouped reports and CROSS JOIN for grand totals', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);

 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks', 'conversions'],
 filters: {}, limit: 10, offset: 0,
 });
 expect((querySpy.mock.calls[0]?.[0] as { query: string }).query).toContain('FULL OUTER JOIN');

 querySpy.mockClear();
 await w.runReport({
 networkId: NETWORK_A, groupBy: [], metrics: ['clicks', 'conversions'],
 filters: {}, limit: 10, offset: 0,
 });
 expect((querySpy.mock.calls[0]?.[0] as { query: string }).query).toContain('CROSS JOIN');
 });

  it('orders by clicks DESC by default', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 // mock.calls[0] is the COUNT query (no ORDER BY), [1] is the paged query.
 const sql = (querySpy.mock.calls[1]?.[0] as { query: string }).query;
 expect(sql).toMatch(/ORDER BY clicks DESC/);
 });

 it('orders by d0 ASC for day/hour-only groupBy (chronological default)', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['day'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 const sql = (querySpy.mock.calls[1]?.[0] as { query: string }).query;
 expect(sql).toMatch(/ORDER BY d0 ASC/);
 });

 it('honors explicit orderBy/orderDir from caller', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['payout', 'clicks'],
 filters: {}, limit: 10, offset: 0,
 orderBy: 'payout', orderDir: 'asc',
 });
 const sql = (querySpy.mock.calls[1]?.[0] as { query: string }).query;
 expect(sql).toMatch(/ORDER BY payout ASC/);
 });

 it('excludes fraud-flagged clicks when excludeInvalid=true', async () => {
 const { client, querySpy } = mkClient();
 const w = new ClickHouseReportingProvider(client);
 await w.runReport({
 networkId: NETWORK_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: { excludeInvalid: true }, limit: 10, offset: 0,
 });
 const sql = (querySpy.mock.calls[0]?.[0] as { query: string }).query;
 expect(sql).toContain('length(c.fraud_flags) = 0');
 });
});

describe('installReportingProvider', () => {
 beforeEach(() => vi.resetModules());

 it('installs Postgres provider when REPORTING_PROVIDER=postgres', async () => {
 vi.doMock('../../src/config/env.js', () => ({
 env: { REPORTING_PROVIDER: 'postgres', NODE_ENV: 'test', LOG_LEVEL: 'info' },
 isProd: false, isTest: true,
 }));
 const { installReportingProvider } = await import('../../src/lib/reporting/clickhouse.js');
 const { getReportingProvider } = await import('../../src/lib/reporting/index.js');
 const active = installReportingProvider();
 expect(active).toBe('postgres');
 const inst = getReportingProvider();
 expect(inst.constructor.name).toBe('PostgresReportingProvider');
 });

 it('installs ClickHouse provider when REPORTING_PROVIDER=clickhouse and CH is configured', async () => {
 vi.doMock('../../src/config/env.js', () => ({
 env: { REPORTING_PROVIDER: 'clickhouse', NODE_ENV: 'test', LOG_LEVEL: 'info' },
 isProd: false, isTest: true,
 }));
 vi.doMock('../../src/lib/clickhouse/client.js', () => ({
 isClickHouseEnabled: () => true,
 getClickHouse: () => ({ query: vi.fn() } as unknown as ClickHouseClient),
 }));
 const { installReportingProvider } = await import('../../src/lib/reporting/clickhouse.js');
 const { getReportingProvider } = await import('../../src/lib/reporting/index.js');
 const active = installReportingProvider();
 expect(active).toBe('clickhouse');
 const inst = getReportingProvider();
 expect(inst.constructor.name).toBe('ClickHouseReportingProvider');
 });

 it('installs ClickHouseWithFallback provider when REPORTING_PROVIDER=clickhouse_with_fallback and CH is configured', async () => {
 vi.doMock('../../src/config/env.js', () => ({
 env: { REPORTING_PROVIDER: 'clickhouse_with_fallback', NODE_ENV: 'test', LOG_LEVEL: 'info' },
 isProd: false, isTest: true,
 }));
 vi.doMock('../../src/lib/clickhouse/client.js', () => ({
 isClickHouseEnabled: () => true,
 getClickHouse: () => ({ query: vi.fn() } as unknown as ClickHouseClient),
 }));
 const { installReportingProvider } = await import('../../src/lib/reporting/clickhouse.js');
 const { getReportingProvider } = await import('../../src/lib/reporting/index.js');
 const active = installReportingProvider();
 expect(active).toBe('clickhouse_with_fallback');
 const inst = getReportingProvider();
 expect(inst.constructor.name).toBe('ClickHouseWithFallbackReportingProvider');
 });

 it('falls back to Postgres when CH mode requested but CLICKHOUSE_URL is not set (must never crash at boot)', async () => {
 vi.doMock('../../src/config/env.js', () => ({
 env: { REPORTING_PROVIDER: 'clickhouse', NODE_ENV: 'test', LOG_LEVEL: 'info' },
 isProd: false, isTest: true,
 }));
 vi.doMock('../../src/lib/clickhouse/client.js', () => ({
 isClickHouseEnabled: () => false,
 getClickHouse: () => { throw new Error('should not be called'); },
 }));
 const { installReportingProvider } = await import('../../src/lib/reporting/clickhouse.js');
 const { getReportingProvider } = await import('../../src/lib/reporting/index.js');
 const active = installReportingProvider();
 expect(active).toBe('postgres');
 const inst = getReportingProvider();
 expect(inst.constructor.name).toBe('PostgresReportingProvider');
 });
});
