/**
 * Paged entity lists (GET /api/offers|publishers|advertisers?paged=1) — PURE tests of the query
 * schemas and SQL builders (no DB): invalid params rejected, every filter value bound as a parameter,
 * network id always $1, sort whitelist + stable tie-break, pageSize cap, and the total query sharing
 * the page query's WHERE. runPagedList is exercised against a mocked pool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const { offerListQuerySchema, buildOfferListQuery, OFFER_SORTS } = await import('../../src/surfaces/dashboard/offers/list-query.js');
const { publisherListQuerySchema, buildPublisherListQuery, regionOf } = await import('../../src/surfaces/dashboard/publishers/list-query.js');
const { advertiserListQuerySchema, buildAdvertiserListQuery } = await import('../../src/surfaces/dashboard/advertisers/list-query.js');
const { runPagedList, isPagedRequest } = await import('../../src/lib/http/paged-list.js');

const NET = '33333333-3333-4333-8333-333333333333';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const EVIL = "x'); DROP TABLE offers; --";

type Built = ReturnType<typeof buildOfferListQuery>;
/** The WHERE … part of a built query (up to ORDER BY, or the end for the total query). */
const whereOf = (sql: string) => {
  const end = sql.indexOf('\n ORDER BY');
  return sql.slice(sql.indexOf('WHERE'), end === -1 ? undefined : end);
};
const placeholders = (sql: string) => Array.from(new Set((sql.match(/\$\d+/g) ?? []).map((m) => Number(m.slice(1))))).sort((a, b) => a - b);

/** Shared invariants for any built list. */
function expectSafe(built: Built, userValues: unknown[]) {
  for (const q of [built.page, built.total, ...Object.values(built.counts)]) {
    expect(q.params[0]).toBe(NET); // tenant is always $1
    expect(q.sql).toMatch(/\.network_id = \$1/);
    // every placeholder has a value and every value is referenced
    const ph = placeholders(q.sql);
    expect(ph[ph.length - 1]).toBe(q.params.length);
    for (const v of userValues) {
      if (typeof v === 'string') expect(q.sql).not.toContain(v);
    }
  }
  // total = same FROM/WHERE text and the same params as the page minus LIMIT/OFFSET
  expect(whereOf(built.total.sql)).toBe(whereOf(built.page.sql));
  expect(built.total.params).toEqual(built.page.params.slice(0, -2));
  expect(built.total.sql.split('FROM')[1]!.split('WHERE')[0]).toBe(built.page.sql.split('FROM')[1]!.split('WHERE')[0]);
}

describe('isPagedRequest', () => {
  it('only an explicit paged=1/true selects the paged contract', () => {
    expect(isPagedRequest({ paged: '1' })).toBe(true);
    expect(isPagedRequest({ paged: 'true' })).toBe(true);
    expect(isPagedRequest({})).toBe(false);
    expect(isPagedRequest({ paged: '0' })).toBe(false);
    expect(isPagedRequest({ limit: '50' })).toBe(false);
  });
});

