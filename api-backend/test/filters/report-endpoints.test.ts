/**
 * Report endpoint filter fixes — PURE tests (no DB; the pg pool is mocked, ClickHouse is a stub
 * client). Covers: strict per-endpoint detail schemas (an accepted-but-ignored filter is now a 422),
 * click-side filters on /conversions bound as params, date-only `to` meaning end-of-day,
 * "Ignore Fail Traffic" also constraining conversions, paged /goals + /click-to-conversion-time,
 * the cohort day-column count, and the ClickHouse advertiser filter/group resolved through the
 * Postgres offer mapping instead of the non-existent `c.advertiser_id`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { ClickHouseClient } from '@clickhouse/client';

const queryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const { errorHandler } = await import('../../src/lib/http/envelope.js');
const { mountDetailReports } = await import('../../src/surfaces/dashboard/reports/detail-reports.js');
const { reportQuerySchema, buildReportRequest, inclusiveTo } = await import('../../src/lib/reporting/request.js');
const { PostgresReportingProvider } = await import('../../src/lib/reporting/postgres.js');
const { ClickHouseReportingProvider } = await import('../../src/lib/reporting/clickhouse-provider.js');

const NET = '33333333-3333-4333-8333-333333333333';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OFFER_A1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const OFFER_A2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const OFFER_B1 = 'bbbbbbbb-0000-4000-8000-000000000001';

function app(): Express {
  const r = express.Router();
  mountDetailReports(r);
  const a = express();
  a.use((req, _res, next) => { (req as unknown as { scope: unknown }).scope = { networkId: NET }; next(); });
  a.use('/', r);
  a.use(errorHandler);
  return a;
}

/** Every SQL + params the mocked pool saw. */
const calls = () => queryMock.mock.calls.map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }));

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('detail report schemas are strict (no accepted-but-ignored filters)', () => {
  it.each([
    ['/clicks', 'event=install'],
    ['/clicks', 'status=approved'],
    ['/conversions', 'isUnique=true'],
    ['/conversions', 'fraudMin=50'],
    ['/postback-logs', 'country=US'],
    ['/postback-logs', `advertiserId=${A}`],
    ['/goals', 'country=US'],
    ['/goals', `smartLinkId=${A}`],
    ['/click-to-conversion-time', `publisherId=${A}`],
    ['/pacing', 'country=US'],
  ])('%s?%s → 422 and never queries', async (path, qs) => {
    const res = await request(app()).get(`${path}?${qs}`);
    expect(res.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('keys each endpoint applies are still accepted (incl. limit/offset/from/to the pages send)', async () => {
    const day = 'from=2026-10-01T00:00:00.000Z&to=2026-10-08T23:59:59.999Z';
    for (const url of [
      `/clicks?${day}&offerId=${A}&advertiserId=${B}&smartLinkId=${A}&country=us&device=mobile&sub1=x&isUnique=true&fraudMin=10&limit=26&offset=25`,
      `/conversions?${day}&offerId=${A}&publisherId=${B}&status=approved&excludeSource=manual&country=US&limit=500&offset=0`,
      `/postback-logs?${day}&offerId=${A}&publisherId=${B}&success=false&limit=26&offset=0`,
      `/goals?${day}&offerId=${A}&publisherId=${B}`,
      `/click-to-conversion-time?${day}&groupBy=publisher&offerId=${A}`,
      `/pacing?${day}&category=click&offerId=${A}`,
    ]) {
      const res = await request(app()).get(url);
      expect(res.status, url).toBe(200);
    }
  });
});

describe('/conversions click-side filters', () => {
  it('binds smart link / geo / device / sub filters as params on the joined click', async () => {
    const res = await request(app()).get(`/conversions?offerId=${A}&smartLinkId=${B}&country=in&device=mobile&city=Pune&sub1=abc&limit=10`);
    expect(res.status).toBe(200);
    const { sql, params } = calls()[0]!;
    // Conversion-side filter stays inside the conversions subquery…
    expect(sql).toMatch(/FROM conversions WHERE network_id = \$1 AND offer_id = \$2\) v/);
    // …click-side ones filter the LEFT JOINed click, every value a bound parameter.
    const where = sql.slice(sql.indexOf('LEFT JOIN offer_goals'));
    for (const col of ['k.smart_link_id', 'k.country', 'k.city', 'k.device', 'k.sub1']) expect(where).toMatch(new RegExp(`${col.replace('.', '\\.')} = \\$\\d+`));
    expect(sql).not.toContain('Pune');
    expect(sql).not.toContain('abc');
    expect(params.slice(0, 7)).toEqual([NET, A, B, 'IN', 'Pune', 'mobile', 'abc']);
    expect(params.slice(-2)).toEqual([10, 0]);
  });

  it('adds no click WHERE when no click-side filter is given', async () => {
    await request(app()).get(`/conversions?offerId=${A}`);
    const { sql } = calls()[0]!;
    expect(sql.slice(sql.indexOf('LEFT JOIN offer_goals'))).not.toMatch(/WHERE/);
  });
});

describe('date-only `to` is end-of-day inclusive', () => {
  it('inclusiveTo widens YYYY-MM-DD and leaves datetimes alone', () => {
    expect(inclusiveTo('2026-10-08')).toBe('2026-10-08T23:59:59.999999Z');
    expect(inclusiveTo('2026-10-08T12:00:00.000Z')).toBe('2026-10-08T12:00:00.000Z');
    expect(inclusiveTo(undefined)).toBeUndefined();
  });

  it('/api/reports: date-only from/to become the full UTC day', () => {
    const parsed = reportQuerySchema.safeParse({ from: '2026-10-08', to: '2026-10-08' });
    expect(parsed.success).toBe(true);
    const req = buildReportRequest(NET, parsed.success ? parsed.data : ({} as never), 'admin');
    expect(req.filters.from).toBe('2026-10-08T00:00:00.000Z');
    expect(req.filters.to).toBe('2026-10-08T23:59:59.999999Z');
    // A same-day datetime `from` is no longer "after" a date-only `to`.
    expect(reportQuerySchema.safeParse({ from: '2026-10-08T10:00:00Z', to: '2026-10-08' }).success).toBe(true);
  });

  it('text filters survive qs turning >20 repeated params into an index-keyed object', () => {
    const many = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [String(i), `ISP ${i}, LLC`]));
    const parsed = reportQuerySchema.safeParse({ isp: many });
    expect(parsed.success).toBe(true);
    const req = buildReportRequest(NET, parsed.success ? parsed.data : ({} as never), 'admin');
    expect(req.filters.isp).toHaveLength(22);
    expect((req.filters.isp as string[])[21]).toBe('ISP 21, LLC');
  });

  it('detail endpoints bind the widened bound', async () => {
    await request(app()).get('/clicks?from=2026-10-01&to=2026-10-08');
    const { sql, params } = calls()[0]!;
    expect(sql).toMatch(/created_at >= \$2 AND created_at <= \$3/);
    expect(params.slice(1, 3)).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-08T23:59:59.999999Z']);
  });
});

