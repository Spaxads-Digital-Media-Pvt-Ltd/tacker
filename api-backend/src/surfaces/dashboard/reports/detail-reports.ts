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

const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  offerId: z.string().uuid().optional(),
  publisherId: z.string().uuid().optional(),
  advertiserId: z.string().uuid().optional(),
  smartLinkId: z.string().uuid().optional(),
  country: z.string().max(3).optional(),
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
  event: z.string().max(100).optional(),
  source: z.enum(['postback', 'pixel', 'iframe', 'manual']).optional(),
  currency: z.string().max(3).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  success: z.enum(['true', 'false']).optional(),
  isUnique: z.enum(['true', 'false']).optional(),
  fraudMin: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
type Filters = z.infer<typeof filterSchema>;

/** One filter → SQL column mapping. `op` defaults to '='; `bool` coerces 'true'/'false'. */
interface FilterSpec { key: keyof Filters; col: string; op?: '=' | '>=' | '<='; bool?: boolean }

/** Assemble a parameterized WHERE from a report's allowed filter specs. */
function buildWhere(networkId: string, f: Filters, specs: FilterSpec[]) {
  const where: string[] = ['network_id = $1'];
  const params: unknown[] = [networkId];
  for (const s of specs) {
    const raw = f[s.key];
    if (raw == null || raw === '') continue;
    const val = s.bool ? raw === 'true' : raw;
    params.push(val);
    where.push(`${s.col} ${s.op ?? '='} $${params.length}`);
  }
  return { where: where.join(' AND '), params };
}

// ── Grouped performance report (Everflow/Spaxads Offer/Affiliate/Advertiser/Daily reports) ──
const groupedSchema = z.object({
  groupBy: z.enum(['offer', 'publisher', 'advertiser', 'day', 'country', 'device']).default('offer'),
  from: z.string().optional(),
  to: z.string().optional(),
  offerIds: z.string().optional(),      // csv of offer UUIDs
  publisherIds: z.string().optional(),
  advertiserIds: z.string().optional(),
  country: z.string().max(3).optional(),
});
type Grouped = z.infer<typeof groupedSchema>;
const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Build the shared filter WHERE for clicks (alias c) / conversions (alias v). Returns fragments + params. */
function groupedFilters(networkId: string, f: Grouped, isClicks: boolean) {
  const a = isClicks ? 'c' : 'v';
  const where: string[] = [`${a}.network_id = $1`];
  const params: unknown[] = [networkId];
  if (!isClicks) where.push(`v.status = 'approved'`);
  const push = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; params.push(val); where.push(`${expr} ${op} $${params.length}`); };
  const pushIn = (vals: string[], expr: string) => { if (vals.length === 0) return; params.push(vals); where.push(`${expr} = ANY($${params.length}::uuid[])`); };
  push(f.from, `${a}.created_at`, '>='); push(f.to, `${a}.created_at`, '<=');
  pushIn(csv(f.offerIds), `${a}.offer_id`);
  pushIn(csv(f.publisherIds), `${a}.publisher_id`);
  if (!isClicks) pushIn(csv(f.advertiserIds), `v.advertiser_id`);
  push(f.country, `${a}.country`);
  return { where: where.join(' AND '), params };
}