describe('offers paged list', () => {
  const parse = (q: Record<string, unknown>) => offerListQuerySchema.safeParse({ paged: '1', ...q });
  const build = (q: Record<string, unknown>) => {
    const r = parse(q);
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten()));
    return buildOfferListQuery(NET, r.data);
  };

  it('rejects invalid params (→ 422 via validateQuery) instead of reaching SQL', () => {
    expect(parse({ pageSize: '201' }).success).toBe(false);
    expect(parse({ pageSize: '0' }).success).toBe(false);
    expect(parse({ page: '0' }).success).toBe(false);
    expect(parse({ page: 'abc' }).success).toBe(false);
    expect(parse({ sort: 'name; DROP TABLE offers' }).success).toBe(false);
    expect(parse({ sort: 'o.secret' }).success).toBe(false);
    expect(parse({ dir: 'sideways' }).success).toBe(false);
    expect(parse({ status: 'active,bogus' }).success).toBe(false);
    expect(parse({ advertiserId: 'not-a-uuid' }).success).toBe(false);
    expect(parse({ country: 'IND' }).success).toBe(false);
    expect(parse({ deviceType: 'toaster' }).success).toBe(false);
    expect(parse({ revenueType: 'CPA' }).success).toBe(false);
    expect(parse({ searchField: 'secret' }).success).toBe(false);
  });

  it('defaults: page 1, pageSize 50, newest first with an id tie-break', () => {
    const b = build({});
    expect(b.page.params.slice(-2)).toEqual([50, 0]);
    expect(b.page.sql).toMatch(/ORDER BY o\.created_at DESC NULLS LAST, o\.id DESC/);
  });

  it('page/pageSize become bound LIMIT/OFFSET', () => {
    const b = build({ page: '3', pageSize: '200' });
    expect(b.page.params.slice(-2)).toEqual([200, 400]);
    expect(b.page.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+$/);
  });

  it('sort keys map only through the whitelist', () => {
    for (const [key, expr] of Object.entries(OFFER_SORTS)) {
      const b = build({ sort: key, dir: 'asc' });
      expect(b.page.sql).toContain(`ORDER BY ${expr} ASC NULLS LAST, o.id ASC`);
    }
  });

  it('binds every filter value as a parameter; network id stays $1', () => {
    const q = {
      search: EVIL, searchField: 'advertiser', name: '50%_off', offerIds: `101,${A}`, status: 'active,paused',
      advertiserId: A, category: EVIL, tagId: B, offerGroupId: A, accountManagerId: A, salesManagerId: B,
      trackingDomainId: A, visibility: 'private', payoutType: 'CPA', revenueType: 'RPL', objective: 'leads',
      deviceType: 'mobile', country: 'in', platform: EVIL,
    };
    const b = build(q);
    expectSafe(b, [EVIL, '50%_off']);
    expect(b.page.params).toContain('%x\'); DROP TABLE offers; --%');
    expect(b.page.params).toContain('%50\\%\\_off%'); // LIKE metacharacters escaped
    expect(b.page.params).toContain('IN'); // country upper-cased
    expect(b.page.params).toContainEqual(['CPL']); // RPL → CPL
    expect(b.page.sql).toContain(`ESCAPE '\\'`);
    expect(b.page.sql).toContain('offer_geo_rules g');
    expect(b.page.sql).toContain(`metadata->'targeting'->'platform'`);
    expect(b.page.sql).toContain('og.offer_ids ? o.id::text');
    expect(b.page.sql).toContain('a.account_manager_id = ANY(');
  });

  it('search field picks the matched column', () => {
    expect(build({ search: 'x', searchField: 'name' }).page.sql).toContain('o.name ILIKE');
    expect(build({ search: 'x', searchField: 'id' }).page.sql).toMatch(/o\.ref::text ILIKE .* OR o\.id::text ILIKE/);
    expect(build({ search: 'x', searchField: 'advertiser' }).page.sql).toContain(`'(' || a.ref::text || ') ' || a.name`);
  });

  it('status counts drop only the status filter', () => {
    const b = build({ status: 'active', category: 'Finance' });
    const counts = b.counts['statuses']!;
    expect(counts.sql).not.toContain('o.status = ANY');
    expect(counts.sql).toContain('lower(btrim(o.category))');
    expect(counts.sql).toMatch(/GROUP BY 1$/);
    expect(b.page.sql).toContain('o.status = ANY');
  });
});