describe('"Ignore Fail Traffic" (excludeInvalid) also constrains conversions', () => {
  it('Postgres: fraud-flagged clicks AND conversions from them are dropped', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 0 }] }).mockResolvedValueOnce({ rows: [] });
    await new PostgresReportingProvider().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['clicks', 'conversions'], filters: { excludeInvalid: true }, limit: 10, offset: 0 });
    const { sql } = calls()[0]!;
    const cl = sql.slice(sql.indexOf('cl AS'), sql.indexOf('cv AS'));
    const cv = sql.slice(sql.indexOf('cv AS'));
    expect(cl).toContain('array_length(clicks.fraud_flags, 1) IS NULL');
    expect(cv).toContain('array_length(k.fraud_flags, 1) IS NULL');
  });

  it('Postgres: without the flag conversions are not constrained', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 0 }] }).mockResolvedValueOnce({ rows: [] });
    await new PostgresReportingProvider().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters: {}, limit: 10, offset: 0 });
    expect(calls()[0]!.sql).not.toContain('k.fraud_flags');
  });
});

/** Stub ClickHouse client that records every query. */
function chStub(rows: Record<string, unknown>[] = []) {
  const querySpy = vi.fn().mockImplementation(async ({ query: q }: { query: string }) => ({
    json: async () => ({ data: q.includes('AS total FROM') ? [{ total: rows.length }] : rows }),
  }));
  return { client: { query: querySpy } as unknown as ClickHouseClient, querySpy };
}
const MAPPING = [
  { id: OFFER_A1, advertiser_id: A },
  { id: OFFER_A2, advertiser_id: A },
  { id: OFFER_B1, advertiser_id: B },
];

