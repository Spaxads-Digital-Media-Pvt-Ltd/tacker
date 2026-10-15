/**
 * Specialized admin reports (spec §9 feature-depth) that don't fit the generic click/conversion
 * aggregation: row-level Clicks & Conversions logs, Postback delivery logs, per-goal aggregation,
 * and Cap usage. All network-scoped (req.scope.networkId), all filters parameterized, aggregation
 * done in SQL. The Offer/Affiliate/Advertiser/Daily/Custom reports remain the generic /api/reports
 * endpoint with a groupBy preset — only these need bespoke SQL.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateQuery } from '../../../lib/http/validate.js';
import { query } from '../../../lib/db/pool.js';
import { summary24h } from '../../../lib/reporting/summary.js';
import { badRequest } from '../../../lib/http/errors.js';
import { csvList, queryDate } from '../../../lib/http/query-params.js';
import { addMoney } from '../../../lib/money.js';
import { inclusiveTo, utcDayStart, tzParam, withZonedRange } from '../../../lib/reporting/request.js';
import { redactRawParams, redactUrl } from '../../../lib/reporting/redact.js';
import { mbcJsonSql, mergeMoneyByCurrency } from '../../../lib/reporting/money-by-currency.js';
import { money4, MONEY_FIELDS, type MoneyByCurrency } from '../../../lib/reporting/types.js';
import { getReportingProvider } from '../../../lib/reporting/index.js';
import { networkTimeZone } from '../../../lib/reporting/network-zone.js';
import { isUtcZone, localDate, zonedDayStart, addDays, inclusiveBefore, formatInZone } from '../../../lib/reporting/time-zone.js';

/** Admin endpoints: every money field per currency (CTE alias `cm` with columns cur / p / r). */
const MBC_JSON = mbcJsonSql('cm');

// Date bounds (D7): `from` / `to` are plain dates or datetimes, and `?tz=` makes a plain date that
// zone's local day (else UTC); each schema's `.transform(withZonedRange)` turns them into the instants
// the queries compare with — a date-only `to` is the END of its day, inclusive (as a bare date it
// meant midnight and silently dropped the last day).
const rangeKeys = { from: queryDate.optional(), to: queryDate.optional(), tz: tzParam.optional() };
// Pacing stays on UTC days: that's when caps reset (tracking/caps.ts).
const utcFromDate = queryDate.transform((s) => utcDayStart(s)!);
const utcToDate = queryDate.transform((s) => inclusiveTo(s));
const uuid = z.string().uuid().optional();
const DETAIL_PAGE_MAX = 500;
const pageKeys = {
  limit: z.coerce.number().int().min(1).max(DETAIL_PAGE_MAX).default(100),
  offset: z.coerce.number().int().min(0).default(0),
};
/** Click IDs exactly as `/click` issues them (32 lower-case hex) — comma list, trimmed, de-duplicated, ≤ 100. */
const MAX_CLICK_IDS = 100;
const clickIdsParam = csvList(z.string().regex(/^[0-9a-f]{32}$/, 'click IDs are 32 lower-case hex characters'))
  .refine((v) => v == null || v.length <= MAX_CLICK_IDS, `at most ${MAX_CLICK_IDS} click IDs`);
/** One IP (v4 or v6), matched exactly against the stored `inet`. */
const ipParam = z.string().trim().ip({ message: 'ip must be an IPv4 or IPv6 address' }).optional();
/** Click-URL values captured at click time (`/click?source_id=…&fbclid=…&gclid=…`) — exact match. */
const clickCaptureKeys = {
  sourceId: z.string().trim().min(1).max(500).optional(),
  fbclid: z.string().trim().min(1).max(500).optional(),
  gclid: z.string().trim().min(1).max(500).optional(),
};
/** Attributes of the originating click (stored on `clicks`, not on conversions). */
const clickAttrKeys = {
  smartLinkId: uuid,
  // Stored upper-case (ISO alpha-2) — accept any case from the URL.
  country: z.string().max(3).transform((s) => s.toUpperCase()).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  device: z.string().max(40).optional(),
  os: z.string().max(40).optional(),
  browser: z.string().max(40).optional(),
  sub1: z.string().max(200).optional(),
  sub2: z.string().max(200).optional(),
  sub3: z.string().max(200).optional(),
  sub4: z.string().max(200).optional(),
  sub5: z.string().max(200).optional(),
};
const CONV_SOURCE = z.enum(['postback', 'pixel', 'iframe', 'manual']);
/**
 * Click-level "Conversion Status" filter: `any` = the click has ≥1 conversion (any status),
 * `approved|pending|rejected` = ≥1 conversion of that status, `none` = no conversion at all.
 * Absent = no filtering.
 */
const CONVERSION_STATUS = z.enum(['any', 'approved', 'pending', 'rejected', 'none']);
type ConversionStatus = z.infer<typeof CONVERSION_STATUS>;

/**
 * SQL predicate for CONVERSION_STATUS on the click identified by `clickId`/`networkId` (EXISTS /
 * NOT EXISTS over that click's own-network conversions — served by conversions (network_id, click_id)).
 * A status value is pushed onto `params`.
 */
function conversionStatusSql(s: ConversionStatus, clickId: string, networkId: string, params: unknown[]): string {
  const base = `SELECT 1 FROM conversions cs WHERE cs.click_id = ${clickId} AND cs.network_id = ${networkId}`;
  if (s === 'none') return `NOT EXISTS (${base})`;
  if (s === 'any') return `EXISTS (${base})`;
  params.push(s);
  return `EXISTS (${base} AND cs.status = $${params.length})`;
}

// Each row-level endpoint gets its OWN schema listing exactly the filters it applies, and `.strict()`
// turns any other key into a 422 — a filter that's accepted but silently ignored reads as "applied"
// to the caller while returning unfiltered data.
const clicksSchema = z.object({
  ...rangeKeys,
  offerId: uuid, publisherId: uuid, advertiserId: uuid,
  ...clickAttrKeys,
  isUnique: z.enum(['true', 'false']).optional(),
  fraudMin: z.coerce.number().int().min(0).max(100).optional(),
  conversionStatus: CONVERSION_STATUS.optional(),
  clickIds: clickIdsParam,
  ip: ipParam,
  ...clickCaptureKeys,
  ...pageKeys,
}).strict().transform(withZonedRange);
type ClicksFilters = z.infer<typeof clicksSchema>;

const conversionsSchema = z.object({
  ...rangeKeys,
  offerId: uuid, publisherId: uuid, advertiserId: uuid,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  event: z.string().max(100).optional(),
  source: CONV_SOURCE.optional(),
  // e.g. the Advertiser Postback report = every source except admin-entered 'manual' conversions.
  excludeSource: CONV_SOURCE.optional(),
  currency: z.string().max(3).optional(),
  // Applied to the originating click (LEFT JOIN clicks k) — a conversion with no click can't match.
  ...clickAttrKeys,
  ...pageKeys,
}).strict().transform(withZonedRange);
type ConversionsFilters = z.infer<typeof conversionsSchema>;

const postbackLogsSchema = z.object({
  ...rangeKeys,
  offerId: uuid, publisherId: uuid,
  success: z.enum(['true', 'false']).optional(),
  ...pageKeys,
}).strict().transform(withZonedRange);
type PostbackLogsFilters = z.infer<typeof postbackLogsSchema>;

/** Aggregated endpoints page their groups; default = the max so the common case is one request. */
const groupPageKeys = {
  limit: z.coerce.number().int().min(1).max(DETAIL_PAGE_MAX).default(DETAIL_PAGE_MAX),
  offset: z.coerce.number().int().min(0).default(0),
};
const goalsSchema = z.object({
  ...rangeKeys,
  offerId: uuid, publisherId: uuid,
  ...groupPageKeys,
}).strict().transform(withZonedRange);

/** One filter → SQL column mapping. `op` defaults to '='; `bool` coerces 'true'/'false'. */
interface FilterSpec<F> { key: keyof F & string; col: string; op?: '=' | '<>' | '>=' | '<='; bool?: boolean }

/**
 * Assemble a parameterized WHERE from a report's allowed filter specs. `params` continues an
 * existing list when given (so a second WHERE — e.g. on the joined click — shares the numbering).
 */
function buildWhere<F extends object>(networkId: string, f: F, specs: FilterSpec<F>[], params: unknown[] = [networkId], first = 'network_id = $1') {
  const where: string[] = first ? [first] : [];
  for (const s of specs) {
    const raw = (f as Record<string, unknown>)[s.key];
    if (raw == null || raw === '') continue;
    const val = s.bool ? raw === 'true' : raw;
    params.push(val);
    where.push(`${s.col} ${s.op ?? '='} $${params.length}`);
  }
  return { where: where.join(' AND '), params };
}

/** `{ rows, total, truncated }` for an aggregated endpoint paged by limit/offset. */
function pagedGroups<T>(rows: T[], total: number, f: { offset: number }) {
  return { rows, total, truncated: f.offset + rows.length < total };
}

