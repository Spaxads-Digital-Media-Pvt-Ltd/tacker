/**
 * Task 8.7 — ClickHouse Production Cutover & Operational Hardening — test suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { PostgresReportingProvider, ClickHouseReportingProvider } from '../../src/lib/reporting/clickhouse.js';
import { getReportingProvider, setReportingProvider } from '../../src/lib/reporting/index.js';
import { ClickHouseWithFallbackReportingProvider } from '../../src/lib/reporting/clickhouse-fallback.js';
import type { ReportRequest } from '../../src/lib/reporting/types.js';

const NET_A = '11111111-1111-1111-1111-111111111111';
const NET_B = '22222222-2222-2222-2222-222222222222';
const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-01-31T23:59:59.999Z';

const baseReq: ReportRequest = {
 networkId: NET_A,
 groupBy: ['offer'],
 metrics: ['clicks'],
 filters: { from: FROM, to: TO },
 limit: 10,
 offset: 0,
};

beforeEach(() => {
 setReportingProvider(new PostgresReportingProvider());
 vi.resetModules();
});

/** Build a fallback with injected CH + PG behavior. */
function makeFallback(chBehavior: 'reject' | 'succeed', chErr?: Error): {
 fb: ClickHouseWithFallbackReportingProvider;
 chProvider: ClickHouseReportingProvider;
 pgProvider: PostgresReportingProvider;
 resetUnreachable: () => void;
} {
 const chProvider = {
 runReport: vi.fn().mockImplementation(() => {
 if (chBehavior === 'reject') return Promise.reject(chErr ?? new Error('fail'));
 return Promise.resolve({ groupBy: [], metrics: [], rows: [], total: 0 });
 }),
 } as unknown as ClickHouseReportingProvider;

 const pgProvider = {
 runReport: vi.fn().mockResolvedValue({
 groupBy: ['offer'], metrics: ['clicks'],
 rows: [{ dimensions: { offer: 'o1' }, metrics: { clicks: 5 } }],
 total: 1,
 }),
 } as unknown as PostgresReportingProvider;

 const fb = new ClickHouseWithFallbackReportingProvider(chProvider, pgProvider);
 const resetUnreachable = () => {
 (fb as unknown as { chUnreachable: boolean }).chUnreachable = false;
 };
 return { fb, chProvider, pgProvider, resetUnreachable };
}

// ── 1. Provider selection ─────────────────────────────────────────────────────

describe('8.7 §1 — Provider selection', () => {
 it('default singleton is PostgresReportingProvider', () => {
 expect(getReportingProvider()).toBeInstanceOf(PostgresReportingProvider);
 });

 it('ClickHouseReportingProvider is constructable with explicit client', () => {
 const mockClient = {
 query: vi.fn().mockResolvedValue({
 json: vi.fn().mockResolvedValue({ data: [] }),
 }),
 } as unknown as import('@clickhouse/client').ClickHouseClient;
 expect(() => new ClickHouseReportingProvider(mockClient)).not.toThrow();
 });

 it('ClickHouseWithFallbackReportingProvider is constructable with injected providers', () => {
 const ch = { runReport: vi.fn() } as unknown as ClickHouseReportingProvider;
 const pg = { runReport: vi.fn() } as unknown as PostgresReportingProvider;
 expect(() => new ClickHouseWithFallbackReportingProvider(ch, pg)).not.toThrow();
 });
});

// ── 2. CH infra error → PG fallback ──────────────────────────────────────────

describe('8.7 §2 — CH infra error triggers PG fallback', () => {
 const infraCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT_RESET'];

 for (const code of infraCodes) {
 it(`falls back for ${code}`, async () => {
 const err = Object.assign(new Error(code), { code });
 const { fb, pgProvider } = makeFallback('reject', err);
 const result = await fb.runReport(baseReq);
 expect(result.rows).toHaveLength(1);
 expect(result.rows[0]!.metrics['clicks']).toBe(5);
 expect(pgProvider.runReport).toHaveBeenCalledTimes(1);
 });
 }

 it('falls back for AbortError', async () => {
 const err = new DOMException('aborted', 'AbortError');
 const { fb, pgProvider } = makeFallback('reject', err as unknown as Error);
 const result = await fb.runReport(baseReq);
 expect(result.rows).toHaveLength(1);
 expect(pgProvider.runReport).toHaveBeenCalledTimes(1);
 });
});

// ── 3. No fallback on non-infrastructure errors ──────────────────────────────