describe('ClickHouse provider — advertiser via the Postgres offer mapping', () => {
  it('advertiser filter never references c.advertiser_id; clicks filter on that advertiser\'s offers', async () => {
    const { client, querySpy } = chStub();
    const lookup = vi.fn().mockResolvedValue(MAPPING);
    await new ClickHouseReportingProvider(client, lookup).runReport({
      networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters: { advertiserId: A }, limit: 10, offset: 0,
    });
    expect(lookup).toHaveBeenCalledWith(NET);
    const { query: sql, query_params: qp } = querySpy.mock.calls[0]![0] as { query: string; query_params: Record<string, unknown> };
    expect(sql).not.toContain('c.advertiser_id');
    const m = sql.match(/toString\(c\.offer_id\) IN \{(p\d+):Array\(String\)\}/);
    expect(m).not.toBeNull();
    expect(qp[m![1]!]).toEqual([OFFER_A1, OFFER_A2]);
    expect(sql).toMatch(/toString\(k\.advertiser_id\) IN \{p\d+:Array\(String\)\}/);
  });

  it('an advertiser with no offers matches no clicks (no empty IN-list)', async () => {
    const { client, querySpy } = chStub();
    await new ClickHouseReportingProvider(client, async () => MAPPING).runReport({
      networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters: { advertiserId: '99999999-9999-4999-8999-999999999999' }, limit: 10, offset: 0,
    });
    const sql = (querySpy.mock.calls[0]![0] as { query: string }).query;
    expect(sql).toContain('0 = 1');
    expect(sql).not.toContain('c.advertiser_id');
  });

  it('excluding an advertiser drops its offers\' clicks but keeps advertiser-less conversions', async () => {
    const { client, querySpy } = chStub();
    await new ClickHouseReportingProvider(client, async () => MAPPING).runReport({
      networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters: { excludeAdvertiserId: B }, limit: 10, offset: 0,
    });
    const { query: sql, query_params: qp } = querySpy.mock.calls[0]![0] as { query: string; query_params: Record<string, unknown> };
    const m = sql.match(/toString\(c\.offer_id\) NOT IN \{(p\d+):Array\(String\)\}/);
    expect(qp[m![1]!]).toEqual([OFFER_B1]);
    expect(sql).toContain('isNull(k.advertiser_id) OR toString(k.advertiser_id) NOT IN');
    expect(sql).not.toContain('c.advertiser_id');
  });

  it('grouping by advertiser maps click offers through transform(); no lookup when advertiser isn\'t involved', async () => {
    const { client, querySpy } = chStub();
    const lookup = vi.fn().mockResolvedValue(MAPPING);
    await new ClickHouseReportingProvider(client, lookup).runReport({
      networkId: NET, groupBy: ['advertiser'], metrics: ['clicks'], filters: {}, limit: 10, offset: 0,
    });
    const sql = (querySpy.mock.calls[0]![0] as { query: string }).query;
    expect(sql).toMatch(/nullIf\(transform\(toString\(c\.offer_id\), \{p\d+:Array\(String\)\}, \{p\d+:Array\(String\)\}, ''\), ''\) AS d0/);
    expect(sql).not.toContain('c.advertiser_id');

    const other = chStub();
    const lookup2 = vi.fn().mockResolvedValue(MAPPING);
    await new ClickHouseReportingProvider(other.client, lookup2).runReport({
      networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters: { offerId: A }, limit: 10, offset: 0,
    });
    expect(lookup2).not.toHaveBeenCalled();
  });

  it('include filters compare as text (toString), cr orders by the ratio, ties break on the group key', async () => {
    const { client, querySpy } = chStub();
    await new ClickHouseReportingProvider(client, async () => MAPPING).runReport({
      networkId: NET, groupBy: ['offer', 'country'], metrics: ['clicks', 'cr'], filters: { offerId: [A, B] }, limit: 10, offset: 0, orderBy: 'cr', orderDir: 'desc',
    });
    const count = (querySpy.mock.calls[0]![0] as { query: string }).query;
    const page = (querySpy.mock.calls[1]![0] as { query: string }).query;
    expect(count).toMatch(/toString\(c\.offer_id\) IN \{p\d+:Array\(String\)\}/);
    expect(count).toMatch(/toString\(k\.offer_id\) IN \{p\d+:Array\(String\)\}/);
    expect(page).toMatch(/ORDER BY if\(clicks > 0, conversions \/ clicks, 0\) DESC, d0, d1 LIMIT/);
  });

  it('excludeInvalid drops conversions whose click was fraud-flagged', async () => {
    const { client, querySpy } = chStub();
    await new ClickHouseReportingProvider(client, async () => MAPPING).runReport({
      networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters: { excludeInvalid: true }, limit: 10, offset: 0,
    });
    const sql = (querySpy.mock.calls[0]![0] as { query: string }).query;
    expect(sql).toContain('length(c.fraud_flags) = 0');
    expect(sql).toMatch(/k\.click_id NOT IN \(SELECT ic\.click_id FROM tracker\.clicks ic WHERE ic\.network_id = \{p1:String\} AND length\(ic\.fraud_flags\) > 0\)/);
  });
});