// ── Grouped performance report (Everflow/Spaxads Offer/Affiliate/Advertiser/Daily reports) ──
// `.strict()` like the row-level schemas: an unknown filter is a 422, never silently ignored.
const groupedSchema = z.object({
  groupBy: z.enum(['offer', 'publisher', 'advertiser', 'day', 'country', 'device']).default('offer'),
  ...rangeKeys,
  // Comma lists (or repeated params). `offerId`/`publisherId`/… singular aliases are what the
  // row-level Click report sends, so the same query string works for both modes.
  offerIds: csvList(z.string().uuid()), offerId: csvList(z.string().uuid()),
  publisherIds: csvList(z.string().uuid()), publisherId: csvList(z.string().uuid()),
  advertiserIds: csvList(z.string().uuid()), advertiserId: csvList(z.string().uuid()),
  smartLinkIds: csvList(z.string().uuid()), smartLinkId: csvList(z.string().uuid()),
  country: csvList(z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase())),
  device: csvList(z.string().max(40)),
  conversionStatus: CONVERSION_STATUS.optional(),
  // Same click-level filters as /clicks, so the Click report's filters mean the same in both modes.
  clickIds: clickIdsParam,
  ip: ipParam,
  isUnique: z.enum(['true', 'false']).optional(),
  ...clickCaptureKeys,
}).strict().transform(withZonedRange);
type Grouped = z.infer<typeof groupedSchema>;
const merge = (...lists: (string[] | undefined)[]) => Array.from(new Set(lists.flatMap((l) => l ?? [])));

/**
 * Shared filter WHERE for clicks (alias c) / conversions (alias v). Click attributes on the
 * conversion side (country, device, smart link) come from the joined click `k` — conversions
 * don't store them. Advertiser on the click side comes from the joined offer `o`.
 */
function groupedFilters(networkId: string, f: Grouped, isClicks: boolean) {
  const a = isClicks ? 'c' : 'v';
  const click = isClicks ? 'c' : 'k';
  const where: string[] = [`${a}.network_id = $1`];
  const params: unknown[] = [networkId];
  if (!isClicks) where.push(`v.status = 'approved'`);
  const push = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; params.push(val); where.push(`${expr} ${op} $${params.length}`); };
  const pushIn = (vals: string[], expr: string, type: 'uuid' | 'text') => { if (vals.length === 0) return; params.push(vals); where.push(`${expr} = ANY($${params.length}::${type}[])`); };
  push(f.from, `${a}.created_at`, '>='); push(f.to, `${a}.created_at`, '<=');
  pushIn(merge(f.offerIds, f.offerId), `${a}.offer_id`, 'uuid');
  pushIn(merge(f.publisherIds, f.publisherId), `${a}.publisher_id`, 'uuid');
  pushIn(merge(f.advertiserIds, f.advertiserId), isClicks ? 'o.advertiser_id' : 'v.advertiser_id', 'uuid');
  pushIn(merge(f.smartLinkIds, f.smartLinkId), `${click}.smart_link_id`, 'uuid');
  pushIn(f.country ?? [], `${click}.country`, 'text');
  pushIn(f.device ?? [], `${click}.device`, 'text');
  // Click IDs: conversions store their click_id, so no join is needed on that side.
  pushIn(f.clickIds ?? [], `${a}.click_id`, 'text');
  if (f.ip) { params.push(f.ip); where.push(`${click}.ip = $${params.length}::inet`); }
  if (f.isUnique) { params.push(f.isUnique === 'true'); where.push(`${click}.is_unique = $${params.length}`); }
  push(f.sourceId, `${click}.source_id`); push(f.fbclid, `${click}.fbclid`); push(f.gclid, `${click}.gclid`);
  // Conversion Status is a predicate on the CLICK. Clicks side: the click itself must pass. Conversions
  // side: a conversion is counted only when its originating click exists (same network) and passes —
  // so the conversions/money shown are exactly those of the filtered clicks (offline/import
  // conversions with no click row drop out; `none` therefore always yields 0 conversions).
  if (f.conversionStatus) {
    if (isClicks) where.push(conversionStatusSql(f.conversionStatus, 'c.click_id', 'c.network_id', params));
    else {
      where.push('EXISTS (SELECT 1 FROM clicks kc WHERE kc.click_id = v.click_id AND kc.network_id = v.network_id)');
      where.push(conversionStatusSql(f.conversionStatus, 'v.click_id', 'v.network_id', params));
    }
  }
  return { where: where.join(' AND '), params };
}

const dashboardSchema = z.object({
  tz: tzParam.optional(),
});

/** The report time zone: `?tz=` → the network's (Settings › General) → UTC. */
async function reportTimeZone(networkId: string, param: string | undefined): Promise<string> {
  return param ?? networkTimeZone(networkId);
}