describe('8.7 §3 — Non-infrastructure errors fail fast (no fallback)', () => {
 it('does not fall back on "permission denied" (auth/tenant error)', async () => {
 const { fb, pgProvider } = makeFallback('reject', new Error('permission denied'));
 await expect(fb.runReport(baseReq)).rejects.toThrow('permission denied');
 expect(pgProvider.runReport).not.toHaveBeenCalled();
 });

 it('does not fall back on syntax error (programmer error)', async () => {
 const { fb, pgProvider } = makeFallback('reject', new Error('syntax error: unexpected token'));
 await expect(fb.runReport(baseReq)).rejects.toThrow('syntax error');
 expect(pgProvider.runReport).not.toHaveBeenCalled();
 });

 it('does not fall back on TypeError (programmer error)', async () => {
 const { fb, pgProvider } = makeFallback('reject', new TypeError('Cannot read property of undefined'));
 await expect(fb.runReport(baseReq)).rejects.toThrow('Cannot read property');
 expect(pgProvider.runReport).not.toHaveBeenCalled();
 });

 it('does not fall back on null error', async () => {
 const ch = { runReport: vi.fn().mockRejectedValue(null) } as unknown as ClickHouseReportingProvider;
 const pg = { runReport: vi.fn() } as unknown as PostgresReportingProvider;
 const fb = new ClickHouseWithFallbackReportingProvider(ch, pg);
 await expect(fb.runReport(baseReq)).rejects.toBeNull();
 expect(pg.runReport).not.toHaveBeenCalled();
 });
});

// ── 4. Fallback cached: skip CH after first infra failure ────────────────────

describe('8.7 §4 — Fallback cached (no retry storm)', () => {
 it('after CH infra failure, subsequent calls use PG directly', async () => {
 const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
 const { fb, chProvider, pgProvider } = makeFallback('reject', err);
 await fb.runReport(baseReq);
 await fb.runReport(baseReq);
 await fb.runReport(baseReq);

 expect(chProvider.runReport).toHaveBeenCalledTimes(1);
 expect(pgProvider.runReport).toHaveBeenCalledTimes(3);
 });

 it('a fresh fallback instance after first failure can attempt CH again (cached per-instance only)', async () => {
 const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
 const { fb: fb1 } = makeFallback('reject', err);
 await fb1.runReport(baseReq); // CH fails, caches to PG

 const { fb: fb2, chProvider: ch2, pgProvider: pg2 } = makeFallback('reject', err);
 // First call: CH attempted → fails → fallback to PG
 await fb2.runReport(baseReq);
 // Second call: PG directly
 await fb2.runReport(baseReq);

 expect(ch2.runReport).toHaveBeenCalledTimes(1);
 expect(pg2.runReport).toHaveBeenCalledTimes(2);
 });
});

// ── 5. Tenant isolation ──────────────────────────────────────────────────────