describe('aggregated detail endpoints report their real size', () => {
  it('/goals pages with limit/offset and returns { rows, total, truncated }', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::int AS total FROM (')) return { rows: [{ total: 3 }] };
      if (sql.includes('FROM clicks')) return { rows: [{ offer_id: A, clicks: 10 }] };
      return { rows: [{ goal: 'install', offer_id: A, conversions: 2, payout: '1.0000', revenue: '3.0000', margin: '2.0000' }] };
    });
    const res = await request(app()).get(`/goals?offerId=${A}&publisherId=${B}&limit=1&offset=1`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.truncated).toBe(true);
    expect(res.body.data.rows[0]).toMatchObject({ goal: 'install', clicks: 10, cvr: 20 });
    const page = calls().find((c) => c.sql.includes('ORDER BY conversions DESC'))!;
    expect(page.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(page.sql).not.toMatch(/LIMIT 500/);
    expect(page.params.slice(-2)).toEqual([1, 1]);
    expect(page.sql).toContain('c.publisher_id = $');
  });

  it('/click-to-conversion-time returns { rows, total, truncated } from the window count', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ key: A, b0: 1, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, total: 1, groups: 2 }] });
    const res = await request(app()).get('/click-to-conversion-time?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ rows: [{ key: A, b0: 1, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, total: 1 }], total: 2, truncated: true });
  });

  it('/cohort shows one day column per calendar day in the range (no extra column)', async () => {
    const res = await request(app()).get('/cohort?from=2026-10-01&to=2026-10-07');
    expect(res.status).toBe(200);
    expect(res.body.data.maxDay).toBe(7);
    const one = await request(app()).get('/cohort?from=2026-10-01T00:00:00.000Z&to=2026-10-01T23:59:59.999Z');
    expect(one.body.data.maxDay).toBe(1);
  });
});