describe('publishers paged list', () => {
  const parse = (q: Record<string, unknown>) => publisherListQuerySchema.safeParse({ paged: '1', ...q });
  const build = (q: Record<string, unknown>) => {
    const r = parse(q);
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten()));
    return buildPublisherListQuery(NET, r.data);
  };

  it('rejects invalid params', () => {
    expect(parse({ tab: 'deleted' }).success).toBe(false);
    expect(parse({ region: 'Atlantis' }).success).toBe(false);
    expect(parse({ channelId: 'abc' }).success).toBe(false);
    expect(parse({ hasRunTraffic: 'maybe' }).success).toBe(false);
    expect(parse({ payable: 'perhaps' }).success).toBe(false);
    expect(parse({ pageSize: '500' }).success).toBe(false);
    expect(parse({ sort: 'payment_method' }).success).toBe(false);
  });

  it('free-text lists keep commas literally (repeated params)', () => {
    const r = parse({ country: ['Korea, Republic of', 'India'] });
    expect(r.success && r.data.country).toEqual(['Korea, Republic of', 'India']);
  });

  it('binds every filter value; tabs, traffic and channel are SQL predicates', () => {
    const b = build({
      tab: 'existing', search: EVIL, status: 'active', accountExecutiveId: A, partnerManagerId: B, channelId: A,
      label: B, billingFrequency: 'Monthly', country: [EVIL], region: 'Europe,Other,Unknown', tier: 'Gold',
      paymentMethod: ' PayPal ', paymentTerms: 'Net 30', payable: 'yes', hasRunTraffic: 'true',
    });
    expectSafe(b as Built, [EVIL]);
    expect(b.page.sql).toContain(`p.auth_user_id IS NOT NULL`);
    expect(b.page.sql).toContain('EXISTS (SELECT 1 FROM clicks c WHERE c.network_id = $1 AND c.publisher_id = p.id)');
    expect(b.page.sql).toContain('p.channel_id = ANY(');
    expect(b.page.sql).toContain('sc.network_id = p.network_id');
    expect(b.page.params).toContainEqual(['paypal']);
    expect(b.page.params).toContainEqual(expect.arrayContaining(['GB', 'DE']));
    expect(b.page.params).toContainEqual(expect.arrayContaining(['united kingdom', 'uk']));
  });

  it('Has Run Traffic + No Traffic together means everyone; payable yes+no likewise', () => {
    const b = build({ hasRunTraffic: '1', noTraffic: '1', payable: 'yes,no' });
    expect(b.page.sql).not.toContain('clicks c');
    expect(b.page.sql).not.toContain('payment_method <>');
    expect(build({ noTraffic: '1' }).page.sql).toContain('NOT EXISTS (SELECT 1 FROM clicks c');
  });

  it('tab counts are network-wide; status counts keep the tab but drop status', () => {
    const b = build({ tab: 'pending', status: 'pending', search: 'acme' });
    expect(b.counts['tabs']!.sql).not.toContain('ILIKE');
    expect(b.counts['tabs']!.params).toEqual([NET]);
    expect(b.counts['statuses']!.sql).toContain(`p.status = 'pending'`);
    expect(b.counts['statuses']!.sql).not.toContain('p.status = ANY');
  });

  it('regionOf mirrors the page bucketing (codes, names, aliases, Other, Unknown)', () => {
    expect(regionOf('IN')).toBe('Asia');
    expect(regionOf(' india ')).toBe('Asia');
    expect(regionOf('United States')).toBe('North America');
    expect(regionOf('usa')).toBe('North America');
    expect(regionOf('uk')).toBe('Europe');
    expect(regionOf('FI')).toBe('Other');
    expect(regionOf('Narnia')).toBe('Other');
    expect(regionOf('')).toBe('Unknown');
    expect(regionOf(null)).toBe('Unknown');
  });
});

describe('advertisers paged list', () => {
  const parse = (q: Record<string, unknown>) => advertiserListQuerySchema.safeParse({ paged: '1', ...q });
  const build = (q: Record<string, unknown>) => {
    const r = parse(q);
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten()));
    return buildAdvertiserListQuery(NET, r.data);
  };

  it('rejects invalid params', () => {
    expect(parse({ accountManagerId: 'x' }).success).toBe(false);
    expect(parse({ status: 'archived' }).success).toBe(false);
    expect(parse({ sort: 'contact_email' }).success).toBe(false);
    expect(parse({ pageSize: '1000' }).success).toBe(false);
  });

  it('binds every filter value and keeps the tenant at $1', () => {
    const b = build({ tab: 'unverified', search: EVIL, status: 'active,inactive', accountManagerId: A, salesManagerId: B, billingFrequency: 'Weekly', label: A, sort: 'name', dir: 'asc' });
    expectSafe(b as Built, [EVIL]);
    expect(b.page.sql).toContain('a.auth_user_id IS NULL');
    expect(b.page.sql).toContain(`t.entity_type = 'advertiser'`);
    expect(b.page.sql).toContain('ORDER BY lower(a.name) ASC NULLS LAST, a.id ASC');
  });
});

describe('runPagedList', () => {
  beforeEach(() => { queryMock.mockReset(); });

  it('runs page, total and counts with their own params and shapes the result', async () => {
    const r = publisherListQuerySchema.parse({ paged: '1', page: '2', pageSize: '10', status: 'active' });
    const built = buildPublisherListQuery(NET, r);
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT p.*')) return { rows: [{ id: A }, { id: B }] };
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ n: '12' }] };
      if (sql.includes('THEN \'unverified\'')) return { rows: [{ k: 'existing', n: '9' }, { k: 'pending', n: '3' }] };
      return { rows: [{ k: 'active', n: '12' }, { k: null, n: '1' }] };
    });
    const out = await runPagedList(built, r, (row: { id: string }) => row.id);
    expect(out).toEqual({
      rows: [A, B], total: 12, page: 2, pageSize: 10,
      counts: { statuses: { active: 12 }, tabs: { existing: 9, pending: 3 } },
    });
    expect(queryMock).toHaveBeenCalledTimes(4);
    for (const [, params] of queryMock.mock.calls) expect((params as unknown[])[0]).toBe(NET);
  });
});