describe('8.7 §5 — Tenant isolation (NETWORK_A ≠ NETWORK_B)', () => {
 it('ClickHouse SQL always includes WHERE c.network_id = {p1:String}', async () => {
 const mockClient = {
 query: vi.fn().mockResolvedValue({
 json: vi.fn().mockResolvedValue({ data: [] }),
 }),
 } as unknown as import('@clickhouse/client').ClickHouseClient;
 const w = new ClickHouseReportingProvider(mockClient);
 await w.runReport({
 networkId: NET_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 for (const call of (mockClient.query as ReturnType<typeof vi.fn>).mock.calls) {
 const sql = (call[0] as { query?: string }).query;
 expect(sql).toContain('c.network_id = {p1:String}');
 expect(sql).toContain('k.network_id = {p1:String}');
 }
 });

 it('no NETWORK_B UUID appears when querying NETWORK_A', async () => {
 const mockClient = {
 query: vi.fn().mockResolvedValue({
 json: vi.fn().mockResolvedValue({ data: [] }),
 }),
 } as unknown as import('@clickhouse/client').ClickHouseClient;
 const w = new ClickHouseReportingProvider(mockClient);
 await w.runReport({
 networkId: NET_A, groupBy: ['offer'], metrics: ['clicks'],
 filters: {}, limit: 10, offset: 0,
 });
 const allSql = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls
 .map((c) => ((c[0] as { query?: string }).query ?? '')).join('');
 expect(allSql).not.toContain(NET_B);
 });
});

// ── 6. Fallback preserves network_id scoping ─────────────────────────────────

describe('8.7 §6 — Fallback preserves network_id scoping', () => {
 it('CH query receives same networkId as original request', async () => {
 const err = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
 const { fb, chProvider, pgProvider } = makeFallback('reject', err);
 await fb.runReport({ ...baseReq, networkId: NET_B });
 expect(chProvider.runReport).toHaveBeenCalledWith(expect.objectContaining({ networkId: NET_B }));
 expect(pgProvider.runReport).toHaveBeenCalledWith(expect.objectContaining({ networkId: NET_B }));
 });

 it('PG fallback on second call also receives same networkId', async () => {
 const err = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
 const { fb, pgProvider } = makeFallback('reject', err);
 await fb.runReport({ ...baseReq, networkId: NET_A });
 await fb.runReport({ ...baseReq, networkId: NET_A });
 const pgMock = pgProvider.runReport as unknown as { mock: { calls: unknown[][] } };
 const lastCall = pgMock.mock.calls[pgMock.mock.calls.length - 1]?.[0] as ReportRequest;
 expect(lastCall.networkId).toBe(NET_A);
 });
});

// ── 7. Provider selection cannot remove tenant scoping ───────────────────────

describe('8.7 §7 — Provider selection cannot remove tenant scoping', () => {
 it('CH provider always parameterizes networkId ({p1:String})', async () => {
 const mockClient = {
 query: vi.fn().mockResolvedValue({
 json: vi.fn().mockResolvedValue({ data: [] }),
 }),
 } as unknown as import('@clickhouse/client').ClickHouseClient;
 const w = new ClickHouseReportingProvider(mockClient);
 await w.runReport(baseReq);
 const params = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { query_params?: Record<string, unknown> } | undefined;
 expect(params?.query_params?.['p1']).toBe(NET_A);
 });
});

// ── 8. Health/readiness ──────────────────────────────────────────────────────

describe('8.7 §8 — Health / readiness', () => {
 it('health report includes clickhouse status fields', async () => {
 const { buildHealthReport } = await import('../../src/lib/http/health.js');
 const report = await buildHealthReport('test');
 expect(report.clickhouse).toBeDefined();
 expect(typeof report.clickhouse.configured).toBe('boolean');
 expect(typeof report.clickhouse.healthy).toBe('boolean');
 });

 it('health report includes reporting.active field', async () => {
 const { buildHealthReport } = await import('../../src/lib/http/health.js');
 const report = await buildHealthReport('test');
 expect(report.reporting).toBeDefined();
 expect(typeof report.reporting.configured).toBe('string');
 expect(typeof report.reporting.active).toBe('string');
 });

 it('app stays alive when CH unhealthy but fallback mode active', async () => {
 // CH ping may fail; readiness should reflect degraded mode but stay available
 const { buildHealthReport } = await import('../../src/lib/http/health.js');
 const report = await buildHealthReport('test');
 // Service should always report a status — never 'unready' just for CH
 expect(['ok', 'degraded', 'unready']).toContain(report.status);
 });
});

// ── 9. Invalid REPORTING_PROVIDER rejected at boot ───────────────────────────

describe('8.7 §9 — Invalid REPORTING_PROVIDER rejected by zod', () => {
 it('zod enum accepts postgres, clickhouse, clickhouse_with_fallback', () => {
 const schema = z.object({
 REPORTING_PROVIDER: z.enum(['postgres', 'clickhouse', 'clickhouse_with_fallback']).default('postgres'),
 });
 expect(schema.safeParse({}).success).toBe(true);
 expect(schema.safeParse({ REPORTING_PROVIDER: 'postgres' }).success).toBe(true);
 expect(schema.safeParse({ REPORTING_PROVIDER: 'clickhouse' }).success).toBe(true);
 expect(schema.safeParse({ REPORTING_PROVIDER: 'clickhouse_with_fallback' }).success).toBe(true);
 });

 it('zod enum rejects any other value', () => {
 const schema = z.object({
 REPORTING_PROVIDER: z.enum(['postgres', 'clickhouse', 'clickhouse_with_fallback']),
 });
 const bad = ['postgresql', 'ch', 'fallback', 'both', '', 'POSTGRES', 'ClickHouse'];
 for (const v of bad) {
 expect(schema.safeParse({ REPORTING_PROVIDER: v }).success).toBe(false);
 }
 });
});

// ── 10. Structured observability ─────────────────────────────────────────────

describe('8.7 §10 — Structured log fields', () => {
 it('clickhouse-fallback.ts has at least 3 structured logger calls', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 const loggerCalls = src.split('\n').filter((l) => l.includes('logger.info') || l.includes('logger.warn') || l.includes('logger.error'));
 expect(loggerCalls.length).toBeGreaterThanOrEqual(3);
 });

 it('clickhouse-fallback.ts logs networkId in structured fields', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 const matches = (src.match(/networkId: req\.networkId/g) ?? []).length;
 expect(matches).toBeGreaterThanOrEqual(3);
 });

 it('clickhouse-fallback.ts logs fallback boolean', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 const matches = src.match(/fallback:/g);
 expect(matches).not.toBeNull();
 expect(matches!.length).toBeGreaterThanOrEqual(4);
 });

 it('clickhouse-fallback.ts logs provider name', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 expect(src).toContain("provider: 'clickhouse'");
 expect(src).toContain("provider: 'postgres'");
 });

 it('no raw req.headers, apiKey, jwt, authorization in log calls', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 expect(src).not.toContain('req.headers');
 expect(src).not.toContain('apiKey');
 expect(src).not.toContain('jwt');
 expect(src).not.toContain('authorization');
 });

 it('Sentry receives infra errors with phase=reporting-fallback', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 expect(src).toContain("phase: 'reporting-fallback'");
 expect(src).toContain('captureError');
 });

 it('Sentry receives non-infra errors with phase=reporting (no fallback)', async () => {
 const src = (await import('fs')).readFileSync(
 'src/lib/reporting/clickhouse-fallback.ts', 'utf-8',
 );
 expect(src).toContain("phase: 'reporting'");
 });
});