/** The first day of the month before `date`'s (YYYY-MM-DD). */
function previousMonthFirst(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

export function mountDetailReports(r: Router): void {
  r.get('/grouped', validateQuery(groupedSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as Grouped;

    // Aggregate clicks + conversions keyed by the group dimension, then merge in SQL. Days are the
    // report zone's (`?tz=`, D7), UTC when unset.
    let dayZone = `'UTC'`;
    const dim = (alias: string): string => {
      switch (f.groupBy) {
        case 'offer': return `COALESCE(${alias}.offer_id::text, '~none~')`;
        case 'publisher': return `COALESCE(${alias}.publisher_id::text, '~none~')`;
        case 'advertiser': return alias === 'c' ? `COALESCE(o.advertiser_id::text, '~none~')` : `COALESCE(v.advertiser_id::text, '~none~')`;
        case 'day': return `to_char(date_trunc('day', ${alias}.created_at, ${dayZone}), 'YYYY-MM-DD')`;
        case 'country': return `COALESCE(${alias === 'c' ? 'c' : 'k'}.country, '—')`;
        case 'device': return `COALESCE(${alias === 'c' ? 'c' : 'k'}.device, '—')`;
      }
    };
    const needsOffers = f.groupBy === 'advertiser' || merge(f.advertiserIds, f.advertiserId).length > 0;
    const clicksJoin = needsOffers ? 'JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id' : '';
    const needsClick = f.groupBy === 'country' || f.groupBy === 'device' || (f.country?.length ?? 0) > 0
      || (f.device?.length ?? 0) > 0 || merge(f.smartLinkIds, f.smartLinkId).length > 0
      || f.ip != null || f.isUnique != null || f.sourceId != null || f.fbclid != null || f.gclid != null;
    const convJoin = needsClick ? 'LEFT JOIN clicks k ON k.click_id = v.click_id AND k.network_id = v.network_id' : '';
    const cf = groupedFilters(nid, f, true);
    const vf = groupedFilters(nid, f, false);
    // conversions params come after clicks params; shift their $ placeholders.
    const shift = cf.params.length; // clicks params occupy $1..$shift ($1 = networkId, shared)
    const vWhere = vf.where.replace(/\$(\d+)/g, (_, n) => { const k = Number(n); return k === 1 ? '$1' : `$${k + shift - 1}`; });
    const vParams = vf.params.slice(1); // drop duplicate networkId
    const params = [...cf.params, ...vParams];
    if (f.groupBy === 'day' && !isUtcZone(f.tz)) { params.push(f.tz); dayZone = `$${params.length}::text`; }

    const sql = `
      WITH cl AS (
        SELECT ${dim('c')} AS k, COUNT(*)::int AS clicks
        FROM clicks c ${clicksJoin} WHERE ${cf.where} GROUP BY 1
      ), cv AS (
        SELECT ${dim('v')} AS k, COUNT(*)::int AS conversions,
               round(COALESCE(SUM(v.payout),0), 4) AS payout,
               round(COALESCE(SUM(v.revenue),0), 4) AS revenue,
               -- Currencies of the (approved) conversions summed above; >1 = a mixed-currency sum.
               array_agg(DISTINCT v.currency ORDER BY v.currency) FILTER (WHERE v.currency IS NOT NULL) AS currencies
        FROM conversions v ${convJoin} WHERE ${vWhere} GROUP BY 1
      ), cm AS (
        -- The same conversions' money per currency (NULL currency excluded) — never summed across.
        SELECT ${dim('v')} AS k, v.currency AS cur,
               COALESCE(SUM(v.payout),0) AS p, COALESCE(SUM(v.revenue),0) AS r
        FROM conversions v ${convJoin} WHERE ${vWhere} AND v.currency IS NOT NULL GROUP BY 1, 2
      ), cmj AS (
        SELECT cm.k, ${MBC_JSON} AS mbc FROM cm GROUP BY cm.k
      )
      SELECT COALESCE(cl.k, cv.k) AS k,
             COALESCE(cl.clicks,0) AS clicks, COALESCE(cv.conversions,0) AS conversions,
             COALESCE(cv.payout,0)::text AS payout, COALESCE(cv.revenue,0)::text AS revenue,
             (COALESCE(cv.revenue,0) - COALESCE(cv.payout,0))::text AS profit,
             COALESCE(cv.currencies, '{}'::text[]) AS currencies,
             COALESCE(cmj.mbc, '{}'::jsonb) AS money_by_currency
        FROM cl FULL OUTER JOIN cv ON cl.k = cv.k
        LEFT JOIN cmj ON cmj.k = COALESCE(cl.k, cv.k)`;
    const { rows } = await query<{ k: string; clicks: number; conversions: number; payout: string; revenue: string; profit: string; currencies: string[] | null; money_by_currency: MoneyByCurrency | null }>(sql, params);

    // A group with no offer of its own (partner / advertiser / day / country / device, or no
    // conversions) is in the network's default currency — never an assumed 'USD'.
    const net = await query<{ default_currency: string | null }>(`SELECT default_currency FROM networks WHERE id = $1`, [nid]);
    const networkCurrency = net.rows[0]?.default_currency || 'USD';

    // Resolve labels + numeric ref for entity groupings.
    let labels: Map<string, { ref: number; label: string; currency?: string }> = new Map();
    if (f.groupBy === 'offer') {
      const l = await query<{ id: string; ref: string; name: string; currency: string }>(`SELECT id, ref, name, currency FROM offers WHERE network_id = $1`, [nid]);
      labels = new Map(l.rows.map((x) => [x.id, { ref: Number(x.ref), label: x.name, currency: x.currency }]));
    } else if (f.groupBy === 'publisher') {
      const l = await query<{ id: string; ref: string; name: string }>(`SELECT id, ref, name FROM publishers WHERE network_id = $1`, [nid]);
      labels = new Map(l.rows.map((x) => [x.id, { ref: Number(x.ref), label: x.name }]));
    } else if (f.groupBy === 'advertiser') {
      const l = await query<{ id: string; ref: string; name: string }>(`SELECT id, ref, name FROM advertisers WHERE network_id = $1`, [nid]);
      labels = new Map(l.rows.map((x) => [x.id, { ref: Number(x.ref), label: x.name }]));
    }

    // Deterministic order (the table and the export both follow it): days chronologically; any other
    // grouping by clicks, then label, then key — equal-click groups no longer come back shuffled.
    const out = rows.map((row) => {
      const meta = labels.get(row.k);
      const clicks = row.clicks, conversions = row.conversions;
      return {
        key: row.k,
        id: meta ? meta.ref : null,
        label: meta ? meta.label : (row.k === '~none~' ? '(none)' : row.k),
        currency: meta?.currency ?? networkCurrency,
        clicks, conversions,
        payout: row.payout, revenue: row.revenue, profit: row.profit,
        currencies: row.currencies ?? [],
        moneyByCurrency: row.money_by_currency ?? {},
        cr: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
        epc: clicks > 0 ? Number((Number(row.payout) / clicks).toFixed(4)) : 0,
      };
    }).sort((a, b) => (f.groupBy === 'day'
      ? a.key.localeCompare(b.key)
      : b.clicks - a.clicks || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)));

    // Money stays exact decimal text (never float sums).
    const totals = out.reduce((t, r) => ({
      clicks: t.clicks + r.clicks, conversions: t.conversions + r.conversions,
      payout: addMoney(t.payout, r.payout), revenue: addMoney(t.revenue, r.revenue), profit: addMoney(t.profit, r.profit),
    }), { clicks: 0, conversions: 0, payout: '0', revenue: '0', profit: '0' });
    const totalCurrencies = Array.from(new Set(out.flatMap((r) => r.currencies))).sort();

    sendOk(res, { rows: out, totals: { ...totals, currencies: totalCurrencies, moneyByCurrency: mergeMoneyByCurrency(out.map((r) => r.moneyByCurrency)) } });
  }));

  // ── 24h KPI summary for the admin dashboard tiles ──
  r.get('/summary', asyncHandler(async (req, res) => {
    sendOk(res, await summary24h(req.scope!.networkId, 'admin'));
  }));

  // ── Full "Today's Stats" dashboard: per-period totals + today's hourly series (Everflow-style) ──
  // F-20: read through the reporting provider — the 15-minute rollups plus the raw tail — instead of
  // scanning two months of raw rows per load; the periods and the hourly series are in the network's
  // time zone (Settings › General), `?tz=` overrides, UTC when neither is set.
  r.get('/dashboard', validateQuery(dashboardSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const tz = await reportTimeZone(nid, (res.locals.query as z.infer<typeof dashboardSchema>).tz);
    const today = localDate(new Date(), tz);
    const todayStart = zonedDayStart(today, tz);
    const monthStart = zonedDayStart(`${today.slice(0, 7)}-01`, tz);
    const PERIODS = {
      today: { from: todayStart.toISOString() },
      yesterday: { from: zonedDayStart(addDays(today, -1), tz).toISOString(), to: inclusiveBefore(todayStart) },
      month: { from: monthStart.toISOString() },
      lastMonth: { from: zonedDayStart(previousMonthFirst(today), tz).toISOString(), to: inclusiveBefore(monthStart) },
    } as const;
    const provider = getReportingProvider();
    const base = { networkId: nid, offset: 0, moneyFields: [...MONEY_FIELDS], ...(isUtcZone(tz) ? {} : { timeZone: tz }) };
    const [periodRows, hourly] = await Promise.all([
      Promise.all((Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map(async (k) => {
        const r = await provider.runReport({
          ...base, groupBy: [], filters: PERIODS[k], limit: 1,
          metrics: ['clicks', 'conversions', 'payout', 'revenue', 'margin', 'currencies', 'money_by_currency'],
        });
        return [k, r.rows[0]?.metrics ?? {}] as const;
      })),
      provider.runReport({
        ...base, groupBy: ['hour'], filters: { from: todayStart.toISOString() }, limit: 100,
        metrics: ['clicks', 'conversions', 'payout', 'revenue', 'margin'],
      }),
    ]);
    const m = Object.fromEntries(periodRows) as Record<keyof typeof PERIODS, Record<string, unknown>>;
    const per = <T>(fn: (x: Record<string, unknown>) => T) =>
      ({ today: fn(m.today), yesterday: fn(m.yesterday), month: fn(m.month), lastMonth: fn(m.lastMonth) });
    // Counts are integers; money stays the 4dp text SQL produced (never JS float arithmetic — F-22).
    const clicks = per((x) => Number(x['clicks'] ?? 0));
    const conversions = per((x) => Number(x['conversions'] ?? 0));
    const money = (k: string) => per((x) => String(x[k] ?? '0.0000'));
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 100 : 0); // a rate, not money
    const cr = { today: pct(conversions.today, clicks.today), yesterday: pct(conversions.yesterday, clicks.yesterday),
      month: pct(conversions.month, clicks.month), lastMonth: pct(conversions.lastMonth, clicks.lastMonth) };

    // Today's 24 hourly slots, by each row's local hour — the provider returns only the hours that
    // have data, so a series is never filled by row position.
    const series = <T>(empty: T, fn: (x: Record<string, unknown>) => T): T[] => {
      const a = Array<T>(24).fill(empty);
      for (const row of hourly.rows) {
        const h = Number((row.dimensions['hour'] ?? '').slice(11, 13));
        if (Number.isInteger(h) && h >= 0 && h < 24) a[h] = fn(row.metrics);
      }
      return a;
    };
    const clicksSeries = series(0, (x) => Number(x['clicks'] ?? 0));
    const conversionsSeries = series(0, (x) => Number(x['conversions'] ?? 0));
    sendOk(res, {
      timeZone: tz,
      clicks, conversions,
      revenue: money('revenue'),
      payout: money('payout'),
      margin: money('margin'),
      currencies: per((x) => (Array.isArray(x['currencies']) ? (x['currencies'] as string[]) : [])),
      moneyByCurrency: per((x) => (x['money_by_currency'] ?? {}) as MoneyByCurrency),
      cr,
      series: {
        clicks: clicksSeries,
        conversions: conversionsSeries,
        revenue: series('0.0000', (x) => String(x['revenue'])),
        payout: series('0.0000', (x) => String(x['payout'])),
        margin: series('0.0000', (x) => String(x['margin'])),
        cr: clicksSeries.map((n, h) => pct(conversionsSeries[h]!, n)),
      },
    });
  }));

  // ── Clicks report — row-level click log (IP, geo, device, subs, fraud) ──
  r.get('/clicks', validateQuery(clicksSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as ClicksFilters;
    const { where, params } = buildWhere<ClicksFilters>(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'offerId', col: 'offer_id' }, { key: 'publisherId', col: 'publisher_id' },
      { key: 'smartLinkId', col: 'smart_link_id' },
      { key: 'country', col: 'country' }, { key: 'region', col: 'region' }, { key: 'city', col: 'city' },
      { key: 'device', col: 'device' }, { key: 'os', col: 'os' }, { key: 'browser', col: 'browser' },
      { key: 'sub1', col: 'sub1' }, { key: 'sub2', col: 'sub2' }, { key: 'sub3', col: 'sub3' },
      { key: 'sub4', col: 'sub4' }, { key: 'sub5', col: 'sub5' },
      { key: 'isUnique', col: 'is_unique', bool: true }, { key: 'fraudMin', col: 'fraud_score', op: '>=' },
      { key: 'sourceId', col: 'source_id' }, { key: 'fbclid', col: 'fbclid' }, { key: 'gclid', col: 'gclid' },
    ]);
    // Clicks don't store the advertiser — resolve it through the (same-network) offer.
    let clickWhere = where;
    if (f.advertiserId) {
      params.push(f.advertiserId);
      clickWhere += ` AND offer_id IN (SELECT id FROM offers WHERE network_id = $1 AND advertiser_id = $${params.length})`;
    }
    // Conversion Status filters the click rows; the `converted` column below stays "any status".
    if (f.conversionStatus) clickWhere += ` AND ${conversionStatusSql(f.conversionStatus, 'clicks.click_id', 'clicks.network_id', params)}`;
    if (f.clickIds?.length) { params.push(f.clickIds); clickWhere += ` AND click_id = ANY($${params.length}::text[])`; }
    // Rows return host(ip) — the plain address (no /32 mask) — so a value copied from the table filters.
    if (f.ip) { params.push(f.ip); clickWhere += ` AND ip = $${params.length}::inet`; }
    params.push(f.limit, f.offset);
    const { rows } = await query<{ referrer: string | null }>(
      `SELECT click_id, created_at, offer_id, publisher_id, smart_link_id, host(ip) AS ip, country, region, city, isp,
              device, os, browser, is_unique, fraud_score, fraud_flags, sub1, sub2, sub3, sub4, sub5,
              referrer, user_agent, currency,
              -- Blank = not present: a '' stored by an earlier build reads as NULL (data unchanged).
              CASE WHEN btrim(source_id) = '' THEN NULL ELSE source_id END AS source_id,
              CASE WHEN btrim(fbclid) = '' THEN NULL ELSE fbclid END AS fbclid,
              CASE WHEN btrim(gclid) = '' THEN NULL ELSE gclid END AS gclid,
              resolved_payout::text AS resolved_payout, resolved_revenue::text AS resolved_revenue,
              EXISTS(SELECT 1 FROM conversions cv WHERE cv.click_id = clicks.click_id AND cv.network_id = clicks.network_id) AS converted
         FROM clicks WHERE ${clickWhere}
        -- click_id breaks created_at ties: offset paging (the table and the paged export) must see one
        -- fixed order, or clicks sharing a timestamp repeat on one page and vanish from the next.
        ORDER BY created_at DESC, click_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    // The referring page's URL can carry its own tokens — same redaction as postback URLs.
    sendOk(res, rows.map((r) => ({ ...r, referrer: r.referrer == null ? null : redactUrl(r.referrer) })), { limit: f.limit, offset: f.offset });
  }));

  // ── Conversions report — row-level conversion log, incl. click-time context (geo/device/subs)
  // for the originating click via a LEFT JOIN on click_id. Filtering runs on the `conversions`-only
  // subquery first (avoids column-name ambiguity with `clicks` on the outer join) before joining.
  r.get('/conversions', validateQuery(conversionsSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as ConversionsFilters;
    const { where, params } = buildWhere<ConversionsFilters>(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'offerId', col: 'offer_id' }, { key: 'publisherId', col: 'publisher_id' },
      { key: 'advertiserId', col: 'advertiser_id' }, { key: 'status', col: 'status' },
      { key: 'event', col: 'event_name' }, { key: 'source', col: 'source' }, { key: 'currency', col: 'currency' },
      { key: 'excludeSource', col: 'source', op: '<>' },
    ]);
    // Click-side filters run on the joined originating click (same numbering as `params`).
    const { where: clickWhere } = buildWhere<ConversionsFilters>(req.scope!.networkId, f, [
      { key: 'smartLinkId', col: 'k.smart_link_id' },
      { key: 'country', col: 'k.country' }, { key: 'region', col: 'k.region' }, { key: 'city', col: 'k.city' },
      { key: 'device', col: 'k.device' }, { key: 'os', col: 'k.os' }, { key: 'browser', col: 'k.browser' },
      { key: 'sub1', col: 'k.sub1' }, { key: 'sub2', col: 'k.sub2' }, { key: 'sub3', col: 'k.sub3' },
      { key: 'sub4', col: 'k.sub4' }, { key: 'sub5', col: 'k.sub5' },
    ], params, '');
    params.push(f.limit, f.offset);
    const { rows } = await query<{ raw_params: unknown }>(
      `SELECT v.conversion_id, v.created_at, v.click_id, v.offer_id, v.publisher_id, v.advertiser_id,
              v.event_name, v.goal_id, og.name AS goal_name, v.status, v.reason, v.payout, v.revenue,
              v.currency, v.transaction_id, v.source, v.fraud_score, v.raw_params,
              k.created_at AS click_created_at, k.country, k.region, k.city, k.isp,
              k.device, k.os, k.browser, k.sub1, k.sub2, k.sub3, k.sub4, k.sub5,
              EXTRACT(EPOCH FROM (v.created_at - k.created_at))::int AS delta_seconds
         FROM (SELECT conversion_id, network_id, created_at, click_id, offer_id, publisher_id, advertiser_id,
                      event_name, goal_id, status, reason, payout, revenue, currency, transaction_id, source,
                      fraud_score, raw_params
                 FROM conversions WHERE ${where}) v
         LEFT JOIN clicks k ON k.click_id = v.click_id AND k.network_id = v.network_id
         LEFT JOIN offer_goals og ON og.id = v.goal_id AND og.network_id = v.network_id
        ${clickWhere ? `WHERE ${clickWhere}` : ''}
        -- conversion_id breaks created_at ties so offset pages (table + paged export) never repeat or skip a row.
        ORDER BY v.created_at DESC, v.conversion_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    // raw_params holds every inbound postback param — incl. the advertiser's secure_code, which
    // must never leave through a report (screen or export). The bag is kept (the Advertiser
    // Postback report shows the payload as received) but every sensitive value is masked.
    sendOk(res, rows.map((r) => ({ ...r, raw_params: redactRawParams(r.raw_params) })), { limit: f.limit, offset: f.offset });
  }));

  // ── Postback logs report — outbound delivery attempts ──
  // Partner Postback report — real delivery log, extended with a LEFT JOIN to the conversion it fired
  // for (via conversion_id) so Offer/Event Name/Advertiser can be shown honestly rather than omitted.
  r.get('/postback-logs', validateQuery(postbackLogsSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as PostbackLogsFilters;
    const { where, params } = buildWhere<PostbackLogsFilters>(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'publisherId', col: 'publisher_id' }, { key: 'success', col: 'success', bool: true },
    ]);
    let offerJoinFilter = '';
    if (f.offerId) { params.push(f.offerId); offerJoinFilter = ` AND c.offer_id = $${params.length}`; }
    params.push(f.limit, f.offset);
    const { rows } = await query<{ url: string; error: string | null }>(
      `SELECT p.id, p.created_at, p.conversion_id, p.publisher_id, p.url, p.attempt, p.status_code, p.success, p.error,
              c.offer_id, c.event_name
         FROM (SELECT * FROM postback_logs WHERE ${where}) p
         LEFT JOIN conversions c ON c.conversion_id = p.conversion_id AND c.network_id = p.network_id
        WHERE 1=1${offerJoinFilter}
        ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    // `url` is the partner's template with macros filled — it can carry the partner's own token /
    // api key / userinfo. Mask those values (screen + export); the stored log is unchanged. `error`
    // is free text that could quote the URL, so it gets the same key=value masking.
    sendOk(res, rows.map((r) => ({ ...r, url: redactUrl(r.url), error: r.error == null ? r.error : redactUrl(r.error) })), { limit: f.limit, offset: f.offset });
  }));

  // ── Goals/Event report — approved conversions aggregated per offer goal, plus each offer's real
  // click count (clicks aren't tied to a specific goal, so it's queried per-offer and merged in) —
  // together these back CVR (Total (from Clicks) / Clicks) on the Event Report.
  r.get('/goals', validateQuery(goalsSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof goalsSchema>;
    const params: unknown[] = [req.scope!.networkId];
    const where = ["c.network_id = $1", "c.status = 'approved'"];
    const push = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; params.push(val); where.push(`${expr} ${op} $${params.length}`); };
    push(f.from, 'c.created_at', '>='); push(f.to, 'c.created_at', '<='); push(f.offerId, 'c.offer_id'); push(f.publisherId, 'c.publisher_id');
    const clickParams: unknown[] = [req.scope!.networkId];
    const clickWhere = ['network_id = $1'];
    const pushClick = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; clickParams.push(val); clickWhere.push(`${expr} ${op} $${clickParams.length}`); };
    pushClick(f.from, 'created_at', '>='); pushClick(f.to, 'created_at', '<='); pushClick(f.offerId, 'offer_id'); pushClick(f.publisherId, 'publisher_id');

    // One row per (offer, goal_id) for conversions resolved to a goal — two goals sharing a name stay
    // two rows. Conversions with no goal_id (imports/offline never set it, or an event no goal matched)
    // are one row per (offer, event_name), flagged `unmatched`, and are never folded into a goal row
    // even when the names match. Label (`goal`): the goal's name; for unmatched rows the event name,
    // '(no event)' when there is none.
    const groupsSql = `SELECT CASE WHEN c.goal_id IS NULL THEN COALESCE(MIN(c.event_name), '(no event)')
                     ELSE COALESCE(MAX(og.name), MIN(c.event_name), '(default)') END AS goal,
                c.offer_id,
                c.goal_id,
                (c.goal_id IS NULL) AS unmatched,
                (CASE WHEN c.goal_id IS NULL THEN c.event_name END) AS event_key,
                COUNT(*)::int AS conversions,
                round(COALESCE(SUM(c.payout),0), 4) AS payout,
                round(COALESCE(SUM(c.revenue),0), 4) AS revenue,
                (COALESCE(SUM(c.revenue),0) - COALESCE(SUM(c.payout),0))::numeric(14,4) AS margin,
                -- The row's money is in its offer's currency (network default if the offer is gone).
                COALESCE((SELECT o.currency FROM offers o WHERE o.id = c.offer_id AND o.network_id = $1),
                         (SELECT n.default_currency FROM networks n WHERE n.id = $1)) AS currency,
                -- …as booked: the conversions' own currencies (>1 = the money above mixes currencies).
                COALESCE(array_agg(DISTINCT c.currency ORDER BY c.currency) FILTER (WHERE c.currency IS NOT NULL), '{}'::text[]) AS currencies
           FROM conversions c
           LEFT JOIN offer_goals og ON og.id = c.goal_id AND og.network_id = c.network_id
          WHERE ${where.join(' AND ')}
          GROUP BY c.offer_id, c.goal_id, (CASE WHEN c.goal_id IS NULL THEN c.event_name END)`;
    const n = params.length;
    const [goalRes, countRes, clickRes] = await Promise.all([
      // Each page row's money per currency: the row's own conversions (same filters, same group key —
      // goal id, or event name when goal-less), summed per non-NULL currency.
      query<{ goal: string; offer_id: string; goal_id: string | null; unmatched: boolean; event_key?: string | null; conversions: number; payout: string; revenue: string; margin: string; currency: string | null; currencies: string[]; money_by_currency?: MoneyByCurrency | null }>(
        `SELECT g.*, COALESCE(mc.mbc, '{}'::jsonb) AS money_by_currency
           FROM (${groupsSql} ORDER BY conversions DESC, goal, c.offer_id, c.goal_id LIMIT $${n + 1} OFFSET $${n + 2}) g
           LEFT JOIN LATERAL (
             SELECT ${MBC_JSON} AS mbc
               FROM (SELECT c.currency AS cur, COALESCE(SUM(c.payout),0) AS p, COALESCE(SUM(c.revenue),0) AS r
                       FROM conversions c
                      WHERE ${where.join(' AND ')} AND c.currency IS NOT NULL
                        AND c.offer_id = g.offer_id AND c.goal_id IS NOT DISTINCT FROM g.goal_id
                        AND (g.goal_id IS NOT NULL OR c.event_name IS NOT DISTINCT FROM g.event_key)
                      GROUP BY c.currency) cm
           ) mc ON true
          ORDER BY g.conversions DESC, g.goal, g.offer_id, g.goal_id`,
        [...params, f.limit, f.offset],
      ),
      // Real group count, so a page that stops at `limit` is reported as such (never a silent cap).
      query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM (${groupsSql}) g`, params),
      query<{ offer_id: string; clicks: number }>(
        `SELECT offer_id, COUNT(*)::int AS clicks FROM clicks WHERE ${clickWhere.join(' AND ')} GROUP BY 1`,
        clickParams,
      ),
    ]);
    const clicksByOffer = new Map(clickRes.rows.map((r) => [r.offer_id, r.clicks]));
    const rows = goalRes.rows.map(({ event_key: _ek, money_by_currency, ...r }) => {
      const clicks = clicksByOffer.get(r.offer_id) ?? 0;
      return {
        ...r,
        moneyByCurrency: money_by_currency ?? {},
        clicks,
        cvr: clicks > 0 ? Number(((r.conversions / clicks) * 100).toFixed(2)) : 0,
        marginPct: Number(r.revenue) > 0 ? Number(((Number(r.margin) / Number(r.revenue)) * 100).toFixed(2)) : 0,
      };
    });
    sendOk(res, pagedGroups(rows, Number(countRes.rows[0]?.total ?? 0), f));
  }));

  // ── Smart Link report — clicks & conversions attributed to each smart link ──
  r.get('/smart-links', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT sl.id, sl.name, sl.status,
              (SELECT COUNT(*) FROM clicks c WHERE c.network_id = sl.network_id AND c.smart_link_id = sl.id)::int AS clicks,
              (SELECT COUNT(*) FROM conversions cv WHERE cv.network_id = sl.network_id AND cv.click_id IN
                 (SELECT click_id FROM clicks c2 WHERE c2.network_id = sl.network_id AND c2.smart_link_id = sl.id)
                 AND cv.status = 'approved')::int AS conversions
         FROM smart_links sl
        WHERE sl.network_id = $1
        ORDER BY sl.created_at DESC`,
      [req.scope!.networkId],
    );
    sendOk(res, rows);
  }));

  // ── Pacing report — real cap fulfillment across the three cap surfaces this app actually has:
  // offer-level daily/total conversion caps, offer-level daily click caps, and offer-group daily
  // payout/revenue caps (spec has no weekly/monthly cap concept, so those reference periods are
  // omitted rather than faked). Summary is a network-wide snapshot (today + all-time); Detail is a
  // real per-day, per-entity breakdown for the requested date range and category.
  const pacingSchema = z.object({
    from: utcFromDate.optional(),
    to: utcToDate.optional(),
    category: z.enum(['click', 'conversion', 'payout', 'revenue']).default('conversion'),
    // Detail rows for one offer (payout/revenue: the offer groups that contain it).
    offerId: uuid,
  }).strict();
  // Conversion-cap USAGE mirrors enforcement (surfaces/tracking/conversions/record.ts →
  // conversionCapReached): every NON-REJECTED conversion counts (pending ones consume the cap too),
  // and "today" starts at the UTC day boundary. Payout/revenue cap usage stays APPROVED-only — that's
  // money actually earned. Money (caps + actuals) is returned as numeric(14,4) text; percentages are numbers.
  const CAP_COUNTED = `status <> 'rejected'`;
  const UTC_TODAY = `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
  // A cap only counts when it is POSITIVE: enforcement treats null and <= 0 as unlimited
  // (tracking/caps.ts isClickCapped, conversions/record.ts conversionCapReached), so a zero/negative
  // cap is "no cap" here too — excluded exactly like a NULL one, never shown as a 0 denominator.
  const offerCap = (col: 'daily_click_cap' | 'daily_conversion_cap' | 'total_conversion_cap') =>
    `CASE WHEN o.${col} > 0 THEN o.${col} END`;
  // Offer-group caps live in free-form JSON (`caps.<payout|revenue>.daily`), so a stored value can be
  // anything ("abc", "", -5, an object, a 1000-digit number). Only a plain non-negative decimal is cast
  // — the CASE guard makes the cast unreachable otherwise (a blind ::numeric would make Postgres throw
  // → 500) — and the digit bounds keep the cast itself from overflowing. Invalid, zero and negative
  // values all yield NULL = "no cap": the group is left out of summary and detail, like a missing cap.
  const groupDailyCap = (col: 'payout' | 'revenue') =>
    `NULLIF(CASE WHEN og.caps->'${col}'->>'daily' ~ '^[0-9]{1,15}([.][0-9]{1,100})?$'
                 THEN round((og.caps->'${col}'->>'daily')::numeric, 4) END, 0)`;
  r.get('/pacing', validateQuery(pacingSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as z.infer<typeof pacingSchema>;

    const [clickCap, convCap, groupCap] = await Promise.all([
      query<{ id: string; name: string; daily_click_cap: number; clicks_today: number }>(
        `SELECT o.id, o.name, o.daily_click_cap,
                (SELECT COUNT(*) FROM clicks cl WHERE cl.network_id = o.network_id AND cl.offer_id = o.id
                   AND cl.created_at >= date_trunc('day', now(), 'UTC'))::int AS clicks_today
           FROM offers o WHERE o.network_id = $1 AND o.daily_click_cap > 0`,
        [nid],
      ),
      query<{ id: string; name: string; daily_conversion_cap: number | null; total_conversion_cap: number | null; conversions_today: number; conversions_total: number }>(
        `SELECT o.id, o.name, ${offerCap('daily_conversion_cap')} AS daily_conversion_cap,
                ${offerCap('total_conversion_cap')} AS total_conversion_cap,
                (SELECT COUNT(*) FROM conversions c WHERE c.network_id = o.network_id AND c.offer_id = o.id
                   AND c.${CAP_COUNTED} AND c.created_at >= ${UTC_TODAY})::int AS conversions_today,
                (SELECT COUNT(*) FROM conversions c WHERE c.network_id = o.network_id AND c.offer_id = o.id
                   AND c.${CAP_COUNTED})::int AS conversions_total
           FROM offers o WHERE o.network_id = $1 AND (o.daily_conversion_cap > 0 OR o.total_conversion_cap > 0)`,
        [nid],
      ),
      query<{ id: string; name: string; daily_payout_cap: string | null; daily_revenue_cap: string | null; payout_today: string; revenue_today: string; cap_currency: string | null; currencies_today: string[] | null }>(
        // Approved-only: payout/revenue caps track money actually earned.
        `SELECT og.id, og.name, gc.daily_payout_cap, gc.daily_revenue_cap,
                COALESCE((SELECT SUM(c.payout) FROM conversions c WHERE c.network_id = og.network_id AND c.status = 'approved'
                   AND c.created_at >= date_trunc('day', now(), 'UTC') AND og.offer_ids ? c.offer_id::text), 0)::numeric(14,4) AS payout_today,
                COALESCE((SELECT SUM(c.revenue) FROM conversions c WHERE c.network_id = og.network_id AND c.status = 'approved'
                   AND c.created_at >= date_trunc('day', now(), 'UTC') AND og.offer_ids ? c.offer_id::text), 0)::numeric(14,4) AS revenue_today,
                -- Currency check for the pooled summary: the cap's currency + the currencies of the
                -- conversions summed above (same rows).
                COALESCE(NULLIF(og.currency, ''), (SELECT n.default_currency FROM networks n WHERE n.id = $1)) AS cap_currency,
                (SELECT array_agg(DISTINCT c.currency) FROM conversions c WHERE c.network_id = og.network_id AND c.status = 'approved'
                   AND c.created_at >= date_trunc('day', now(), 'UTC') AND og.offer_ids ? c.offer_id::text AND c.currency IS NOT NULL) AS currencies_today
           FROM offer_groups og
           CROSS JOIN LATERAL (SELECT ${groupDailyCap('payout')}::text AS daily_payout_cap,
                                      ${groupDailyCap('revenue')}::text AS daily_revenue_cap) gc
          WHERE og.network_id = $1 AND og.caps_enabled
            AND (gc.daily_payout_cap IS NOT NULL OR gc.daily_revenue_cap IS NOT NULL)`,
        [nid],
      ),
    ]);

    const sumRatio = (used: number, cap: number) => (cap > 0 ? Number(((used / cap) * 100).toFixed(2)) : 0);
    // Payout/revenue pool caps and actuals across groups: when the pooled groups' cap currencies and
    // their conversions' currencies are not all one currency, a pooled % would add unlike money — it
    // is reported as unavailable (`dailyUsedPct: null` + `mixedCurrency: true`) instead.
    type GroupCapRow = typeof groupCap.rows[number];
    const moneySummary = (category: 'payout' | 'revenue', capOf: (r: GroupCapRow) => string | null, usedOf: (r: GroupCapRow) => string) => {
      const pool = groupCap.rows.filter((r) => capOf(r) != null);
      const currencies = new Set(pool.flatMap((r) => [...(r.cap_currency ? [r.cap_currency] : []), ...(r.currencies_today ?? [])]));
      if (currencies.size > 1) return { category, dailyUsedPct: null, globalUsedPct: null, mixedCurrency: true };
      return {
        category,
        dailyUsedPct: pool.length ? sumRatio(pool.reduce((s, r) => s + Number(usedOf(r)), 0), pool.reduce((s, r) => s + Number(capOf(r) ?? 0), 0)) : null,
        globalUsedPct: null,
      };
    };
    const summary = [
      { category: 'click', dailyUsedPct: clickCap.rows.length ? sumRatio(clickCap.rows.reduce((s, r) => s + r.clicks_today, 0), clickCap.rows.reduce((s, r) => s + r.daily_click_cap, 0)) : null, globalUsedPct: null },
      { category: 'conversion',
        dailyUsedPct: convCap.rows.some((r) => r.daily_conversion_cap != null)
          ? sumRatio(convCap.rows.filter((r) => r.daily_conversion_cap != null).reduce((s, r) => s + r.conversions_today, 0), convCap.rows.filter((r) => r.daily_conversion_cap != null).reduce((s, r) => s + (r.daily_conversion_cap ?? 0), 0)) : null,
        globalUsedPct: convCap.rows.some((r) => r.total_conversion_cap != null)
          ? sumRatio(convCap.rows.filter((r) => r.total_conversion_cap != null).reduce((s, r) => s + r.conversions_total, 0), convCap.rows.filter((r) => r.total_conversion_cap != null).reduce((s, r) => s + (r.total_conversion_cap ?? 0), 0)) : null },
      moneySummary('payout', (r) => r.daily_payout_cap, (r) => r.payout_today),
      moneySummary('revenue', (r) => r.daily_revenue_cap, (r) => r.revenue_today),
    ];

    const dateWhereFor = (alias: string) => {
      const where: string[] = ['1=1'];
      const params: unknown[] = [nid];
      if (f.from) { params.push(f.from); where.push(`${alias}.created_at >= $${params.length}`); }
      if (f.to) { params.push(f.to); where.push(`${alias}.created_at <= $${params.length}`); }
      if (f.offerId) {
        params.push(f.offerId);
        where.push(f.category === 'payout' || f.category === 'revenue'
          ? `og.offer_ids ? $${params.length}::text`
          : `${alias}.offer_id = $${params.length}`);
      }
      return { where: where.join(' AND '), params };
    };

    // cap/actual: counts (numbers) for click/conversion; money (numeric(14,4) text, plus its `currency`) for payout/revenue.
    let detailRows: { date: string; entity: string; entityId: string; cap: number | string; actual: number | string; currency?: string; currencies?: string[]; moneyByCurrency?: MoneyByCurrency; usedPct: number }[] = [];
    if (f.category === 'click') {
      const { where, params } = dateWhereFor('cl');
      const { rows } = await query<{ day: string; offer_id: string; actual: number }>(
        `SELECT date_trunc('day', cl.created_at, 'UTC') AS day, cl.offer_id, COUNT(*)::int AS actual
           FROM clicks cl JOIN offers o ON o.id = cl.offer_id AND o.network_id = cl.network_id
          WHERE cl.network_id = $1 AND o.daily_click_cap > 0 AND ${where}
          GROUP BY 1, 2 ORDER BY 1 DESC`,
        params,
      );
      const byOffer = new Map(clickCap.rows.map((r) => [r.id, r]));
      detailRows = rows.map((r) => {
        const o = byOffer.get(r.offer_id);
        return { date: r.day, entity: o?.name ?? r.offer_id, entityId: r.offer_id, cap: o?.daily_click_cap ?? 0, actual: r.actual, usedPct: sumRatio(r.actual, o?.daily_click_cap ?? 0) };
      });
    } else if (f.category === 'conversion') {
      const { where, params } = dateWhereFor('c');
      const { rows } = await query<{ day: string; offer_id: string; actual: number }>(
        `SELECT date_trunc('day', c.created_at, 'UTC') AS day, c.offer_id, COUNT(*)::int AS actual
           FROM conversions c JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
          WHERE c.network_id = $1 AND c.${CAP_COUNTED} AND o.daily_conversion_cap > 0 AND ${where}
          GROUP BY 1, 2 ORDER BY 1 DESC`,
        params,
      );
      const byOffer = new Map(convCap.rows.map((r) => [r.id, r]));
      detailRows = rows.map((r) => {
        const o = byOffer.get(r.offer_id);
        return { date: r.day, entity: o?.name ?? r.offer_id, entityId: r.offer_id, cap: o?.daily_conversion_cap ?? 0, actual: r.actual, usedPct: sumRatio(r.actual, o?.daily_conversion_cap ?? 0) };
      });
    } else {
      const col = f.category === 'payout' ? 'payout' : 'revenue';
      const { where, params } = dateWhereFor('c');
      // Groups whose cap isn't a valid positive decimal are dropped by the join (see groupDailyCap).
      const [{ rows }, byCur] = await Promise.all([query<{ day: string; group_id: string; group_name: string; cap: string; actual: string; currency: string; currencies: string[] }>(
        `SELECT date_trunc('day', c.created_at, 'UTC') AS day, og.id AS group_id, og.name AS group_name,
                ${groupDailyCap(col)}::text AS cap,
                COALESCE(SUM(c.${col}),0)::numeric(14,4)::text AS actual,
                -- cap/actual are in the group's currency (network default when unset) — the UI formats with it.
                COALESCE(NULLIF(og.currency, ''), (SELECT n.default_currency FROM networks n WHERE n.id = $1)) AS currency,
                -- The summed conversions' own currencies: anything other than [currency] = unlike money.
                COALESCE(array_agg(DISTINCT c.currency ORDER BY c.currency) FILTER (WHERE c.currency IS NOT NULL), '{}'::text[]) AS currencies
           FROM conversions c
           JOIN offer_groups og ON og.network_id = c.network_id AND og.offer_ids ? c.offer_id::text
             AND og.caps_enabled AND ${groupDailyCap(col)} IS NOT NULL
          WHERE c.network_id = $1 AND c.status = 'approved' AND ${where}
          GROUP BY 1, 2, 3, 4, 6 ORDER BY 1 DESC`,
        params,
      ),
      // The same rows' `actual` split per conversion currency (NULL currency excluded).
      query<{ day: string; group_id: string; cur: string; amount: string }>(
        `SELECT date_trunc('day', c.created_at, 'UTC') AS day, og.id AS group_id, c.currency AS cur,
                COALESCE(SUM(c.${col}),0)::numeric(14,4)::text AS amount
           FROM conversions c
           JOIN offer_groups og ON og.network_id = c.network_id AND og.offer_ids ? c.offer_id::text
             AND og.caps_enabled AND ${groupDailyCap(col)} IS NOT NULL
          WHERE c.network_id = $1 AND c.status = 'approved' AND c.currency IS NOT NULL AND ${where}
          GROUP BY 1, 2, 3 ORDER BY 3`,
        params,
      )]);
      const dayKey = (d: unknown) => `${new Date(d as string).getTime()}|`;
      const mbc = new Map<string, MoneyByCurrency>();
      for (const r of byCur.rows) {
        const k = dayKey(r.day) + r.group_id;
        mbc.set(k, { ...(mbc.get(k) ?? {}), [r.cur]: { [col]: r.amount } });
      }
      detailRows = rows.map((r) => ({
        date: r.day, entity: r.group_name, entityId: r.group_id, cap: r.cap, actual: r.actual, currency: r.currency, currencies: r.currencies ?? [],
        moneyByCurrency: mbc.get(dayKey(r.day) + r.group_id) ?? {},
        usedPct: sumRatio(Number(r.actual), Number(r.cap)),
      }));
    }

    sendOk(res, { summary, category: f.category, rows: detailRows });
  }));

  // ── Cohort report — real per-day-of-click "aging" breakdown: for each cohort day (the day a click
  // happened), how many of a chosen conversion-side metric landed exactly N calendar days later.
  // Verified against the live reference: cells are NOT cumulative (Day 2 can be 0 while Day 1 is
  // nonzero) and a cell renders as "—" (not 0) when day N hasn't happened yet relative to today —
  // e.g., a cohort from yesterday can only ever show a real Day 1 value so far.
  const cohortSchema = z.object({
    from: queryDate,
    to: queryDate,
    tz: tzParam.optional(),
    topLevelMetric: z.enum(['clicks', 'unique_clicks']).default('clicks'),
    metric: z.enum(['conversions', 'payout', 'revenue']).default('conversions'),
    offerId: z.string().uuid().optional(),
    publisherId: z.string().uuid().optional(),
    advertiserId: z.string().uuid().optional(),
    smartLinkId: z.string().uuid().optional(),
    country: z.string().max(3).optional(),
    device: z.string().max(30).optional(),
  }).transform(withZonedRange);
  r.get('/cohort', validateQuery(cohortSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as z.infer<typeof cohortSchema>;

    const clickWhere = ['cl.network_id = $1', 'cl.created_at >= $2', 'cl.created_at <= $3'];
    const params: unknown[] = [nid, f.from, f.to];
    const add = (val: unknown, col: string) => { if (val == null || val === '') return; params.push(val); clickWhere.push(`${col} = $${params.length}`); };
    add(f.offerId, 'cl.offer_id'); add(f.publisherId, 'cl.publisher_id');
    add(f.smartLinkId, 'cl.smart_link_id'); add(f.country, 'cl.country'); add(f.device, 'cl.device');
    let advertiserJoin = '';
    if (f.advertiserId) { advertiserJoin = 'JOIN offers o ON o.id = cl.offer_id AND o.network_id = cl.network_id'; params.push(f.advertiserId); clickWhere.push(`o.advertiser_id = $${params.length}`); }
    // Cohort days are the report zone's (`?tz=`, D7), UTC when unset — every query below uses it.
    const zone = isUtcZone(f.tz) ? 'UTC' : f.tz!;
    params.push(zone);
    const tzRef = `$${params.length}::text`;

    const { rows: clickRows } = await query<{ cohort_day: string; clicks: number; unique_clicks: number }>(
      `SELECT date_trunc('day', cl.created_at, ${tzRef}) AS cohort_day, COUNT(*)::int AS clicks,
              COUNT(*) FILTER (WHERE cl.is_unique)::int AS unique_clicks
         FROM clicks cl ${advertiserJoin}
        WHERE ${clickWhere.join(' AND ')}
        GROUP BY 1 ORDER BY 1`,
      params,
    );

    const convCol = f.metric === 'payout' ? 'SUM(c.payout)' : f.metric === 'revenue' ? 'SUM(c.revenue)' : 'COUNT(*)';
    const convFrom = `FROM conversions c
         JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id ${advertiserJoin ? 'JOIN offers o ON o.id = k.offer_id AND o.network_id = k.network_id' : ''}
        WHERE c.status = 'approved' AND c.created_at >= k.created_at AND ${clickWhere.join(' AND ').replace(/cl\./g, 'k.')}`;
    const moneyMetric = f.metric === 'payout' || f.metric === 'revenue' ? f.metric : null;
    const [{ rows: convRows }, curRows] = await Promise.all([query<{ cohort_day: string; day_offset: number; value: string; currencies: string[] | null }>(
      `SELECT date_trunc('day', k.created_at, ${tzRef}) AS cohort_day,
              (floor(EXTRACT(EPOCH FROM (c.created_at - k.created_at)) / 86400)::int + 1) AS day_offset,
              COALESCE(${convCol}, 0)::numeric(14,4) AS value,
              array_agg(DISTINCT c.currency) FILTER (WHERE c.currency IS NOT NULL) AS currencies
         ${convFrom}
        GROUP BY 1, 2 ORDER BY 1, 2`,
      params,
    ),
    // metric=payout|revenue: the same cells' money per currency (NULL currency excluded), so a row's
    // money can be read per currency instead of as one mixed sum.
    moneyMetric
      ? query<{ cohort_day: string; day_offset: number; cur: string; amount: string }>(
        `SELECT date_trunc('day', k.created_at, ${tzRef}) AS cohort_day,
                (floor(EXTRACT(EPOCH FROM (c.created_at - k.created_at)) / 86400)::int + 1) AS day_offset,
                c.currency AS cur, COALESCE(SUM(c.${moneyMetric}), 0)::numeric(14,4)::text AS amount
           ${convFrom} AND c.currency IS NOT NULL
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        params,
      ).then((r) => r.rows)
      : Promise.resolve([] as { cohort_day: string; day_offset: number; cur: string; amount: string }[])]);

    // pg returns `date_trunc(...)` as a JS Date — two separate query results produce two distinct
    // Date instances for the same instant, which are NOT equal as Map keys (reference equality).
    // Normalize to an ISO string key on both sides before using it as a lookup key.
    const dayKey = (d: unknown) => new Date(d as string).getTime();
    const byDay = new Map<number, Map<number, number>>();
    const curByDay = new Map<number, Map<number, string[]>>();
    for (const r of convRows) {
      const key = dayKey(r.cohort_day);
      if (!byDay.has(key)) { byDay.set(key, new Map()); curByDay.set(key, new Map()); }
      byDay.get(key)!.set(r.day_offset, Number(r.value));
      curByDay.get(key)!.set(r.day_offset, r.currencies ?? []);
    }
    const moneyByDay = new Map<number, Map<number, MoneyByCurrency>>();
    for (const r of curRows) {
      const key = dayKey(r.cohort_day);
      if (!moneyByDay.has(key)) moneyByDay.set(key, new Map());
      const cell = moneyByDay.get(key)!;
      cell.set(r.day_offset, { ...(cell.get(r.day_offset) ?? {}), [r.cur]: { [moneyMetric!]: money4(r.amount) } });
    }

    const now = Date.now();
    // One column per calendar day in the range: 2026-10-01T00:00Z → 2026-10-07T23:59:59.999Z is 7
    // days (ceil of the span) — the old `+ 1` showed an 8th column that could never fill in.
    const maxDay = Math.max(1, Math.min(31, Math.ceil((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000)));
    const rows = clickRows.map((r) => {
      const cohortMs = dayKey(r.cohort_day);
      const dayOffsets = byDay.get(cohortMs) ?? new Map<number, number>();
      const days: (number | null)[] = [];
      // Currencies of the approved conversions behind the cells shown (>1 = a payout/revenue row mixes currencies).
      const currencies = new Set<string>();
      // metric=payout|revenue: the shown cells' money per currency ({} for metric=conversions).
      const cellMoney: MoneyByCurrency[] = [];
      for (let n = 1; n <= maxDay; n++) {
        const elapsed = cohortMs + n * 86400000 <= now;
        days.push(elapsed ? (dayOffsets.get(n) ?? 0) : null);
        if (elapsed) for (const c of curByDay.get(cohortMs)?.get(n) ?? []) currencies.add(c);
        const m = moneyByDay.get(cohortMs)?.get(n);
        if (elapsed && m) cellMoney.push(m);
      }
      // The cohort's day as local wall time with its offset in a non-UTC zone ('2026-10-13T00:00:00+05:30').
      const date = zone === 'UTC' ? new Date(cohortMs).toISOString() : formatInZone(new Date(cohortMs), zone);
      return { date, topLevel: f.topLevelMetric === 'unique_clicks' ? r.unique_clicks : r.clicks, days, currencies: [...currencies].sort(), moneyByCurrency: mergeMoneyByCurrency(cellMoney) };
    });

    sendOk(res, {
      maxDay, rows, currencies: Array.from(new Set(rows.flatMap((r) => r.currencies))).sort(),
      moneyByCurrency: mergeMoneyByCurrency(rows.map((r) => r.moneyByCurrency)),
    });
  }));

  // ── Click to Conversion Time report — real distribution of (conversion.created_at -
  // click.created_at) across 7 fixed buckets, grouped by offer (or by publisher when scoped to one
  // offer, for the expand-by-Partner drill-down). Only counts conversions with a resolvable click
  // (INNER JOIN on click_id) — an offline/manual conversion has no click to measure a delta from,
  // so it's honestly excluded rather than bucketed as instant.
  const mttiSchema = z.object({
    ...rangeKeys,
    groupBy: z.enum(['offer', 'publisher']).default('offer'),
    offerId: z.string().uuid().optional(),
    // Conversion status measured; absent = approved (the original behaviour), `all` = every status.
    // No source filter: a manual/offline conversion with a resolvable click is measured like any other.
    status: z.enum(['approved', 'pending', 'rejected', 'all']).optional(),
    ...groupPageKeys,
  }).strict().transform(withZonedRange);
  r.get('/click-to-conversion-time', validateQuery(mttiSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as z.infer<typeof mttiSchema>;
    const where = ['c.network_id = $1'];
    const params: unknown[] = [nid];
    const status = f.status ?? 'approved';
    if (status !== 'all') { params.push(status); where.push(`c.status = $${params.length}`); }
    if (f.from) { params.push(f.from); where.push(`c.created_at >= $${params.length}`); }
    if (f.to) { params.push(f.to); where.push(`c.created_at <= $${params.length}`); }
    // The Offer filter applies in both groupings (it used to be silently ignored when grouped by offer).
    if (f.offerId) { params.push(f.offerId); where.push(`c.offer_id = $${params.length}`); }
    const groupCol = f.groupBy === 'publisher' ? 'c.publisher_id' : 'c.offer_id';

    const n = params.length;
    // `groups` = real group count (window over the grouped rows), so the page reports truncation.
    const { rows: raw } = await query<{
      key: string; b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number; total: number; groups: number;
    }>(
      `WITH deltas AS (
         SELECT ${groupCol} AS grp, EXTRACT(EPOCH FROM (c.created_at - k.created_at)) AS delta
           FROM conversions c
           JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
          WHERE ${where.join(' AND ')}
       )
       SELECT grp AS key,
              COUNT(*) FILTER (WHERE delta <= 15)::int AS b0,
              COUNT(*) FILTER (WHERE delta > 15 AND delta <= 30)::int AS b1,
              COUNT(*) FILTER (WHERE delta > 30 AND delta <= 60)::int AS b2,
              COUNT(*) FILTER (WHERE delta > 60 AND delta <= 120)::int AS b3,
              COUNT(*) FILTER (WHERE delta > 120 AND delta <= 180)::int AS b4,
              COUNT(*) FILTER (WHERE delta > 180 AND delta <= 300)::int AS b5,
              COUNT(*) FILTER (WHERE delta > 300)::int AS b6,
              COUNT(*)::int AS total,
              (COUNT(*) OVER ())::int AS groups
         FROM deltas WHERE grp IS NOT NULL
        GROUP BY 1 ORDER BY total DESC, grp LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, f.limit, f.offset],
    );
    let groups = Number(raw[0]?.groups ?? 0);
    if (raw.length === 0 && f.offset > 0) {
      // Paged past the end — the window has no row to report the count on.
      const c = await query<{ groups: number }>(
        `SELECT COUNT(DISTINCT ${groupCol})::int AS groups FROM conversions c
           JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
          WHERE ${where.join(' AND ')} AND ${groupCol} IS NOT NULL`,
        params,
      );
      groups = Number(c.rows[0]?.groups ?? 0);
    }
    const rows = raw.map(({ groups: _g, ...r }) => r);
    sendOk(res, pagedGroups(rows, groups, f));
  }));

  // ── Funnel report — real per-goal conversion counts for one offer (spec feature-depth: multi-goal
  // offers, `offer_goals` + `conversions.goal_id`, resolved by the tracking surface's postback
  // handler at api-backend/src/surfaces/tracking/conversions/record.ts). Stage order/names come from
  // the caller's own selected goal order — this endpoint just returns real counts per goal_id, plus
  // an optional breakdown by one real click-side dimension (Partner/Country/Device/...).
  const funnelChildDims = ['publisher', 'country', 'device', 'city', 'region', 'isp', 'os', 'browser', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const;
  const FUNNEL_CHILD_COL: Record<(typeof funnelChildDims)[number], string> = {
    publisher: 'k.publisher_id', country: 'k.country', device: 'k.device', city: 'k.city',
    region: 'k.region', isp: 'k.isp', os: 'k.os', browser: 'k.browser',
    sub1: 'k.sub1', sub2: 'k.sub2', sub3: 'k.sub3', sub4: 'k.sub4', sub5: 'k.sub5',
  };
  const funnelSchema = z.object({
    offerId: z.string().uuid(),
    goalIds: z.string().min(1).refine((v) => v.split(',').map((s) => s.trim()).filter(Boolean).every((s) => z.string().uuid().safeParse(s).success), { message: 'must be comma-separated event UUIDs' }),
    from: queryDate, to: queryDate, tz: tzParam.optional(),
    childDim: z.enum(funnelChildDims).optional(),
    publisherId: z.string().uuid().optional(),
    country: z.string().max(3).optional(),
    device: z.string().max(40).optional(),
    sub1: z.string().max(200).optional(), sub2: z.string().max(200).optional(), sub3: z.string().max(200).optional(),
    sub4: z.string().max(200).optional(), sub5: z.string().max(200).optional(),
  }).transform(withZonedRange);
  r.get('/funnel', validateQuery(funnelSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as z.infer<typeof funnelSchema>;
    const goalIds = f.goalIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (goalIds.length < 2) throw badRequest('Select at least 2 Events');

    const params: unknown[] = [nid, f.offerId, goalIds, f.from, f.to];
    const where = ["c.network_id = $1", "c.status = 'approved'", 'c.offer_id = $2', 'c.goal_id = ANY($3::uuid[])', 'c.created_at >= $4', 'c.created_at <= $5'];
    const add = (val: unknown, col: string) => { if (val == null || val === '') return; params.push(val); where.push(`${col} = $${params.length}`); };
    add(f.publisherId, 'k.publisher_id'); add(f.country, 'k.country'); add(f.device, 'k.device');
    add(f.sub1, 'k.sub1'); add(f.sub2, 'k.sub2'); add(f.sub3, 'k.sub3'); add(f.sub4, 'k.sub4'); add(f.sub5, 'k.sub5');

    const childCol = f.childDim ? FUNNEL_CHILD_COL[f.childDim] : null;
    const { rows } = await query<{ goal_id: string; child_key: string | null; conversions: number }>(
      `SELECT c.goal_id, ${childCol ?? 'NULL'} AS child_key, COUNT(*)::int AS conversions
         FROM conversions c JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
        WHERE ${where.join(' AND ')}
        GROUP BY 1, 2`,
      params,
    );

    const stages = goalIds.map((goalId) => ({
      goalId, count: rows.filter((r) => r.goal_id === goalId).reduce((n, r) => n + r.conversions, 0),
    }));
    const breakdown: { key: string; counts: Record<string, number> }[] = [];
    if (childCol) {
      const byKey = new Map<string, Record<string, number>>();
      for (const r of rows) {
        if (r.child_key == null) continue;
        if (!byKey.has(r.child_key)) byKey.set(r.child_key, {});
        byKey.get(r.child_key)![r.goal_id] = (byKey.get(r.child_key)![r.goal_id] ?? 0) + r.conversions;
      }
      for (const [key, counts] of byKey) breakdown.push({ key, counts });
      const firstGoalId = goalIds[0]!;
      breakdown.sort((a, b) => (b.counts[firstGoalId] ?? 0) - (a.counts[firstGoalId] ?? 0));
    }
    sendOk(res, { stages, breakdown });
  }));

  // ── Cap report — offers with caps and their current usage (counted like enforcement — see /pacing;
  // a zero/negative cap is unlimited there, so it reads as NULL and an offer with no positive cap is left out) ──
  r.get('/caps', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT o.id, o.name, o.status, o.currency,
              ${offerCap('daily_conversion_cap')} AS daily_conversion_cap,
              ${offerCap('total_conversion_cap')} AS total_conversion_cap,
              ${offerCap('daily_click_cap')} AS daily_click_cap,
              (SELECT COUNT(*) FROM conversions c WHERE c.network_id = o.network_id AND c.offer_id = o.id AND c.${CAP_COUNTED}
                 AND c.created_at >= ${UTC_TODAY})::int AS conversions_today,
              (SELECT COUNT(*) FROM conversions c WHERE c.network_id = o.network_id AND c.offer_id = o.id AND c.${CAP_COUNTED})::int AS conversions_total,
              (SELECT COUNT(*) FROM clicks cl WHERE cl.network_id = o.network_id AND cl.offer_id = o.id
                 AND cl.created_at >= date_trunc('day', now(), 'UTC'))::int AS clicks_today
         FROM offers o
        WHERE o.network_id = $1
          AND (o.daily_conversion_cap > 0 OR o.total_conversion_cap > 0 OR o.daily_click_cap > 0)
        ORDER BY o.name`,
      [req.scope!.networkId],
    );
    sendOk(res, rows);
  }));
}