export function mountDetailReports(r: Router): void {
  r.get('/grouped', validateQuery(groupedSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as Grouped;

    // Aggregate clicks + conversions keyed by the group dimension, then merge in SQL.
    const dim = (alias: string): string => {
      switch (f.groupBy) {
        case 'offer': return `COALESCE(${alias}.offer_id::text, '~none~')`;
        case 'publisher': return `COALESCE(${alias}.publisher_id::text, '~none~')`;
        case 'advertiser': return alias === 'c' ? `COALESCE(o.advertiser_id::text, '~none~')` : `COALESCE(v.advertiser_id::text, '~none~')`;
        case 'day': return `to_char(date_trunc('day', ${alias}.created_at), 'YYYY-MM-DD')`;
        case 'country': return `COALESCE(${alias}.country, '—')`;
        case 'device': return `COALESCE(${alias}.device, '—')`;
      }
    };
    const clicksJoin = f.groupBy === 'advertiser' ? 'JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id' : '';
    const cf = groupedFilters(nid, f, true);
    const vf = groupedFilters(nid, f, false);
    // conversions params come after clicks params; shift their $ placeholders.
    const shift = cf.params.length; // clicks params occupy $1..$shift ($1 = networkId, shared)
    const vWhere = vf.where.replace(/\$(\d+)/g, (_, n) => { const k = Number(n); return k === 1 ? '$1' : `$${k + shift - 1}`; });
    const vParams = vf.params.slice(1); // drop duplicate networkId
    const params = [...cf.params, ...vParams];

    const sql = `
      WITH cl AS (
        SELECT ${dim('c')} AS k, COUNT(*)::int AS clicks
        FROM clicks c ${clicksJoin} WHERE ${cf.where} GROUP BY 1
      ), cv AS (
        SELECT ${dim('v')} AS k, COUNT(*)::int AS conversions,
               COALESCE(SUM(v.payout),0)::numeric(14,4) AS payout,
               COALESCE(SUM(v.revenue),0)::numeric(14,4) AS revenue
        FROM conversions v WHERE ${vWhere} GROUP BY 1
      )
      SELECT COALESCE(cl.k, cv.k) AS k,
             COALESCE(cl.clicks,0) AS clicks, COALESCE(cv.conversions,0) AS conversions,
             COALESCE(cv.payout,0)::text AS payout, COALESCE(cv.revenue,0)::text AS revenue,
             (COALESCE(cv.revenue,0) - COALESCE(cv.payout,0))::text AS profit
        FROM cl FULL OUTER JOIN cv ON cl.k = cv.k`;
    const { rows } = await query<{ k: string; clicks: number; conversions: number; payout: string; revenue: string; profit: string }>(sql, params);

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

    const out = rows.map((row) => {
      const meta = labels.get(row.k);
      const clicks = row.clicks, conversions = row.conversions;
      return {
        key: row.k,
        id: meta ? meta.ref : null,
        label: meta ? meta.label : (row.k === '~none~' ? '(none)' : row.k),
        currency: meta?.currency ?? 'USD',
        clicks, conversions,
        payout: row.payout, revenue: row.revenue, profit: row.profit,
        cr: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
        epc: clicks > 0 ? Number((Number(row.payout) / clicks).toFixed(4)) : 0,
      };
    }).sort((a, b) => b.clicks - a.clicks);

    const totals = out.reduce((t, r) => ({
      clicks: t.clicks + r.clicks, conversions: t.conversions + r.conversions,
      payout: t.payout + Number(r.payout), revenue: t.revenue + Number(r.revenue), profit: t.profit + Number(r.profit),
    }), { clicks: 0, conversions: 0, payout: 0, revenue: 0, profit: 0 });

    sendOk(res, { rows: out, totals });
  }));

  // ── 24h KPI summary for the admin dashboard tiles ──
  r.get('/summary', asyncHandler(async (req, res) => {
    sendOk(res, await summary24h(req.scope!.networkId, 'admin'));
  }));

  // ── Full "Today's Stats" dashboard: per-period totals + today's hourly series (Everflow-style) ──
  r.get('/dashboard', asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    // Period buckets via FILTER (one scan each over the current+previous month window).
    const P = (col: string) => `
      COALESCE(${col} FILTER (WHERE created_at >= date_trunc('day', now())),0) AS today,
      COALESCE(${col} FILTER (WHERE created_at >= date_trunc('day', now()) - interval '1 day' AND created_at < date_trunc('day', now())),0) AS yesterday,
      COALESCE(${col} FILTER (WHERE created_at >= date_trunc('month', now())),0) AS month,
      COALESCE(${col} FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now())),0) AS last_month`;
    const since = `created_at >= date_trunc('month', now()) - interval '1 month'`;

    const [clk, cv, ser] = await Promise.all([
      query<Record<string, string>>(`SELECT ${P('COUNT(*)')} FROM clicks WHERE network_id = $1 AND ${since}`, [nid]),
      query<Record<string, string>>(
        `SELECT ${P('COUNT(*)')},
                ${P('SUM(payout)').replace(/AS (\w+)/g, 'AS p_$1')},
                ${P('SUM(revenue)').replace(/AS (\w+)/g, 'AS r_$1')}
           FROM conversions WHERE network_id = $1 AND status = 'approved' AND ${since}`, [nid]),
      query<{ h: number; clicks: number; conversions: number; revenue: string; payout: string }>(
        `SELECT date_part('hour', h.created_at)::int AS h,
                COUNT(*) FILTER (WHERE src = 'click')::int AS clicks,
                COUNT(*) FILTER (WHERE src = 'conv')::int AS conversions,
                COALESCE(SUM(revenue),0)::text AS revenue,
                COALESCE(SUM(payout),0)::text AS payout
           FROM (
             SELECT created_at, 'click' AS src, 0::numeric revenue, 0::numeric payout FROM clicks
              WHERE network_id = $1 AND created_at >= date_trunc('day', now())
             UNION ALL
             SELECT created_at, 'conv' AS src, revenue, payout FROM conversions
              WHERE network_id = $1 AND status = 'approved' AND created_at >= date_trunc('day', now())
           ) h GROUP BY 1`, [nid]),
    ]);

    const c = clk.rows[0]!; const v = cv.rows[0]!;
    const periods = (o: Record<string, string>, pfx = '') => ({
      today: Number(o[`${pfx}today`] ?? 0), yesterday: Number(o[`${pfx}yesterday`] ?? 0),
      month: Number(o[`${pfx}month`] ?? 0), lastMonth: Number(o[`${pfx}last_month`] ?? 0),
    });
    const clicks = periods(c);
    const conversions = periods(v);
    const payout = periods(v, 'p_');
    const revenue = periods(v, 'r_');
    const money = (n: number) => n.toFixed(4);
    const mk = (fn: (k: 'today' | 'yesterday' | 'month' | 'lastMonth') => number) =>
      ({ today: fn('today'), yesterday: fn('yesterday'), month: fn('month'), lastMonth: fn('lastMonth') });
    const margin = mk((k) => revenue[k] - payout[k]);
    const cr = mk((k) => (clicks[k] > 0 ? Number(((conversions[k] / clicks[k]) * 100).toFixed(2)) : 0));

    const arr = (pick: (row: typeof ser.rows[number]) => number) => {
      const a = Array<number>(24).fill(0);
      for (const row of ser.rows) a[row.h] = pick(row);
      return a;
    };
    sendOk(res, {
      clicks, conversions,
      revenue: { today: money(revenue.today), yesterday: money(revenue.yesterday), month: money(revenue.month), lastMonth: money(revenue.lastMonth) },
      payout: { today: money(payout.today), yesterday: money(payout.yesterday), month: money(payout.month), lastMonth: money(payout.lastMonth) },
      margin: { today: money(margin.today), yesterday: money(margin.yesterday), month: money(margin.month), lastMonth: money(margin.lastMonth) },
      cr,
      series: {
        clicks: arr((r) => r.clicks),
        conversions: arr((r) => r.conversions),
        revenue: arr((r) => Number(r.revenue)),
        payout: arr((r) => Number(r.payout)),
      },
    });
  }));

  // ── Clicks report — row-level click log (IP, geo, device, subs, fraud) ──
  r.get('/clicks', validateQuery(filterSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as Filters;
    const { where, params } = buildWhere(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'offerId', col: 'offer_id' }, { key: 'publisherId', col: 'publisher_id' },
      { key: 'smartLinkId', col: 'smart_link_id' },
      { key: 'country', col: 'country' }, { key: 'region', col: 'region' }, { key: 'city', col: 'city' },
      { key: 'device', col: 'device' }, { key: 'os', col: 'os' }, { key: 'browser', col: 'browser' },
      { key: 'sub1', col: 'sub1' }, { key: 'sub2', col: 'sub2' }, { key: 'sub3', col: 'sub3' },
      { key: 'sub4', col: 'sub4' }, { key: 'sub5', col: 'sub5' },
      { key: 'isUnique', col: 'is_unique', bool: true }, { key: 'fraudMin', col: 'fraud_score', op: '>=' },
    ]);
    params.push(f.limit, f.offset);
    const { rows } = await query(
      `SELECT click_id, created_at, offer_id, publisher_id, ip::text AS ip, country, region, city, isp,
              device, os, browser, is_unique, fraud_score, fraud_flags, sub1, sub2, sub3, sub4, sub5
         FROM clicks WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ── Conversions report — row-level conversion log ──
  r.get('/conversions', validateQuery(filterSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as Filters;
    const { where, params } = buildWhere(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'offerId', col: 'offer_id' }, { key: 'publisherId', col: 'publisher_id' },
      { key: 'advertiserId', col: 'advertiser_id' }, { key: 'status', col: 'status' },
      { key: 'event', col: 'event_name' }, { key: 'source', col: 'source' }, { key: 'currency', col: 'currency' },
    ]);
    params.push(f.limit, f.offset);
    const { rows } = await query(
      `SELECT conversion_id, created_at, click_id, offer_id, publisher_id, advertiser_id, event_name,
              goal_id, status, reason, payout, revenue, currency, transaction_id, source, fraud_score
         FROM conversions WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ── Postback logs report — outbound delivery attempts ──
  r.get('/postback-logs', validateQuery(filterSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as Filters;
    const { where, params } = buildWhere(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'publisherId', col: 'publisher_id' }, { key: 'success', col: 'success', bool: true },
    ]);
    params.push(f.limit, f.offset);
    const { rows } = await query(
      `SELECT id, created_at, conversion_id, publisher_id, url, attempt, status_code, success, error
         FROM postback_logs WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ── Goals report — approved conversions aggregated per offer goal ──
  r.get('/goals', validateQuery(filterSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as Filters;
    const params: unknown[] = [req.scope!.networkId];
    const where = ["c.network_id = $1", "c.status = 'approved'"];
    const push = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; params.push(val); where.push(`${expr} ${op} $${params.length}`); };
    push(f.from, 'c.created_at', '>='); push(f.to, 'c.created_at', '<='); push(f.offerId, 'c.offer_id');
    const { rows } = await query(
      `SELECT COALESCE(og.name, c.event_name, '(default)') AS goal,
              c.offer_id,
              COUNT(*)::int AS conversions,
              COALESCE(SUM(c.payout),0)::numeric(14,4) AS payout,
              COALESCE(SUM(c.revenue),0)::numeric(14,4) AS revenue,
              (COALESCE(SUM(c.revenue),0) - COALESCE(SUM(c.payout),0))::numeric(14,4) AS margin
         FROM conversions c
         LEFT JOIN offer_goals og ON og.id = c.goal_id AND og.network_id = c.network_id
        WHERE ${where.join(' AND ')}
        GROUP BY 1, 2 ORDER BY conversions DESC LIMIT 500`,
      params,
    );
    sendOk(res, rows);
  }));

  // ── Smart Link report — clicks & conversions attributed to each smart link ──
  r.get('/smart-links', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT sl.id, sl.name, sl.status,
              (SELECT COUNT(*) FROM clicks c WHERE c.smart_link_id = sl.id)::int AS clicks,
              (SELECT COUNT(*) FROM conversions cv WHERE cv.click_id IN
                 (SELECT click_id FROM clicks c2 WHERE c2.smart_link_id = sl.id) AND cv.status = 'approved')::int AS conversions
         FROM smart_links sl
        WHERE sl.network_id = $1
        ORDER BY sl.created_at DESC`,
      [req.scope!.networkId],
    );
    sendOk(res, rows);
  }));

  // ── Cap report — offers with caps and their current usage ──
  r.get('/caps', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT o.id, o.name, o.status, o.currency,
              o.daily_conversion_cap, o.total_conversion_cap, o.daily_click_cap,
              (SELECT COUNT(*) FROM conversions c WHERE c.offer_id = o.id AND c.status = 'approved'
                 AND c.created_at >= date_trunc('day', now()))::int AS conversions_today,
              (SELECT COUNT(*) FROM conversions c WHERE c.offer_id = o.id AND c.status = 'approved')::int AS conversions_total,
              (SELECT COUNT(*) FROM clicks cl WHERE cl.offer_id = o.id
                 AND cl.created_at >= date_trunc('day', now()))::int AS clicks_today
         FROM offers o
        WHERE o.network_id = $1
          AND (o.daily_conversion_cap IS NOT NULL OR o.total_conversion_cap IS NOT NULL OR o.daily_click_cap IS NOT NULL)
        ORDER BY o.name`,
      [req.scope!.networkId],
    );
    sendOk(res, rows);
  }));
}