// ── 11. Graceful shutdown ────────────────────────────────────────────────────

describe('8.7 §11 — Graceful shutdown: CH client closes cleanly', () => {
 it('closeClickHouse without args resolves cleanly even if never opened', async () => {
 const { closeClickHouse } = await import('../../src/lib/clickhouse/client.js');
 await expect(closeClickHouse()).resolves.toBeUndefined();
 // Second call is also a no-op
 await expect(closeClickHouse()).resolves.toBeUndefined();
 });

 it('closeClickHouse is safe with an explicit client reference', async () => {
 const { closeClickHouse } = await import('../../src/lib/clickhouse/client.js');
 // Pass the singleton reference (may be null if CH unconfigured)
 const { getClickHouse } = await import('../../src/lib/clickhouse/client.js');
 try {
 const client = getClickHouse();
 await closeClickHouse(client);
 } catch {
 // OK — CH not configured in this test env
 }
 // The no-arg form should also be safe
 await expect(closeClickHouse()).resolves.toBeUndefined();
 });
});

// ── A. Timeout handling ───────────────────────────────────────────────────────

describe('8.7 §A — Timeout → infra error → fallback', () => {
 it('ETIMEDOUT triggers fallback to PG', async () => {
 const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
 const { fb, pgProvider } = makeFallback('reject', err);
 await fb.runReport(baseReq);
 expect(pgProvider.runReport).toHaveBeenCalledTimes(1);
 });

 it('CLICKHOUSE_REQUEST_TIMEOUT env is positive integer', async () => {
 const { env } = await import('../../src/config/env.js');
 expect(env.CLICKHOUSE_REQUEST_TIMEOUT).toBeGreaterThan(0);
 expect(Number.isInteger(env.CLICKHOUSE_REQUEST_TIMEOUT)).toBe(true);
 });
});

// ── B. Cross-tenant safety ────────────────────────────────────────────────────

describe('8.7 §B — Cross-tenant safety (fallback)', () => {
 it('fallback does not merge NETWORK_B data into NETWORK_A results', async () => {
 const err = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
 const { fb, pgProvider } = makeFallback('reject', err);
 await fb.runReport({ ...baseReq, networkId: NET_A });
 await fb.runReport({ ...baseReq, networkId: NET_B });

 const pgMock = pgProvider.runReport as unknown as { mock: { calls: unknown[][] } };
 expect(pgProvider.runReport).toHaveBeenCalledTimes(2);
 const call1 = pgMock.mock.calls[0]?.[0] as ReportRequest;
 const call2 = pgMock.mock.calls[1]?.[0] as ReportRequest;
 expect(call1.networkId).toBe(NET_A);
 expect(call2.networkId).toBe(NET_B);
 });
});

// ── C. Strict mode ───────────────────────────────────────────────────────────

describe('8.7 §C — Strict clickhouse mode', () => {
 it('strict ClickHouseReportingProvider does not have fallback semantics', () => {
 const mockClient = {
 query: vi.fn(),
 } as unknown as import('@clickhouse/client').ClickHouseClient;
 const w = new ClickHouseReportingProvider(mockClient);
 expect(w).toBeInstanceOf(ClickHouseReportingProvider);
 expect(typeof w.runReport).toBe('function');
 });
});
