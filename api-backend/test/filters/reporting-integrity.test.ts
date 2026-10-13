/**
 * Reporting integrity — PURE tests (no DB; the pg pool is mocked). Covers: the custom-metric formula
 * grammar and empty-PATCH validation, inbound secure-code redaction in the Conversions report,
 * `/grouped` rejecting unknown params, and the Pacing report counting conversions the way cap
 * enforcement does (non-rejected), tenant-scoping its subqueries and returning money as text;
 * malformed / non-positive caps never reaching a numeric cast; offer-group caps rejecting
 * non-finite values; Customer Value refusing (and never returning) secret raw-param keys; and the
 * Event report carrying each row's currency and grouping by goal id (goal-less conversions as
 * separate `unmatched` rows); the Click report's `conversionStatus` filter on /clicks + /grouped;
 * the Click→Conversion Time `status` filter; the opt-in `currencies` metric (Postgres + ClickHouse
 * SQL) and `currencies` on /grouped / Pacing with the mixed-currency Pacing summary; and `redactUrl`
 * masking partner credentials in /postback-logs; the opt-in `money_by_currency` metric (audience
 * fields, Postgres + ClickHouse SQL), money sorts that never compare currencies
 * (`sortedWithinCurrency`), and `moneyByCurrency` on /dashboard, /summary, /grouped, /goals, Pacing,
 * /cohort and the offer-group stats.
 * The same behaviours are exercised end-to-end on a real Postgres in
 * test/isolation/reporting-integrity.test.ts (INTEGRATION_DB=1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express, type Router } from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const { errorHandler } = await import('../../src/lib/http/envelope.js');
const { mountDetailReports } = await import('../../src/surfaces/dashboard/reports/detail-reports.js');
const { customMetricsRoutes, isValidFormula } = await import('../../src/surfaces/dashboard/custom-metrics/routes.js');
const { redactRawParams, REDACTED, isSensitiveParamKey } = await import('../../src/lib/reporting/redact.js');
const { offerGroupsRoutes } = await import('../../src/surfaces/dashboard/offer-groups/routes.js');
const { customerValueRoutes } = await import('../../src/surfaces/dashboard/customer-value/routes.js');
const { redactUrl } = await import('../../src/lib/reporting/redact.js');
const { reportQuerySchema, buildReportRequest } = await import('../../src/lib/reporting/request.js');
const { PostgresReportingProvider } = await import('../../src/lib/reporting/postgres.js');
const { ClickHouseReportingProvider } = await import('../../src/lib/reporting/clickhouse-provider.js');
type FormulaToken = Parameters<typeof isValidFormula>[0][number];

const NET = '33333333-3333-4333-8333-333333333333';
const A = '11111111-1111-4111-8111-111111111111';

function appWith(mount: (a: Express) => void): Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    const r = req as unknown as { scope: unknown; identity: unknown };
    r.scope = { networkId: NET };
    r.identity = { surface: 'dashboard', kind: 'admin', role: 'admin', userId: 'u1', networkId: NET };
    next();
  });
  mount(a);
  a.use(errorHandler);
  return a;
}
const reportsApp = () => appWith((a) => { const r: Router = express.Router(); mountDetailReports(r); a.use('/', r); });
const metricsApp = () => appWith((a) => a.use('/', customMetricsRoutes()));
const groupsApp = () => appWith((a) => a.use('/', offerGroupsRoutes()));
const cvApp = () => appWith((a) => a.use('/', customerValueRoutes()));
const calls = () => queryMock.mock.calls.map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }));

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── Custom metric formula grammar ──
const m = (key: 'clicks' | 'conversions' | 'payout'): FormulaToken => ({ type: 'metric', key });
const c = (value: number): FormulaToken => ({ type: 'const', value });
const o = (value: '+' | '-' | '*' | '/' | '(' | ')'): FormulaToken => ({ type: 'op', value });

describe('isValidFormula', () => {
  it.each<[string, FormulaToken[]]>([
    ['metric', [m('clicks')]],
    ['const', [c(-5)]],
    ['binary', [m('conversions'), o('/'), m('clicks')]],
    ['precedence chain', [m('payout'), o('*'), c(100), o('-'), c(1), o('+'), m('clicks')]],
    ['parenthesised operand', [o('('), m('conversions'), o('/'), m('clicks'), o(')'), o('*'), c(100)]],
    ['nested parens', [o('('), o('('), m('clicks'), o(')'), o(')')]],
    ['operand after group', [c(2), o('*'), o('('), m('clicks'), o('+'), c(1), o(')')]],
  ])('accepts %s', (_name, tokens) => {
    expect(isValidFormula(tokens)).toBe(true);
  });

  it.each<[string, FormulaToken[]]>([
    ['empty', []],
    ['lone operator [+]', [o('+')]],
    ['unclosed ( clicks', [o('('), m('clicks')]],
    ['adjacent operands clicks clicks', [m('clicks'), m('clicks')]],
    ['metric then const', [m('clicks'), c(2)]],
    ['empty ()', [o('('), o(')')]],
    ['empty () inside an expression', [m('clicks'), o('+'), o('('), o(')')]],
    ['leading operator (unary minus)', [o('-'), m('clicks')]],
    ['unary after operator', [m('clicks'), o('*'), o('-'), c(1)]],
    ['trailing operator', [m('clicks'), o('/')]],
    ['doubled operator', [m('clicks'), o('+'), o('+'), m('payout')]],
    ['operator right after (', [o('('), o('+'), m('clicks'), o(')')]],
    ['operator right before )', [o('('), m('clicks'), o('+'), o(')')]],
    ['unmatched )', [m('clicks'), o(')')]],
    [') then (', [o(')'), o('(')]],
    ['operand right after )', [o('('), m('clicks'), o(')'), m('payout')]],
    ['( right after operand', [m('clicks'), o('('), m('payout'), o(')')]],
    ['unbalanced ((', [o('('), o('('), m('clicks'), o(')')]],
  ])('rejects %s', (_name, tokens) => {
    expect(isValidFormula(tokens)).toBe(false);
  });
});

describe('custom metrics validation (422 before any DB work)', () => {
  it('PATCH {} → 422 validation envelope (not a 500)', async () => {
    const res = await request(metricsApp()).patch(`/${A}`).send({});
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBeTruthy();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each([
    ['[+]', [{ type: 'op', value: '+' }]],
    ['( clicks', [{ type: 'op', value: '(' }, { type: 'metric', key: 'clicks' }]],
    ['clicks clicks', [{ type: 'metric', key: 'clicks' }, { type: 'metric', key: 'clicks' }]],
  ])('POST and PATCH reject formula %s with a clear 422', async (_n, formula) => {
    const post = await request(metricsApp()).post('/').send({ name: 'Bad', formula });
    expect(post.status).toBe(422);
    expect(JSON.stringify(post.body.error)).toMatch(/not a valid expression/);
    const patch = await request(metricsApp()).patch(`/${A}`).send({ formula });
    expect(patch.status).toBe(422);
    expect(JSON.stringify(patch.body.error)).toMatch(/not a valid expression/);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

// ── Secure-code redaction ──
describe('redactRawParams', () => {
  it('replaces secure_code / security_code values in any case, keeps the keys and every other param', () => {
    const out = redactRawParams({ secure_code: 's3cret', Security_Code: 'X', SECURE_CODE: 'Y', click_id: 'abc', payout: '1.5' });
    expect(out).toEqual({ secure_code: REDACTED, Security_Code: REDACTED, SECURE_CODE: REDACTED, click_id: 'abc', payout: '1.5' });
  });
  it('redacts nested objects and leaves null / non-objects alone', () => {
    expect(redactRawParams({ data: { security_code: 'z', a: 1 } })).toEqual({ data: { security_code: REDACTED, a: 1 } });
    expect(redactRawParams(null)).toBeNull();
    expect(redactRawParams('secure_code')).toBe('secure_code');
  });
  it('does not touch look-alike keys', () => {
    expect(redactRawParams({ secure_code_hint: 'h', my_security_code: 'k' })).toEqual({ secure_code_hint: 'h', my_security_code: 'k' });
  });
});

describe('/conversions redacts inbound security codes', () => {
  it('returns [redacted] for the code params and the rest unchanged', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ conversion_id: 'c1', raw_params: { secure_code: 'abc', Security_Code: 'def', click_id: 'k1' } }] });
    const res = await request(reportsApp()).get('/conversions');
    expect(res.status).toBe(200);
    expect(res.body.data[0].raw_params).toEqual({ secure_code: REDACTED, Security_Code: REDACTED, click_id: 'k1' });
    expect(res.body.data[0].conversion_id).toBe('c1');
  });
  it('orders by created_at then conversion_id, so offset pages never repeat or skip a conversion', async () => {
    await request(reportsApp()).get('/conversions?limit=25&offset=50');
    expect(calls()[0]!.sql).toMatch(/ORDER BY v\.created_at DESC, v\.conversion_id DESC LIMIT \$\d+ OFFSET \$\d+/);
  });
});

// ── /grouped strict ──
describe('/grouped rejects unknown params', () => {
  it.each(['status=approved', 'event=install', 'foo=bar', 'limit=10'])('?%s → 422 and never queries', async (qs) => {
    const res = await request(reportsApp()).get(`/grouped?groupBy=offer&${qs}`);
    expect(res.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('still accepts every key the Click report sends (and the plural aliases)', async () => {
    const day = 'from=2026-10-01T00:00:00.000Z&to=2026-10-08T23:59:59.999Z';
    for (const url of [
      `/grouped?groupBy=publisher&${day}&offerId=${A}&advertiserId=${A}&publisherId=${A}&smartLinkId=${A}&country=US&device=mobile`,
      `/grouped?groupBy=day&offerIds=${A}&publisherIds=${A}&advertiserIds=${A}&smartLinkIds=${A}`,
    ]) {
      const res = await request(reportsApp()).get(url);
      expect(res.status, url).toBe(200);
    }
  });
});

// ── /pacing ──
describe('/pacing', () => {
  const pacingCall = (fragment: RegExp) => calls().find((x) => fragment.test(x.sql));

  it('counts conversion-cap usage like enforcement: non-rejected, UTC day, network-scoped subqueries', async () => {
    const res = await request(reportsApp()).get('/pacing?category=conversion');
    expect(res.status).toBe(200);
    const conv = pacingCall(/AS conversions_total/)!;
    expect(conv.sql).not.toMatch(/status = 'approved'/);
    expect(conv.sql.match(/c\.status <> 'rejected'/g)).toHaveLength(2);
    expect(conv.sql.match(/c\.network_id = o\.network_id AND c\.offer_id = o\.id/g)).toHaveLength(2);
    expect(conv.sql).toContain(`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    const click = pacingCall(/clicks_today/)!;
    expect(click.sql).toMatch(/cl\.network_id = o\.network_id AND cl\.offer_id = o\.id/);
    const detail = pacingCall(/GROUP BY 1, 2 ORDER BY 1 DESC/)!;
    expect(detail.sql).toMatch(/c\.status <> 'rejected'/);
    expect(detail.sql).not.toMatch(/status = 'approved'/);
  });

  it('keeps payout/revenue usage approved-only and returns cap/actual as exact decimal text', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/GROUP BY 1, 2, 3, 4/.test(sql)) {
        return { rows: [{ day: '2026-10-08T00:00:00.000Z', group_id: 'g1', group_name: 'G', cap: '100.5000', actual: '25.1250', currency: 'EUR' }] };
      }
      return { rows: [] };
    });
    const res = await request(reportsApp()).get('/pacing?category=payout');
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([{ date: '2026-10-08T00:00:00.000Z', entity: 'G', entityId: 'g1', cap: '100.5000', actual: '25.1250', currency: 'EUR', currencies: [], moneyByCurrency: {}, usedPct: 25 }]);
    const detail = pacingCall(/GROUP BY 1, 2, 3, 4/)!;
    expect(detail.sql).toMatch(/c\.status = 'approved'/);
    expect(detail.sql).toMatch(/::numeric\(14,4\)::text AS actual/);
  });

  it('/caps subqueries are tenant-scoped and count non-rejected conversions', async () => {
    const res = await request(reportsApp()).get('/caps');
    expect(res.status).toBe(200);
    const { sql } = calls()[0]!;
    expect(sql.match(/c\.network_id = o\.network_id/g)).toHaveLength(2);
    expect(sql).toMatch(/cl\.network_id = o\.network_id/);
    expect(sql).not.toMatch(/status = 'approved'/);
  });
});

// ── Malformed / non-positive caps ──
describe('/pacing and /caps never cast an unvalidated cap', () => {
  it.each(['click', 'conversion', 'payout', 'revenue'])('category=%s: every group-cap cast sits behind the decimal guard; offer caps need > 0', async (category) => {
    const res = await request(reportsApp()).get(`/pacing?category=${category}`);
    expect(res.status).toBe(200);
    for (const { sql } of calls()) {
      const casts = sql.match(/->>'daily'\)::numeric/g) ?? [];
      const guards = sql.match(/->>'daily' ~ '\^\[0-9\]\{1,15\}\(\[\.\]\[0-9\]\{1,100\}\)\?\$'/g) ?? [];
      expect(casts.length).toBe(guards.length);
      expect(sql).not.toMatch(/->>'daily' IS NOT NULL/);
      expect(sql).not.toMatch(/o\.(daily_click_cap|daily_conversion_cap|total_conversion_cap) IS NOT NULL/);
    }
    const group = calls().find((x) => /FROM offer_groups og/.test(x.sql))!;
    expect(group.sql).toMatch(/NULLIF\(CASE WHEN og\.caps->'payout'->>'daily' ~/);
    expect(calls().find((x) => /clicks_today/.test(x.sql))!.sql).toMatch(/o\.daily_click_cap > 0/);
    expect(calls().find((x) => /AS conversions_total/.test(x.sql))!.sql).toMatch(/\(o\.daily_conversion_cap > 0 OR o\.total_conversion_cap > 0\)/);
  });

  it('payout detail joins only groups with a valid positive cap and carries the group currency', async () => {
    await request(reportsApp()).get('/pacing?category=revenue');
    const detail = calls().find((x) => /GROUP BY 1, 2, 3, 4, 6/.test(x.sql))!;
    expect(detail.sql).toMatch(/AND og\.caps_enabled AND NULLIF\(CASE WHEN og\.caps->'revenue'->>'daily' ~/);
    expect(detail.sql).toMatch(/COALESCE\(NULLIF\(og\.currency, ''\), \(SELECT n\.default_currency FROM networks n WHERE n\.id = \$1\)\) AS currency/);
  });

  it('a summary built from rows with no valid cap is 200 with null percentages (no NaN)', async () => {
    const res = await request(reportsApp()).get('/pacing?category=payout');
    expect(res.status).toBe(200);
    for (const s of res.body.data.summary) expect(s.dailyUsedPct).toBeNull();
  });

  it('/caps reads non-positive offer caps as NULL and lists only offers with a positive cap', async () => {
    await request(reportsApp()).get('/caps');
    const { sql } = calls()[0]!;
    expect(sql).toContain('CASE WHEN o.daily_click_cap > 0 THEN o.daily_click_cap END AS daily_click_cap');
    expect(sql).toMatch(/\(o\.daily_conversion_cap > 0 OR o\.total_conversion_cap > 0 OR o\.daily_click_cap > 0\)/);
  });
});

describe('offer-group caps validation', () => {
  it.each([
    ['a string', '{"name":"G","caps":{"payout":{"daily":"abc"}}}'],
    ['a negative number', '{"name":"G","caps":{"revenue":{"daily":-5}}}'],
    ['1e999 (parses to Infinity)', '{"name":"G","caps":{"payout":{"daily":1e999}}}'],
  ])('POST with %s → 422 before any DB work', async (_n, body) => {
    const res = await request(groupsApp()).post('/').set('content-type', 'application/json').send(body);
    expect(res.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });
  it('PATCH with a non-finite cap → 422', async () => {
    const res = await request(groupsApp()).patch(`/${A}`).set('content-type', 'application/json').send('{"caps":{"clicks":{"global":-1e999}}}');
    expect(res.status).toBe(422);
  });
});

// ── Sensitive raw-param keys ──
describe('isSensitiveParamKey / redactRawParams cover every secret name', () => {
  it.each(['secure_code', 'Security_Code', 'secure-code', 'SECURECODE', 'secret', 'token', 'access_token', 'Access-Token',
    'api_key', 'apikey', 'API-KEY', 'password', 'signature', 'client_secret', 'refresh_token', 'authorization'])('%s is sensitive', (k) => {
    expect(isSensitiveParamKey(k)).toBe(true);
    expect(redactRawParams({ [k]: 'v', keep: 'x' })).toEqual({ [k]: REDACTED, keep: 'x' });
  });
  it.each(['user_id', 'plan', 'secure_code_hint', 'my_security_code', 'promo_token', 'token_count', 'sale_amount'])('%s is an ordinary param', (k) => {
    expect(isSensitiveParamKey(k)).toBe(false);
  });
});

describe('Customer Value data points', () => {
  it.each(['secure_code', 'SECURITY_CODE', 'api_key', 'token', 'password'])('POST and PATCH reject parameterKey %s with 422', async (parameterKey) => {
    const post = await request(cvApp()).post('/data-points').send({ name: 'X', dataType: 'text', parameterKey });
    expect(post.status).toBe(422);
    expect(JSON.stringify(post.body.error)).toMatch(/carries a secret/);
    const patch = await request(cvApp()).patch(`/data-points/${A}`).send({ name: 'X', dataType: 'text', parameterKey });
    expect(patch.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('/conversion-events reads only non-secret data-point keys from raw_params, never the whole bag', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [
        { id: 'dp1', name: 'Plan', data_type: 'text', parameter_key: 'plan' },
        { id: 'dp2', name: 'Code', data_type: 'text', parameter_key: 'secure_code' }, // predates the 422 check
      ] })
      .mockResolvedValueOnce({ rows: [{ conversion_id: 'c1', created_at: 't', offer_id: A, offer_name: 'O', event_name: null,
        status: 'approved', payout: '1', revenue: '2', dp_values: ['gold'], rule_id: null, rule_name: null }] });
    const res = await request(cvApp()).get('/conversion-events?userId=u1');
    expect(res.status).toBe(200);
    expect(res.body.data.events[0].dataPoints).toEqual([{ name: 'Plan', parameterKey: 'plan', value: 'gold' }]);
    const { sql, params } = calls()[1]!;
    expect(sql).not.toMatch(/c\.raw_params(?!->>)/);
    expect(params).toContainEqual(['plan']);
    expect(JSON.stringify(params)).not.toContain('secure_code');
    expect(JSON.stringify(res.body)).not.toMatch(/secure_code/);
  });
});

// ── Event report currency ──
describe('/goals rows carry the offer currency', () => {
  it('selects the offer currency with the network default as fallback and returns it per row', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::int AS total FROM (')) return { rows: [{ total: 1 }] };
      if (sql.includes('FROM clicks')) return { rows: [] };
      return { rows: [{ goal: 'install', offer_id: A, conversions: 1, payout: '1.0000', revenue: '3.0000', margin: '2.0000', currency: 'INR' }] };
    });
    const res = await request(reportsApp()).get('/goals');
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0]).toMatchObject({ offer_id: A, currency: 'INR' });
    const page = calls().find((x) => x.sql.includes('ORDER BY conversions DESC'))!;
    expect(page.sql).toMatch(/COALESCE\(\(SELECT o\.currency FROM offers o WHERE o\.id = c\.offer_id AND o\.network_id = \$1\),\s+\(SELECT n\.default_currency FROM networks n WHERE n\.id = \$1\)\) AS currency/);
    expect(page.sql).toMatch(/GROUP BY c\.offer_id, c\.goal_id, \(CASE WHEN c\.goal_id IS NULL THEN c\.event_name END\)/);
  });
});

// ── Click report: Conversion Status filter ──
describe('conversionStatus on /clicks and /grouped', () => {
  const clicksSql = () => calls().find((x) => /FROM clicks WHERE/.test(x.sql))!;

  it('absent → no predicate (only the unchanged `converted` column references conversions)', async () => {
    const res = await request(reportsApp()).get('/clicks');
    expect(res.status).toBe(200);
    const { sql, params } = clicksSql();
    expect(sql.match(/FROM conversions/g)).toHaveLength(1);
    expect(sql).toMatch(/EXISTS\(SELECT 1 FROM conversions cv WHERE cv\.click_id = clicks\.click_id AND cv\.network_id = clicks\.network_id\) AS converted/);
    expect(params).toEqual([NET, 100, 0]);
  });

  it.each([
    ['any', /AND EXISTS \(SELECT 1 FROM conversions cs WHERE cs\.click_id = clicks\.click_id AND cs\.network_id = clicks\.network_id\)/, [NET, 100, 0]],
    ['none', /AND NOT EXISTS \(SELECT 1 FROM conversions cs WHERE cs\.click_id = clicks\.click_id AND cs\.network_id = clicks\.network_id\)/, [NET, 100, 0]],
    ['approved', /AND EXISTS \(SELECT 1 FROM conversions cs WHERE cs\.click_id = clicks\.click_id AND cs\.network_id = clicks\.network_id AND cs\.status = \$2\)/, [NET, 'approved', 100, 0]],
    ['pending', /AND cs\.status = \$2\)/, [NET, 'pending', 100, 0]],
    ['rejected', /AND cs\.status = \$2\)/, [NET, 'rejected', 100, 0]],
  ] as const)('/clicks?conversionStatus=%s filters the click rows', async (s, re, params) => {
    const res = await request(reportsApp()).get(`/clicks?conversionStatus=${s}`);
    expect(res.status).toBe(200);
    const q = clicksSql();
    expect(q.sql).toMatch(re);
    expect(q.params).toEqual(params);
    // `converted` stays "any status".
    expect(q.sql).toMatch(/EXISTS\(SELECT 1 FROM conversions cv WHERE cv\.click_id = clicks\.click_id AND cv\.network_id = clicks\.network_id\) AS converted/);
  });

  it('an unknown value is a 422', async () => {
    expect((await request(reportsApp()).get('/clicks?conversionStatus=converted')).status).toBe(422);
    expect((await request(reportsApp()).get('/grouped?conversionStatus=yes')).status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('/grouped absent → neither side is constrained', async () => {
    await request(reportsApp()).get('/grouped?groupBy=offer');
    const { sql, params } = calls()[0]!;
    expect(sql).not.toMatch(/conversions cs/);
    expect(sql).not.toMatch(/clicks kc/);
    expect(params).toEqual([NET]);
  });

  it.each(['any', 'approved', 'pending', 'rejected', 'none'] as const)('/grouped?conversionStatus=%s constrains clicks and the conversions of those clicks', async (s) => {
    const res = await request(reportsApp()).get(`/grouped?groupBy=offer&conversionStatus=${s}`);
    expect(res.status).toBe(200);
    const { sql, params } = calls()[0]!;
    const cl = sql.slice(sql.indexOf('WITH cl AS'), sql.indexOf('), cv AS'));
    const cv = sql.slice(sql.indexOf('), cv AS'), sql.indexOf('SELECT COALESCE(cl.k'));
    const not = s === 'none' ? 'NOT ' : '';
    expect(cl).toContain(`${not}EXISTS (SELECT 1 FROM conversions cs WHERE cs.click_id = c.click_id AND cs.network_id = c.network_id`);
    expect(cv).toContain('EXISTS (SELECT 1 FROM clicks kc WHERE kc.click_id = v.click_id AND kc.network_id = v.network_id)');
    expect(cv).toContain(`${not}EXISTS (SELECT 1 FROM conversions cs WHERE cs.click_id = v.click_id AND cs.network_id = v.network_id`);
    if (s === 'any' || s === 'none') expect(params).toEqual([NET]);
    else {
      // Each side binds the status once; the conversions side's placeholder is shifted past the clicks params.
      expect(params).toEqual([NET, s, s]);
      expect(cl).toContain('cs.status = $2');
      expect(cv).toContain('cs.status = $3');
    }
  });
});

// ── Click Report filter modal: clickIds / ip / isUnique (Visibility) ──
describe('Click Report filters: clickIds, ip, isUnique on /clicks and /grouped', () => {
  const ID1 = 'a'.repeat(32);
  const ID2 = '0123456789abcdef0123456789abcdef';
  const clicksSql = () => calls().find((x) => /FROM clicks WHERE/.test(x.sql))!;

  it('/clicks absent → unchanged filters; the row adds the stored referrer/user agent/currency/rates', async () => {
    await request(reportsApp()).get('/clicks');
    const { sql, params } = clicksSql();
    expect(params).toEqual([NET, 100, 0]);
    expect(sql).not.toMatch(/click_id = ANY|::inet/);
    expect(sql).toMatch(/referrer, user_agent, currency,[\s\S]*resolved_payout::text AS resolved_payout, resolved_revenue::text AS resolved_revenue/);
    // A blank stored value (an earlier build stored '') is returned as NULL — the data is not rewritten.
    for (const col of ['source_id', 'fbclid', 'gclid']) expect(sql).toContain(`CASE WHEN btrim(${col}) = '' THEN NULL ELSE ${col} END AS ${col}`);
    expect(sql).not.toMatch(/source_id = \$|fbclid = \$|gclid = \$/);
  });

  it('sourceId / fbclid / gclid: trimmed exact matches on the stored click-URL values', async () => {
    for (const [k, col] of [['sourceId', 'source_id'], ['fbclid', 'fbclid'], ['gclid', 'gclid']] as const) {
      queryMock.mockClear();
      const res = await request(reportsApp()).get(`/clicks?${k}=${encodeURIComponent(' v-1 ')}`);
      expect(res.status, k).toBe(200);
      expect(clicksSql().sql, k).toContain(`AND ${col} = $2`);
      expect(clicksSql().params, k).toEqual([NET, 'v-1', 100, 0]);
    }
    // Blank / whitespace-only filters are rejected (a blank value is "not present", never matched).
    for (const bad of ['gclid=', 'gclid=%20%20', 'fbclid=%09', 'sourceId=%20', `sourceId=${'x'.repeat(501)}`]) {
      expect((await request(reportsApp()).get(`/clicks?${bad}`)).status, bad).toBe(422);
    }
  });

  it('clickIds: trimmed, de-duplicated, empty entries dropped, bound as one text[]', async () => {
    const res = await request(reportsApp()).get(`/clicks?clickIds=${encodeURIComponent(` ${ID1} ,,${ID2}, ${ID1}`)}`);
    expect(res.status).toBe(200);
    const { sql, params } = clicksSql();
    expect(sql).toContain('AND click_id = ANY($2::text[])');
    expect(params).toEqual([NET, [ID1, ID2], 100, 0]);
  });

  it('ip: exact inet match (v4 and v6)', async () => {
    await request(reportsApp()).get('/clicks?ip=10.0.0.1');
    expect(clicksSql().sql).toContain('AND ip = $2::inet');
    expect(clicksSql().params).toEqual([NET, '10.0.0.1', 100, 0]);
    queryMock.mockClear();
    expect((await request(reportsApp()).get(`/clicks?ip=${encodeURIComponent('2001:db8::1')}`)).status).toBe(200);
  });

  it('combined with conversionStatus and isUnique, placeholders stay in order', async () => {
    await request(reportsApp()).get(`/clicks?isUnique=false&conversionStatus=approved&clickIds=${ID1}&ip=10.0.0.1`);
    const { sql, params } = clicksSql();
    expect(params).toEqual([NET, false, 'approved', [ID1], '10.0.0.1', 100, 0]);
    expect(sql).toContain('is_unique = $2');
    expect(sql).toContain('cs.status = $3');
    expect(sql).toContain('click_id = ANY($4::text[])');
    expect(sql).toContain('ip = $5::inet');
  });

  it.each([
    ['a malformed click id', `/clicks?clickIds=${ID1},nope`],
    ['an upper-case click id (not the issued format)', `/clicks?clickIds=${ID1.toUpperCase()}`],
    ['more than 100 click ids', `/clicks?clickIds=${Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(32, '0')).join(',')}`],
    ['an invalid ip', '/clicks?ip=10.0.0'],
    ['an ip with a prefix', `/clicks?ip=${encodeURIComponent('10.0.0.1/32')}`],
    ['grouped: a malformed click id', '/grouped?clickIds=nope'],
    ['grouped: an invalid ip', '/grouped?ip=abc'],
    ['grouped: an invalid isUnique', '/grouped?isUnique=yes'],
  ])('%s → 422 before any query', async (_l, url) => {
    expect((await request(reportsApp()).get(url)).status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('the referrer in the response is redacted like postback URLs (stored row unchanged)', async () => {
    queryMock.mockResolvedValue({ rows: [{ click_id: ID1, referrer: 'https://ref.example/p?token=SECRET&x=1' }], rowCount: 1 });
    const res = await request(reportsApp()).get('/clicks');
    expect(res.body.data[0].referrer).toBe('https://ref.example/p?token=[redacted]&x=1');
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('/grouped: clickIds on both sides (conversions use their own click_id); ip / isUnique join the click', async () => {
    await request(reportsApp()).get(`/grouped?groupBy=offer&clickIds=${ID1}&ip=10.0.0.1&isUnique=true`);
    const { sql, params } = calls()[0]!;
    const cl = sql.slice(sql.indexOf('WITH cl AS'), sql.indexOf('), cv AS'));
    const cv = sql.slice(sql.indexOf('), cv AS'), sql.indexOf('SELECT COALESCE(cl.k'));
    expect(cl).toContain('c.click_id = ANY($2::text[])');
    expect(cl).toContain('c.ip = $3::inet');
    expect(cl).toContain('c.is_unique = $4');
    expect(cv).toContain('LEFT JOIN clicks k ON k.click_id = v.click_id AND k.network_id = v.network_id');
    expect(cv).toContain('v.click_id = ANY($5::text[])');
    expect(cv).toContain('k.ip = $6::inet');
    expect(cv).toContain('k.is_unique = $7');
    expect(params).toEqual([NET, [ID1], '10.0.0.1', true, [ID1], '10.0.0.1', true]);
  });

  it('/grouped: sourceId / fbclid / gclid filter the click on both sides (conversions via the joined click)', async () => {
    await request(reportsApp()).get('/grouped?groupBy=offer&sourceId=s1&fbclid=f1&gclid=g1');
    const { sql, params } = calls()[0]!;
    const cl = sql.slice(sql.indexOf('WITH cl AS'), sql.indexOf('), cv AS'));
    const cv = sql.slice(sql.indexOf('), cv AS'), sql.indexOf('SELECT COALESCE(cl.k'));
    expect(cl).toContain('c.source_id = $2 AND c.fbclid = $3 AND c.gclid = $4');
    expect(cv).toContain('LEFT JOIN clicks k ON k.click_id = v.click_id AND k.network_id = v.network_id');
    expect(cv).toContain('k.source_id = $5 AND k.fbclid = $6 AND k.gclid = $7');
    expect(params).toEqual([NET, 's1', 'f1', 'g1', 's1', 'f1', 'g1']);
  });

  it('/clicks: created_at ties are broken by click_id, so offset pages never repeat or skip a click', async () => {
    await request(reportsApp()).get('/clicks?limit=10&offset=20');
    expect(calls().find((x) => /FROM clicks WHERE/.test(x.sql))!.sql).toMatch(/ORDER BY created_at DESC, click_id DESC LIMIT \$\d+ OFFSET \$\d+/);
  });

  describe('/grouped order and currency', () => {
    const grouped = (rows: Record<string, unknown>[], defaultCurrency: string | null = 'EUR') => queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('WITH cl AS')) return { rows: rows.map((r) => ({ conversions: 0, payout: '0', revenue: '0', profit: '0', currencies: [], money_by_currency: null, ...r })) };
      if (/FROM networks WHERE id = \$1/.test(sql)) return { rows: defaultCurrency == null ? [] : [{ default_currency: defaultCurrency }] };
      return { rows: [] };
    });
    const keys = (res: { body: { data: { rows: { key: string }[] } } }) => res.body.data.rows.map((r) => r.key);

    it('Day groups are chronological (not by clicks)', async () => {
      grouped([{ k: '2026-10-03', clicks: 9 }, { k: '2026-10-01', clicks: 1 }, { k: '2026-10-02', clicks: 5 }]);
      expect(keys(await request(reportsApp()).get('/grouped?groupBy=day'))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    });
    it('other groupings: clicks desc, then label, then key — stable for equal clicks', async () => {
      grouped([{ k: 'US', clicks: 3 }, { k: 'DE', clicks: 3 }, { k: 'IN', clicks: 7 }, { k: 'AT', clicks: 3 }]);
      expect(keys(await request(reportsApp()).get('/grouped?groupBy=country'))).toEqual(['IN', 'AT', 'DE', 'US']);
    });
    it('a group without an offer currency falls back to the network default currency, not USD', async () => {
      grouped([{ k: 'mobile', clicks: 2 }]);
      const res = await request(reportsApp()).get('/grouped?groupBy=device');
      expect(res.body.data.rows[0].currency).toBe('EUR');
      // The lookup is scoped to the caller's network.
      expect(calls().find((x) => /FROM networks WHERE id = \$1/.test(x.sql))!.params).toEqual([NET]);
      grouped([{ k: 'mobile', clicks: 2 }], null);
      expect((await request(reportsApp()).get('/grouped?groupBy=device')).body.data.rows[0].currency).toBe('USD');
    });
  });

  it('/grouped absent → no click join added for these filters', async () => {
    await request(reportsApp()).get('/grouped?groupBy=offer');
    expect(calls()[0]!.sql).not.toMatch(/LEFT JOIN clicks k|::inet|is_unique|source_id|fbclid|gclid/);
  });
});

// ── Event report grouping ──
describe('/goals groups by goal id; goal-less conversions are separate unmatched rows', () => {
  it('returns goal_id / unmatched / currencies per row and orders with a goal_id tie-break', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::int AS total FROM (')) return { rows: [{ total: 2 }] };
      if (sql.includes('FROM clicks')) return { rows: [{ offer_id: A, clicks: 4 }] };
      return { rows: [
        { goal: 'install', offer_id: A, goal_id: NET, unmatched: false, conversions: 2, payout: '1.0000', revenue: '3.0000', margin: '2.0000', currency: 'USD', currencies: ['USD'] },
        { goal: 'install', offer_id: A, goal_id: null, unmatched: true, conversions: 1, payout: '0.0000', revenue: '0.0000', margin: '0.0000', currency: 'USD', currencies: [] },
      ] };
    });
    const res = await request(reportsApp()).get('/goals');
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0]).toMatchObject({ goal: 'install', goal_id: NET, unmatched: false, clicks: 4, cvr: 50, currencies: ['USD'] });
    expect(res.body.data.rows[1]).toMatchObject({ goal: 'install', goal_id: null, unmatched: true, clicks: 4, cvr: 25, currencies: [] });
    const page = calls().find((x) => x.sql.includes('ORDER BY conversions DESC'))!;
    expect(page.sql).toMatch(/CASE WHEN c\.goal_id IS NULL THEN COALESCE\(MIN\(c\.event_name\), '\(no event\)'\)/);
    expect(page.sql).toMatch(/\(c\.goal_id IS NULL\) AS unmatched/);
    expect(page.sql).toMatch(/ORDER BY conversions DESC, goal, c\.offer_id, c\.goal_id LIMIT/);
    expect(page.sql).toContain("c.status = 'approved'");
  });
});

// ── Click→Conversion Time status ──
describe('/click-to-conversion-time status', () => {
  it('absent → approved only (the original behaviour)', async () => {
    await request(reportsApp()).get('/click-to-conversion-time');
    const { sql, params } = calls()[0]!;
    expect(sql).toContain('c.status = $2');
    expect(params.slice(0, 2)).toEqual([NET, 'approved']);
    expect(sql).not.toMatch(/source/);
  });
  it.each(['approved', 'pending', 'rejected'])('status=%s binds that status', async (s) => {
    await request(reportsApp()).get(`/click-to-conversion-time?status=${s}`);
    const { sql, params } = calls()[0]!;
    expect(sql).toContain('c.status = $2');
    expect(params.slice(0, 2)).toEqual([NET, s]);
  });
  it('status=all applies no status filter; an unknown value is a 422', async () => {
    await request(reportsApp()).get('/click-to-conversion-time?status=all');
    const { sql, params } = calls()[0]!;
    expect(sql).not.toMatch(/c\.status/);
    expect(params).toEqual([NET, 500, 0]);
    expect((await request(reportsApp()).get('/click-to-conversion-time?status=any')).status).toBe(422);
  });
});

// ── Mixed currencies ──
describe('`currencies` metric (reporting provider)', () => {
  const parse = (q: Record<string, string>) => buildReportRequest(NET, reportQuerySchema.parse(q), 'admin');

  it('is opt-in: an omitted `metrics` keeps the existing set, and it is never an orderBy', () => {
    expect(parse({}).metrics).not.toContain('currencies');
    expect(parse({ metrics: 'payout,currencies' }).metrics).toEqual(['payout', 'currencies']);
    expect(parse({ metrics: 'currencies', orderBy: 'currencies' }).orderBy).toBeUndefined();
    expect(buildReportRequest(NET, reportQuerySchema.parse({ metrics: 'payout,currencies' }), 'publisher', { publisherId: A }).metrics).toEqual(['payout', 'currencies']);
  });

  it('Postgres: not computed unless requested', async () => {
    await new PostgresReportingProvider().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['payout'], filters: {}, limit: 10, offset: 0 });
    for (const { sql } of calls()) expect(sql).not.toMatch(/currencies|array_agg/);
  });

  it('Postgres: approved, non-null currencies, sorted; single / mixed / none', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows: [
        { d0: 'o1', clicks: 1, conversions: 1, payout: '1.0000', revenue: '2.0000', margin: '1.0000', currencies: ['USD'] },
        { d0: 'o2', clicks: 1, conversions: 2, payout: '3.0000', revenue: '4.0000', margin: '1.0000', currencies: ['EUR', 'USD'] },
        { d0: 'o3', clicks: 1, conversions: 0, payout: '0.0000', revenue: '0.0000', margin: '0.0000', currencies: [] },
      ] });
    const out = await new PostgresReportingProvider().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['payout', 'currencies'], filters: {}, limit: 10, offset: 0 });
    expect(out.rows.map((r) => r.metrics)).toEqual([
      { payout: '1.0000', currencies: ['USD'] },
      { payout: '3.0000', currencies: ['EUR', 'USD'] },
      { payout: '0.0000', currencies: [] },
    ]);
    const { sql } = calls()[1]!;
    expect(sql).toContain("array_agg(DISTINCT c.currency ORDER BY c.currency) FILTER (WHERE c.status = 'approved' AND c.currency IS NOT NULL) AS currencies");
    expect(sql).toContain("COALESCE(cv.currencies, '{}'::text[]) AS currencies");
  });

  it('Postgres groupBy=none returns one row with `currencies`', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [{ clicks: 0, conversions: 0, payout: '0', revenue: '0', margin: '0', currencies: null }] });
    const out = await new PostgresReportingProvider().runReport({ networkId: NET, groupBy: [], metrics: ['currencies'], filters: {}, limit: 1, offset: 0 });
    expect(out.rows[0]!.metrics).toEqual({ currencies: [] });
    expect(calls()[1]!.sql).toContain('CROSS JOIN');
  });

  it('ClickHouse: groupUniqArrayIf over approved non-null currencies, only when requested', async () => {
    const querySpy = vi.fn().mockImplementation(async ({ query: q }: { query: string }) => ({
      json: async () => ({ data: q.includes('AS total FROM') ? [{ total: 1 }] : [{ d0: 'o1', payout: '5', currencies: ['EUR', 'USD'] }] }),
    }));
    const client = { query: querySpy } as unknown as ConstructorParameters<typeof ClickHouseReportingProvider>[0];
    const out = await new ClickHouseReportingProvider(client, async () => []).runReport({ networkId: NET, groupBy: ['offer'], metrics: ['payout', 'currencies'], filters: {}, limit: 10, offset: 0 });
    expect(out.rows[0]!.metrics).toEqual({ payout: '5', currencies: ['EUR', 'USD'] });
    const sql = (querySpy.mock.calls[1]![0] as { query: string }).query;
    expect(sql).toContain("arraySort(groupUniqArrayIf(toString(assumeNotNull(k.currency)), k.status = 'approved' AND isNotNull(k.currency))) AS currencies");
    expect(sql).toContain('cv.currencies AS currencies');

    querySpy.mockClear();
    await new ClickHouseReportingProvider(client, async () => []).runReport({ networkId: NET, groupBy: ['offer'], metrics: ['payout'], filters: {}, limit: 10, offset: 0 });
    expect((querySpy.mock.calls[1]![0] as { query: string }).query).not.toMatch(/currencies/);
  });
});

describe('`currencies` on /grouped, /goals and Pacing', () => {
  it('/grouped rows + totals carry the conversions\' currencies', async () => {
    queryMock.mockImplementation(async (sql: string) => (sql.includes('WITH cl AS')
      ? { rows: [
        { k: 'a', clicks: 2, conversions: 1, payout: '1', revenue: '2', profit: '1', currencies: ['USD'] },
        { k: 'b', clicks: 1, conversions: 1, payout: '1', revenue: '2', profit: '1', currencies: ['EUR'] },
        { k: 'c', clicks: 1, conversions: 0, payout: '0', revenue: '0', profit: '0', currencies: [] },
      ] }
      : { rows: [] }));
    const res = await request(reportsApp()).get('/grouped?groupBy=day');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r: { currencies: string[] }) => r.currencies)).toEqual([['USD'], ['EUR'], []]);
    expect(res.body.data.totals.currencies).toEqual(['EUR', 'USD']);
    expect(calls()[0]!.sql).toContain('array_agg(DISTINCT v.currency ORDER BY v.currency) FILTER (WHERE v.currency IS NOT NULL) AS currencies');
  });

  const groupRow = (o: Partial<Record<string, unknown>>) => ({ id: 'g', name: 'G', daily_payout_cap: '100.0000', daily_revenue_cap: '50.0000', payout_today: '10.0000', revenue_today: '5.0000', cap_currency: 'USD', currencies_today: ['USD'], ...o });
  const pacingWith = (rows: Record<string, unknown>[]) => queryMock.mockImplementation(async (sql: string) => (/FROM offer_groups og/.test(sql) && /cap_currency/.test(sql) ? { rows } : { rows: [] }));
  const summaryOf = async () => Object.fromEntries((await request(reportsApp()).get('/pacing?category=payout')).body.data.summary.map((s: { category: string }) => [s.category, s]));

  it('Pacing summary: single currency → unchanged (no flag)', async () => {
    pacingWith([groupRow({}), groupRow({ id: 'g2', currencies_today: null })]);
    const by = await summaryOf();
    expect(by.payout).toEqual({ category: 'payout', dailyUsedPct: 10, globalUsedPct: null });
    expect(by.revenue).toEqual({ category: 'revenue', dailyUsedPct: 10, globalUsedPct: null });
  });

  it('Pacing summary: conversions in another currency than the cap → null + mixedCurrency', async () => {
    pacingWith([groupRow({ currencies_today: ['EUR', 'USD'] })]);
    const by = await summaryOf();
    expect(by.payout).toEqual({ category: 'payout', dailyUsedPct: null, globalUsedPct: null, mixedCurrency: true });
    expect(by.revenue).toEqual({ category: 'revenue', dailyUsedPct: null, globalUsedPct: null, mixedCurrency: true });
  });

  it('Pacing summary: pooled groups capped in different currencies → mixed (only for the pool that has both)', async () => {
    pacingWith([groupRow({ currencies_today: [] }), groupRow({ id: 'g2', cap_currency: 'EUR', currencies_today: [], daily_revenue_cap: null })]);
    const by = await summaryOf();
    expect(by.payout).toMatchObject({ dailyUsedPct: null, mixedCurrency: true });
    expect(by.revenue).toEqual({ category: 'revenue', dailyUsedPct: 10, globalUsedPct: null });
  });

  it('Pacing payout detail rows carry the summed conversions\' currencies', async () => {
    queryMock.mockImplementation(async (sql: string) => (/GROUP BY 1, 2, 3, 4, 6/.test(sql)
      ? { rows: [{ day: 'd', group_id: 'g1', group_name: 'G', cap: '10.0000', actual: '5.0000', currency: 'USD', currencies: ['EUR', 'USD'] }] }
      : { rows: [] }));
    const res = await request(reportsApp()).get('/pacing?category=payout');
    expect(res.body.data.rows[0]).toMatchObject({ currency: 'USD', currencies: ['EUR', 'USD'] });
    expect(calls().find((x) => /GROUP BY 1, 2, 3, 4, 6/.test(x.sql))!.sql)
      .toContain("COALESCE(array_agg(DISTINCT c.currency ORDER BY c.currency) FILTER (WHERE c.currency IS NOT NULL), '{}'::text[]) AS currencies");
  });
});

// ── Money by currency (no FX: never summed / compared across currencies) ──
describe('`money_by_currency` metric (reporting provider)', () => {
  const build = (q: Record<string, string>, aud: 'admin' | 'publisher' | 'advertiser' = 'admin') =>
    buildReportRequest(NET, reportQuerySchema.parse(q), aud, aud === 'admin' ? {} : aud === 'publisher' ? { publisherId: A } : { advertiserId: A });
  const pg = () => new PostgresReportingProvider();
  const pageSql = () => calls()[1]!.sql;

  it('is opt-in, never an orderBy, and carries only the audience\'s money fields', () => {
    expect(build({}).metrics).not.toContain('money_by_currency');
    expect(build({ metrics: 'money_by_currency' }).metrics).toEqual(['money_by_currency']);
    expect(build({ metrics: 'money_by_currency', orderBy: 'money_by_currency' }).orderBy).toBeUndefined();
    expect(build({}).moneyFields).toEqual(['payout', 'revenue', 'margin']);
    // Publishers never see revenue/margin, advertisers never payout/margin — whatever they ask for.
    expect(build({ metrics: 'money_by_currency,revenue,margin' }, 'publisher')).toMatchObject({ metrics: ['money_by_currency'], moneyFields: ['payout'] });
    expect(build({ metrics: 'money_by_currency,payout' }, 'advertiser')).toMatchObject({ metrics: ['money_by_currency'], moneyFields: ['revenue'] });
  });

  it('Postgres: not computed unless requested', async () => {
    await pg().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['payout', 'currencies'], filters: {}, limit: 10, offset: 0 });
    for (const { sql } of calls()) expect(sql).not.toMatch(/jsonb_object_agg|cmj|money_by_currency/);
  });

  it('Postgres: per (group, currency) sums of approved non-NULL-currency conversions, folded into one object per row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 3 }] }).mockResolvedValueOnce({ rows: [
      { d0: 'o1', money_by_currency: { USD: { payout: '1.0000', revenue: '3.0000', margin: '2.0000' } } },
      { d0: 'o2', money_by_currency: { EUR: { payout: '2.0000', revenue: '2.0000', margin: '0.0000' }, USD: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' } } },
      { d0: 'o3', money_by_currency: {} },
    ] });
    const out = await pg().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['money_by_currency'], filters: {}, limit: 10, offset: 0, moneyFields: ['payout', 'revenue', 'margin'] });
    expect(out.rows.map((r) => r.metrics['money_by_currency'])).toEqual([
      { USD: { payout: '1.0000', revenue: '3.0000', margin: '2.0000' } },
      { EUR: { payout: '2.0000', revenue: '2.0000', margin: '0.0000' }, USD: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' } },
      {},
    ]);
    const sql = pageSql();
    expect(sql).toMatch(/cm AS \(\s+SELECT c\.offer_id AS d0, c\.currency AS cur,/);
    expect(sql).toContain("AND c.status = 'approved' AND c.currency IS NOT NULL");
    expect(sql).toMatch(/GROUP BY d0, cur/);
    expect(sql).toContain("jsonb_object_agg(cm.cur, jsonb_build_object('payout', round(cm.p, 4)::text, 'revenue', round(cm.r, 4)::text, 'margin', round(cm.r - cm.p, 4)::text)) AS mbc");
    expect(sql).toContain("LEFT JOIN cmj ON COALESCE(COALESCE(cl.d0, cv.d0)::text, '~NULL~') = COALESCE(cmj.d0::text, '~NULL~')");
    expect(sql).toContain("COALESCE(cmj.mbc, '{}'::jsonb) AS money_by_currency");
    expect(calls()[0]!.params).toEqual([NET]);
  });

  it('Postgres: a publisher request builds payout only (no revenue/margin in the SQL or output)', async () => {
    const req = build({ metrics: 'money_by_currency' }, 'publisher');
    await pg().runReport(req);
    const sql = pageSql();
    expect(sql).toContain("jsonb_build_object('payout', round(cm.p, 4)::text)");
    expect(sql).not.toMatch(/'revenue'|'margin'/);
    // Without an explicit moneyFields only the money metrics the request itself lists are carried.
    queryMock.mockClear();
    await pg().runReport({ networkId: NET, groupBy: ['offer'], metrics: ['revenue', 'money_by_currency'], filters: {}, limit: 1, offset: 0 });
    expect(pageSql()).toContain("jsonb_build_object('revenue', round(cm.r, 4)::text)");
  });

  it('Postgres groupBy=none: one row, CROSS JOIN, {} when there is no money', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [{ money_by_currency: null }] });
    const out = await pg().runReport({ networkId: NET, groupBy: [], metrics: ['money_by_currency'], filters: {}, limit: 1, offset: 0 });
    expect(out.rows[0]!.metrics).toEqual({ money_by_currency: {} });
    const sql = pageSql();
    expect(sql).toMatch(/cmj AS \(\s+SELECT jsonb_object_agg/);
    expect(sql).toContain('CROSS JOIN cmj');
    expect(sql).not.toMatch(/GROUP BY cm\./);
  });

  it('ClickHouse: sumMapIf over approved non-NULL currencies (+ a row count so zero sums keep their key); audience fields only', async () => {
    const querySpy = vi.fn().mockImplementation(async ({ query: q }: { query: string }) => ({
      json: async () => ({ data: q.includes('AS total FROM') ? [{ total: 1 }] : [{ d0: 'o1', money_by_currency: [['EUR', '1.5', '4', '2.5'], ['USD', '0', '0', '0']] }] }),
    }));
    const client = { query: querySpy } as unknown as ConstructorParameters<typeof ClickHouseReportingProvider>[0];
    const ch = new ClickHouseReportingProvider(client, async () => []);
    const out = await ch.runReport({ networkId: NET, groupBy: ['offer'], metrics: ['money_by_currency'], filters: {}, limit: 10, offset: 0, moneyFields: ['payout'] });
    expect(out.rows[0]!.metrics).toEqual({ money_by_currency: { EUR: { payout: '1.5000' }, USD: { payout: '0.0000' } } });
    const sql = (querySpy.mock.calls[1]![0] as { query: string }).query;
    expect(sql).toContain("sumMapIf([CAST(assumeNotNull(k.currency) AS String)], [coalesce(k.payout, toDecimal32(0, 4))], [coalesce(k.revenue, toDecimal32(0, 4))], [toUInt64(1)], k.status = 'approved' AND isNotNull(k.currency)) AS mbc");
    expect(sql).toContain('arrayMap((cur, p, r) -> tuple(cur, toString(p), toString(r), toString(r - p)), tupleElement(cv.mbc, 1), tupleElement(cv.mbc, 2), tupleElement(cv.mbc, 3)) AS money_by_currency');
    // FULL JOIN with real NULLs for the unmatched side (a conversion-only group keeps its dimension).
    for (const [arg] of querySpy.mock.calls) expect(arg).toMatchObject({ clickhouse_settings: { join_use_nulls: 1 } });

    querySpy.mockClear();
    const all = await ch.runReport({ networkId: NET, groupBy: [], metrics: ['money_by_currency'], filters: {}, limit: 1, offset: 0, moneyFields: ['payout', 'revenue', 'margin'] });
    expect(all.rows[0]!.metrics).toEqual({ money_by_currency: { EUR: { payout: '1.5000', revenue: '4.0000', margin: '2.5000' }, USD: { payout: '0.0000', revenue: '0.0000', margin: '0.0000' } } });
    expect((querySpy.mock.calls[1]![0] as { query: string }).query).toContain('CROSS JOIN');

    querySpy.mockClear();
    await ch.runReport({ networkId: NET, groupBy: ['offer'], metrics: ['payout'], filters: {}, limit: 10, offset: 0 });
    expect((querySpy.mock.calls[1]![0] as { query: string }).query).not.toMatch(/sumMap|money_by_currency/);
  });
});

describe('money sort never compares currencies', () => {
  const run = (orderBy: string, orderDir?: 'asc' | 'desc', groupBy: string[] = ['offer']) =>
    new PostgresReportingProvider().runReport({ networkId: NET, groupBy: groupBy as never, metrics: ['payout', 'clicks'], filters: {}, limit: 10, offset: 20, orderBy: orderBy as never, ...(orderDir ? { orderDir } : {}) });

  it.each([
    ['payout', 's.payout'], ['revenue', 's.revenue'], ['margin', 's.margin'], ['epc', 's.payout / NULLIF(s.clicks, 0)'],
  ])('Postgres orderBy=%s: single-currency (by code, then value) → no money → mixed; flag set; paging after the sort', async (m, col) => {
    const out = await run(m);
    expect(out.sortedWithinCurrency).toBe(true);
    const { sql, params } = calls()[1]!;
    expect(sql).toContain(`ORDER BY s.money_bucket ASC, s.money_currency ASC NULLS LAST, CASE WHEN s.money_bucket = 0 THEN ${col} END DESC NULLS LAST, s.d0::text LIMIT $2 OFFSET $3`);
    expect(sql).toContain("COUNT(DISTINCT c.currency) FILTER (WHERE c.status = 'approved') AS cur_n");
    expect(sql).toContain("COUNT(*) FILTER (WHERE c.status = 'approved' AND c.currency IS NULL) AS cur_null");
    expect(sql).toMatch(/CASE WHEN COALESCE\(cv\.conversions, 0\) = 0 THEN 1\s+WHEN cv\.cur_n = 1 AND cv\.cur_null = 0 THEN 0 ELSE 2 END AS money_bucket/);
    expect(params).toEqual([NET, 10, 20]);
    // The count query sees the same groups (classification columns don't change the row set).
    expect(calls()[0]!.sql).toMatch(/^SELECT COUNT\(\*\)::int AS total FROM \(WITH cl AS/);
  });

  it('Postgres asc keeps the currency partition ascending and sorts the value ascending within it', async () => {
    await run('payout', 'asc');
    expect(calls()[1]!.sql).toContain('ORDER BY s.money_bucket ASC, s.money_currency ASC NULLS LAST, CASE WHEN s.money_bucket = 0 THEN s.payout END ASC NULLS LAST, s.d0::text');
  });

  it.each(['clicks', 'conversions', 'cr', 'unique_clicks', 'invalid_clicks', 'total_conversions', 'avg_fraud_score'])('non-money orderBy=%s is unchanged and unflagged', async (m) => {
    const out = await run(m, 'asc');
    expect(out.sortedWithinCurrency).toBeUndefined();
    expect(calls()[1]!.sql).not.toMatch(/money_bucket|cur_n/);
    expect(calls()[1]!.sql).toMatch(/ORDER BY .+ ASC NULLS LAST, s\.d0::text LIMIT/);
  });

  it('default order (no orderBy) is unchanged and unflagged', async () => {
    const out = await new PostgresReportingProvider().runReport({ networkId: NET, groupBy: ['day'], metrics: ['payout'], filters: {}, limit: 10, offset: 0 });
    expect(out.sortedWithinCurrency).toBeUndefined();
    expect(calls()[1]!.sql).toContain('ORDER BY s.d0 ASC NULLS LAST, s.d0::text LIMIT');
  });

  it('ClickHouse orderBy=margin partitions the same way and flags the result', async () => {
    const querySpy = vi.fn().mockImplementation(async ({ query: q }: { query: string }) => ({ json: async () => ({ data: q.includes('AS total FROM') ? [{ total: 0 }] : [] }) }));
    const client = { query: querySpy } as unknown as ConstructorParameters<typeof ClickHouseReportingProvider>[0];
    const out = await new ClickHouseReportingProvider(client, async () => []).runReport({ networkId: NET, groupBy: ['offer'], metrics: ['margin'], filters: {}, limit: 10, offset: 0, orderBy: 'margin', orderDir: 'desc' });
    expect(out.sortedWithinCurrency).toBe(true);
    const sql = (querySpy.mock.calls[1]![0] as { query: string }).query;
    expect(sql).toContain("uniqExactIf(k.currency, k.status = 'approved' AND isNotNull(k.currency)) AS cur_n");
    expect(sql).toContain('multiIf(COALESCE(cv.conversions, 0) = 0, 1, COALESCE(cv.cur_n, 0) = 1 AND COALESCE(cv.cur_null, 0) = 0, 0, 2) AS money_bucket');
    expect(sql).toMatch(/ORDER BY money_bucket ASC, money_currency ASC, if\(money_bucket = 0, margin, NULL\) DESC NULLS LAST, d0 LIMIT/);
  });
});

describe('`moneyByCurrency` on /summary, /dashboard, /grouped, /goals, Pacing, /cohort', () => {
  it('/summary carries the provider\'s per-currency money (admin: all fields)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [{ clicks: 2, conversions: 1, payout: '1.0000', revenue: '3.0000', margin: '2.0000', currencies: ['USD'], money_by_currency: { USD: { payout: '1.0000', revenue: '3.0000', margin: '2.0000' } } }] });
    const res = await request(reportsApp()).get('/summary');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ payout: '1.0000', currencies: ['USD'], moneyByCurrency: { USD: { payout: '1.0000', revenue: '3.0000', margin: '2.0000' } } });
    expect(calls()[1]!.sql).toContain("jsonb_build_object('payout', round(cm.p, 4)::text, 'revenue', round(cm.r, 4)::text, 'margin', round(cm.r - cm.p, 4)::text)");
  });

  it('/dashboard: per period, only currencies with conversions in that period', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY currency')) return { rows: [
        { currency: 'EUR', n_today: 0, p_today: '0.0000', r_today: '0.0000', m_today: '0.0000', n_yesterday: 1, p_yesterday: '2.0000', r_yesterday: '5.0000', m_yesterday: '3.0000', n_month: 1, p_month: '2.0000', r_month: '5.0000', m_month: '3.0000', n_last_month: 0, p_last_month: '0.0000', r_last_month: '0.0000', m_last_month: '0.0000' },
        { currency: 'USD', n_today: 2, p_today: '1.5000', r_today: '4.0000', m_today: '2.5000', n_yesterday: 0, p_yesterday: '0.0000', r_yesterday: '0.0000', m_yesterday: '0.0000', n_month: 2, p_month: '1.5000', r_month: '4.0000', m_month: '2.5000', n_last_month: 0, p_last_month: '0.0000', r_last_month: '0.0000', m_last_month: '0.0000' },
      ] };
      return { rows: [{}] };
    });
    const res = await request(reportsApp()).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.moneyByCurrency).toEqual({
      today: { USD: { payout: '1.5000', revenue: '4.0000', margin: '2.5000' } },
      yesterday: { EUR: { payout: '2.0000', revenue: '5.0000', margin: '3.0000' } },
      month: { EUR: { payout: '2.0000', revenue: '5.0000', margin: '3.0000' }, USD: { payout: '1.5000', revenue: '4.0000', margin: '2.5000' } },
      lastMonth: {},
    });
    const q = calls().find((x) => x.sql.includes('GROUP BY currency'))!;
    expect(q.sql).toContain("network_id = $1 AND status = 'approved' AND currency IS NOT NULL");
    expect(q.params).toEqual([NET]);
  });

  it('/grouped rows carry moneyByCurrency and totals merge it per currency (exact decimals)', async () => {
    queryMock.mockImplementation(async (sql: string) => (sql.includes('WITH cl AS')
      ? { rows: [
        { k: 'a', clicks: 2, conversions: 1, payout: '1.1000', revenue: '2.0000', profit: '0.9000', currencies: ['USD'], money_by_currency: { USD: { payout: '1.1000', revenue: '2.0000', margin: '0.9000' } } },
        { k: 'b', clicks: 1, conversions: 2, payout: '3.0000', revenue: '4.0000', profit: '1.0000', currencies: ['EUR', 'USD'], money_by_currency: { EUR: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' }, USD: { payout: '2.2000', revenue: '3.0000', margin: '0.8000' } } },
        { k: 'c', clicks: 1, conversions: 0, payout: '0', revenue: '0', profit: '0', currencies: [], money_by_currency: null },
      ] }
      : { rows: [] }));
    const res = await request(reportsApp()).get('/grouped?groupBy=day');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r: { moneyByCurrency: unknown }) => r.moneyByCurrency)).toEqual([
      { USD: { payout: '1.1000', revenue: '2.0000', margin: '0.9000' } },
      { EUR: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' }, USD: { payout: '2.2000', revenue: '3.0000', margin: '0.8000' } },
      {},
    ]);
    expect(res.body.data.totals.moneyByCurrency).toEqual({
      EUR: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' },
      USD: { payout: '3.3000', revenue: '5.0000', margin: '1.7000' },
    });
    const sql = calls()[0]!.sql;
    expect(sql).toMatch(/cm AS \([\s\S]+WHERE v\.network_id = \$1 AND v\.status = 'approved' AND v\.currency IS NOT NULL GROUP BY 1, 2/);
    expect(sql).toContain('LEFT JOIN cmj ON cmj.k = COALESCE(cl.k, cv.k)');
  });

  it('/goals rows carry moneyByCurrency from a per-row LATERAL over the same conversions (event_key not exposed)', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::int AS total FROM (')) return { rows: [{ total: 1 }] };
      if (sql.includes('FROM clicks')) return { rows: [] };
      return { rows: [{ goal: 'install', offer_id: A, goal_id: null, unmatched: true, event_key: 'install', conversions: 2, payout: '3.0000', revenue: '3.0000', margin: '0.0000', currency: 'USD', currencies: ['EUR', 'USD'],
        money_by_currency: { EUR: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' }, USD: { payout: '2.0000', revenue: '2.0000', margin: '0.0000' } } }] };
    });
    const res = await request(reportsApp()).get('/goals');
    expect(res.status).toBe(200);
    const row = res.body.data.rows[0];
    expect(row.moneyByCurrency).toEqual({ EUR: { payout: '1.0000', revenue: '1.0000', margin: '0.0000' }, USD: { payout: '2.0000', revenue: '2.0000', margin: '0.0000' } });
    expect(row).not.toHaveProperty('event_key');
    expect(row).not.toHaveProperty('money_by_currency');
    const page = calls().find((x) => x.sql.includes('LEFT JOIN LATERAL'))!;
    expect(page.sql).toContain('c.offer_id = g.offer_id AND c.goal_id IS NOT DISTINCT FROM g.goal_id');
    expect(page.sql).toContain('(g.goal_id IS NOT NULL OR c.event_name IS NOT DISTINCT FROM g.event_key)');
    expect(page.sql).toMatch(/WHERE c\.network_id = \$1 AND c\.status = 'approved' AND c\.currency IS NOT NULL/);
    expect(page.sql).toContain('ORDER BY g.conversions DESC, g.goal, g.offer_id, g.goal_id');
  });

  it('Pacing payout detail rows carry moneyByCurrency (payout only) from the same rows', async () => {
    const day = new Date('2026-10-08T00:00:00.000Z');
    queryMock.mockImplementation(async (sql: string) => {
      if (/GROUP BY 1, 2, 3, 4, 6/.test(sql)) return { rows: [{ day, group_id: 'g1', group_name: 'G', cap: '10.0000', actual: '5.0000', currency: 'USD', currencies: ['EUR', 'USD'] }] };
      if (/GROUP BY 1, 2, 3 ORDER BY 3/.test(sql)) return { rows: [{ day: new Date(day), group_id: 'g1', cur: 'EUR', amount: '2.0000' }, { day: new Date(day), group_id: 'g1', cur: 'USD', amount: '3.0000' }] };
      return { rows: [] };
    });
    const res = await request(reportsApp()).get('/pacing?category=payout');
    expect(res.body.data.rows[0].moneyByCurrency).toEqual({ EUR: { payout: '2.0000' }, USD: { payout: '3.0000' } });
    const q = calls().find((x) => /GROUP BY 1, 2, 3 ORDER BY 3/.test(x.sql))!;
    expect(q.sql).toContain("c.status = 'approved' AND c.currency IS NOT NULL");
    expect(q.sql).toContain('SUM(c.payout)');
  });

  it('/cohort metric=revenue: rows + top level carry the shown cells\' revenue per currency; metric=conversions → {}', async () => {
    const old = new Date(Date.now() - 3 * 86400000); old.setUTCHours(0, 0, 0, 0);
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM clicks cl')) return { rows: [{ cohort_day: old, clicks: 5, unique_clicks: 5 }] };
      if (sql.includes('GROUP BY 1, 2, 3')) return { rows: [
        { cohort_day: old, day_offset: 1, cur: 'EUR', amount: '1.2500' },
        { cohort_day: old, day_offset: 2, cur: 'EUR', amount: '0.7500' },
        { cohort_day: old, day_offset: 1, cur: 'USD', amount: '4.0000' },
      ] };
      return { rows: [] };
    });
    const from = old.toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const res = await request(reportsApp()).get(`/cohort?from=${from}&to=${to}&metric=revenue`);
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].moneyByCurrency).toEqual({ EUR: { revenue: '2.0000' }, USD: { revenue: '4.0000' } });
    expect(res.body.data.moneyByCurrency).toEqual({ EUR: { revenue: '2.0000' }, USD: { revenue: '4.0000' } });
    expect(calls().find((x) => x.sql.includes('GROUP BY 1, 2, 3'))!.sql).toContain('SUM(c.revenue)');

    queryMock.mockClear();
    const n = await request(reportsApp()).get(`/cohort?from=${from}&to=${to}`);
    expect(n.body.data.moneyByCurrency).toEqual({});
    expect(calls().some((x) => x.sql.includes('GROUP BY 1, 2, 3'))).toBe(false);
  });
});

describe('offer-group stats split money by currency', () => {
  const group = { id: A, ref: '1', name: 'G', advertiser_id: null, offer_ids: [A], currency: 'USD', labels: null, notes: null, status: 'active', caps_enabled: false, caps: {}, created_at: 't', updated_at: 't' };
  const stats = { clicks: '4', cv: '2', payout: '3.0000', revenue: '9.0000', margin: '6.0000', money_by_currency: { EUR: { payout: '1.0000', revenue: '4.0000', margin: '3.0000' }, USD: { payout: '2.0000', revenue: '5.0000', margin: '3.0000' } } };
  const mock = () => queryMock.mockImplementation(async (sql: string) => (sql.includes('WITH j AS') ? { rows: [stats] } : { rows: [group] }));

  it('/:id/stats keeps its fields and adds currencies + moneyByCurrency', async () => {
    mock();
    const res = await request(groupsApp()).get(`/${A}/stats`);
    expect(res.status).toBe(200);
    // Money is 4dp text from SQL (F-22) — formatted at the UI edge, not rounded to 2dp here.
    expect(res.body.data).toEqual({ revenue: '9.0000', payout: '3.0000', margin: '6.0000', clicks: 4, cv: 2, cvr: 0.5, currencies: ['EUR', 'USD'], moneyByCurrency: stats.money_by_currency });
    const q = calls().find((x) => x.sql.includes('WITH j AS'))!;
    expect(q.sql).toContain('cl.network_id = $1 AND cl.offer_id = ANY($2::uuid[])');
    expect(q.sql).toContain("jsonb_object_agg(cm.cur, jsonb_build_object('payout'");
    expect(q.params).toEqual([NET, [A]]);
  });

  it('list rows: today keeps clicks/payout/revenue and adds currencies + moneyByCurrency', async () => {
    mock();
    const res = await request(groupsApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data[0].today).toEqual({ clicks: 4, payout: '3.0000', revenue: '9.0000', currencies: ['EUR', 'USD'], moneyByCurrency: stats.money_by_currency });
  });

  it('a group with no offers → empty currencies / {}', async () => {
    queryMock.mockResolvedValue({ rows: [{ ...group, offer_ids: [] }] });
    const res = await request(groupsApp()).get(`/${A}/stats`);
    expect(res.body.data).toMatchObject({ payout: '0.0000', margin: '0.0000', currencies: [], moneyByCurrency: {} });
  });
});

// ── Partner Postback URL redaction ──
describe('redactUrl', () => {
  it.each([
    ['userinfo', 'https://user:pa55@partner.example/cb?x=1', 'https://[redacted]@partner.example/cb?x=1'],
    ['token', 'https://p.example/cb?click_id=abc&token=T0K&payout=1.5', 'https://p.example/cb?click_id=abc&token=[redacted]&payout=1.5'],
    ['api_key + case/separator variants', 'https://p.example/cb?API_KEY=k1&Api-Key=k2&apikey=k3&sub=x', 'https://p.example/cb?API_KEY=[redacted]&Api-Key=[redacted]&apikey=[redacted]&sub=x'],
    ['percent-encoded key', 'https://p.example/cb?api%5Fkey=k&a=b', 'https://p.example/cb?api%5Fkey=[redacted]&a=b'],
    ['secure_code / password / signature', 'http://p.example/?secure_code=s&password=p&signature=g', 'http://p.example/?secure_code=[redacted]&password=[redacted]&signature=[redacted]'],
    ['fragment params', 'https://p.example/cb?a=1#access_token=xyz&b=2', 'https://p.example/cb?a=1#access_token=[redacted]&b=2'],
    ['semicolon separators', 'https://p.example/cb?a=1;token=x', 'https://p.example/cb?a=1;token=[redacted]'],
    ['empty value / bare key', 'https://p.example/cb?token=&token&x=%20', 'https://p.example/cb?token=[redacted]&token&x=%20'],
  ])('%s', (_n, input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  it('leaves look-alike keys, other params, order and encoding byte-for-byte', () => {
    const url = 'https://p.example/a/b?token_count=3&promo_token=X&secure_code_hint=h&q=a%2Bb+c&z=1&a=2';
    expect(redactUrl(url)).toBe(url);
  });

  it('a URL with no query (or no credentials) is unchanged', () => {
    expect(redactUrl('https://p.example/postback/123')).toBe('https://p.example/postback/123');
    expect(redactUrl('https://p.example')).toBe('https://p.example');
    expect(redactUrl('')).toBe('');
  });

  it('a malformed URL never throws and falls back to key=value masking', () => {
    expect(() => redactUrl('http://[bad')).not.toThrow();
    expect(redactUrl('not a url ?token=abc&x=1')).toBe('not a url ?token=[redacted]&x=1');
    expect(redactUrl('{postback_base}?api_key=K&click_id={click_id}')).toBe('{postback_base}?api_key=[redacted]&click_id={click_id}');
    expect(redactUrl('http://u:p@bad host/?password=p')).toBe('http://[redacted]@bad host/?password=[redacted]');
    expect(redactUrl('timeout')).toBe('timeout');
  });
});

describe('/postback-logs masks partner credentials in url / error', () => {
  it('returns the redacted url and leaves every other field as stored', async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: 'p1', url: 'https://bob:hunter2@partner.example/pb?click_id=c1&token=SECRET1&payout=2', error: 'http_500', success: false },
      { id: 'p2', url: 'https://partner.example/pb?ApiKey=SECRET2', error: 'failed GET https://partner.example/pb?api_key=SECRET3', success: false },
      { id: 'p3', url: 'https://partner.example/pb?click_id=c3', error: null, success: true },
    ] });
    const res = await request(reportsApp()).get('/postback-logs');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { url: string }) => r.url)).toEqual([
      'https://[redacted]@partner.example/pb?click_id=c1&token=[redacted]&payout=2',
      'https://partner.example/pb?ApiKey=[redacted]',
      'https://partner.example/pb?click_id=c3',
    ]);
    expect(res.body.data.map((r: { error: string | null }) => r.error)).toEqual(['http_500', 'failed GET https://partner.example/pb?api_key=[redacted]', null]);
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|hunter2/);
  });
});
