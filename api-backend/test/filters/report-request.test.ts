/**
 * Report filter parsing + audience policy — PURE tests (no DB). Covers the filter bugs fixed in the
 * filters audit: "false" parsed as true, bad ids/dates reaching Postgres (500), advertisers probing
 * per-publisher volume via publisherId, multi-value exclusions, the totals-only mode, and the
 * Postgres provider keeping NULL rows on exclusions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const { reportQuerySchema, buildReportRequest } = await import('../../src/lib/reporting/request.js');
const { PostgresReportingProvider } = await import('../../src/lib/reporting/postgres.js');

const NET = '33333333-3333-4333-8333-333333333333';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const parse = (q: Record<string, unknown>) => reportQuerySchema.safeParse(q);

describe('reportQuerySchema', () => {
  it('excludeInvalid: "false" means false (z.coerce.boolean made it true)', () => {
    const r = parse({ excludeInvalid: 'false' });
    expect(r.success && r.data.excludeInvalid).toBe(false);
    const t = parse({ excludeInvalid: '1' });
    expect(t.success && t.data.excludeInvalid).toBe(true);
    expect(parse({ excludeInvalid: 'maybe' }).success).toBe(false);
  });

  it('rejects malformed ids and dates (400) instead of letting them reach a uuid/timestamp cast (500)', () => {
    expect(parse({ offerId: 'abc' }).success).toBe(false);
    expect(parse({ offerId: `${A},nope` }).success).toBe(false);
    expect(parse({ offerId: `${A},${B}` }).success).toBe(true);
    expect(parse({ excludePublisherId: `${A},${B}` }).success).toBe(true);
    expect(parse({ from: 'yesterday' }).success).toBe(false);
    expect(parse({ from: '2026-02-30' }).success).toBe(false);
    expect(parse({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T23:59:59.999Z' }).success).toBe(true);
    expect(parse({ from: '2026-10-09', to: '2026-10-01' }).success).toBe(false);
  });

  it('text filters accept repeated params literally (values containing commas stay intact)', () => {
    const r = parse({ isp: ['Comcast Cable, LLC'] });
    expect(r.success).toBe(true);
    const req = buildReportRequest(NET, r.success ? r.data : ({} as never), 'admin');
    expect(req.filters.isp).toBe('Comcast Cable, LLC');
  });
});

describe('buildReportRequest', () => {
  const build = (q: Record<string, unknown>, aud: 'admin' | 'advertiser' | 'publisher' = 'admin', force = {}) => {
    const r = parse(q);
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten()));
    return buildReportRequest(NET, r.data, aud, force);
  };

  it('splits comma lists into IN-lists and upper-cases countries', () => {
    const req = build({ offerId: `${A},${B}`, country: 'in,us', excludeCountry: 'cn' });
    expect(req.filters.offerId).toEqual([A, B]);
    expect(req.filters.country).toEqual(['IN', 'US']);
    expect(req.filters.excludeCountry).toBe('CN');
  });

  it('groupBy=none → grand-total request (no dimensions)', () => {
    expect(build({ groupBy: 'none' }).groupBy).toEqual([]);
    expect(build({}).groupBy).toEqual(['offer']);
  });

  it('advertiser audience: publisher/smart-link/sub filters are dropped; forced owner filter wins', () => {
    const req = build({ publisherId: A, excludePublisherId: B, smartLinkId: A, sub1: 'x', offerId: A, advertiserId: B }, 'advertiser', { advertiserId: A });
    expect(req.filters.publisherId).toBeUndefined();
    expect(req.filters.excludePublisherId).toBeUndefined();
    expect(req.filters.smartLinkId).toBeUndefined();
    expect(req.filters.sub1).toBeUndefined();
    expect(req.filters.offerId).toBe(A);
    expect(req.filters.advertiserId).toBe(A); // forced, not the caller's B
  });

  it('publisher audience: advertiser filters are dropped; forced publisher id wins', () => {
    const req = build({ advertiserId: A, publisherId: B }, 'publisher', { publisherId: A });
    expect(req.filters.advertiserId).toBeUndefined();
    expect(req.filters.publisherId).toBe(A);
  });
});

describe('PostgresReportingProvider SQL', () => {
  beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue({ rows: [{ total: 0 }] }); });

  const run = async (filters: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    await new PostgresReportingProvider().runReport({
      networkId: NET, groupBy: ['offer'], metrics: ['clicks'], filters, limit: 10, offset: 0, ...extra,
    } as never);
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]]; // the page query (after the count)
    return { sql, params };
  };

  it('exclusions keep rows whose value is NULL', async () => {
    const one = await run({ excludeSmartLinkId: A });
    expect(one.sql).toContain('clicks.smart_link_id::text IS DISTINCT FROM $2::text');
    const many = await run({ excludeCountry: ['CN', 'RU'] });
    expect(many.sql).toContain('(clicks.country IS NULL OR clicks.country::text <> ALL($2::text[]))');
    expect(many.params[1]).toEqual(['CN', 'RU']);
  });

  it('every value is a bound parameter; network scoping is always $1', async () => {
    const { sql, params } = await run({ offerId: [A, B], country: "x' OR 1=1 --" });
    expect(params[0]).toBe(NET);
    expect(sql).toContain('clicks.network_id = $1');
    expect(sql).not.toContain("OR 1=1");
  });

  it('orderBy cr sorts by the real ratio (it used to sort by clicks)', async () => {
    const { sql } = await run({}, { orderBy: 'cr', orderDir: 'desc' });
    expect(sql).toContain('ORDER BY s.conversions::numeric / NULLIF(s.clicks, 0) DESC NULLS LAST');
  });
});
