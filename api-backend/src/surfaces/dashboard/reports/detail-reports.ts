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
      `SELECT click_id, created_at, offer_id, publisher_id, smart_link_id, ip::text AS ip, country, region, city, isp,
              device, os, browser, is_unique, fraud_score, fraud_flags, sub1, sub2, sub3, sub4, sub5,
              EXISTS(SELECT 1 FROM conversions cv WHERE cv.click_id = clicks.click_id AND cv.network_id = clicks.network_id) AS converted
         FROM clicks WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ── Conversions report — row-level conversion log, incl. click-time context (geo/device/subs)
  // for the originating click via a LEFT JOIN on click_id. Filtering runs on the `conversions`-only
  // subquery first (avoids column-name ambiguity with `clicks` on the outer join) before joining.
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
      `SELECT v.conversion_id, v.created_at, v.click_id, v.offer_id, v.publisher_id, v.advertiser_id,
              v.event_name, v.goal_id, og.name AS goal_name, v.status, v.reason, v.payout, v.revenue,
              v.currency, v.transaction_id, v.source, v.fraud_score, v.raw_params,
              k.created_at AS click_created_at, k.country, k.region, k.city, k.isp,
              k.device, k.os, k.browser, k.sub1, k.sub2, k.sub3, k.sub4, k.sub5,
              EXTRACT(EPOCH FROM (v.created_at - k.created_at))::int AS delta_seconds
         FROM (SELECT * FROM conversions WHERE ${where}) v
         LEFT JOIN clicks k ON k.click_id = v.click_id AND k.network_id = v.network_id
         LEFT JOIN offer_goals og ON og.id = v.goal_id AND og.network_id = v.network_id
        ORDER BY v.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ── Postback logs report — outbound delivery attempts ──
  // Partner Postback report — real delivery log, extended with a LEFT JOIN to the conversion it fired
  // for (via conversion_id) so Offer/Event Name/Advertiser can be shown honestly rather than omitted.
  r.get('/postback-logs', validateQuery(filterSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as Filters;
    const { where, params } = buildWhere(req.scope!.networkId, f, [
      { key: 'from', col: 'created_at', op: '>=' }, { key: 'to', col: 'created_at', op: '<=' },
      { key: 'publisherId', col: 'publisher_id' }, { key: 'success', col: 'success', bool: true },
    ]);
    let offerJoinFilter = '';
    if (f.offerId) { params.push(f.offerId); offerJoinFilter = ` AND c.offer_id = $${params.length}`; }
    params.push(f.limit, f.offset);
    const { rows } = await query(
      `SELECT p.id, p.created_at, p.conversion_id, p.publisher_id, p.url, p.attempt, p.status_code, p.success, p.error,
              c.offer_id, c.event_name
         FROM (SELECT * FROM postback_logs WHERE ${where}) p
         LEFT JOIN conversions c ON c.conversion_id = p.conversion_id AND c.network_id = p.network_id
        WHERE 1=1${offerJoinFilter}
        ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ── Goals/Event report — approved conversions aggregated per offer goal, plus each offer's real
  // click count (clicks aren't tied to a specific goal, so it's queried per-offer and merged in) —
  // together these back CVR (Total (from Clicks) / Clicks) on the Event Report.
  r.get('/goals', validateQuery(filterSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as Filters;
    const params: unknown[] = [req.scope!.networkId];
    const where = ["c.network_id = $1", "c.status = 'approved'"];
    const push = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; params.push(val); where.push(`${expr} ${op} $${params.length}`); };
    push(f.from, 'c.created_at', '>='); push(f.to, 'c.created_at', '<='); push(f.offerId, 'c.offer_id');
    const clickParams: unknown[] = [req.scope!.networkId];
    const clickWhere = ['network_id = $1'];
    const pushClick = (val: unknown, expr: string, op = '=') => { if (val == null || val === '') return; clickParams.push(val); clickWhere.push(`${expr} ${op} $${clickParams.length}`); };
    pushClick(f.from, 'created_at', '>='); pushClick(f.to, 'created_at', '<='); pushClick(f.offerId, 'offer_id');

    const [goalRes, clickRes] = await Promise.all([
      query<{ goal: string; offer_id: string; conversions: number; payout: string; revenue: string; margin: string }>(
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
      ),
      query<{ offer_id: string; clicks: number }>(
        `SELECT offer_id, COUNT(*)::int AS clicks FROM clicks WHERE ${clickWhere.join(' AND ')} GROUP BY 1`,
        clickParams,
      ),
    ]);
    const clicksByOffer = new Map(clickRes.rows.map((r) => [r.offer_id, r.clicks]));
    const rows = goalRes.rows.map((r) => {
      const clicks = clicksByOffer.get(r.offer_id) ?? 0;
      return {
        ...r,
        clicks,
        cvr: clicks > 0 ? Number(((r.conversions / clicks) * 100).toFixed(2)) : 0,
        marginPct: Number(r.revenue) > 0 ? Number(((Number(r.margin) / Number(r.revenue)) * 100).toFixed(2)) : 0,
      };
    });
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

  // ── Pacing report — real cap fulfillment across the three cap surfaces this app actually has:
  // offer-level daily/total conversion caps, offer-level daily click caps, and offer-group daily
  // payout/revenue caps (spec has no weekly/monthly cap concept, so those reference periods are
  // omitted rather than faked). Summary is a network-wide snapshot (today + all-time); Detail is a
  // real per-day, per-entity breakdown for the requested date range and category.
  const pacingSchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    category: z.enum(['click', 'conversion', 'payout', 'revenue']).default('conversion'),
  });
  r.get('/pacing', validateQuery(pacingSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as z.infer<typeof pacingSchema>;

    const [clickCap, convCap, groupCap] = await Promise.all([
      query<{ id: string; name: string; daily_click_cap: number; clicks_today: number }>(
        `SELECT o.id, o.name, o.daily_click_cap,
                (SELECT COUNT(*) FROM clicks cl WHERE cl.offer_id = o.id AND cl.created_at >= date_trunc('day', now()))::int AS clicks_today
           FROM offers o WHERE o.network_id = $1 AND o.daily_click_cap IS NOT NULL`,
        [nid],
      ),
      query<{ id: string; name: string; daily_conversion_cap: number | null; total_conversion_cap: number | null; conversions_today: number; conversions_total: number }>(
        `SELECT o.id, o.name, o.daily_conversion_cap, o.total_conversion_cap,
                (SELECT COUNT(*) FROM conversions c WHERE c.offer_id = o.id AND c.status = 'approved' AND c.created_at >= date_trunc('day', now()))::int AS conversions_today,
                (SELECT COUNT(*) FROM conversions c WHERE c.offer_id = o.id AND c.status = 'approved')::int AS conversions_total
           FROM offers o WHERE o.network_id = $1 AND (o.daily_conversion_cap IS NOT NULL OR o.total_conversion_cap IS NOT NULL)`,
        [nid],
      ),
      query<{ id: string; name: string; daily_payout_cap: string | null; daily_revenue_cap: string | null; payout_today: string; revenue_today: string }>(
        `SELECT og.id, og.name, og.caps->'payout'->>'daily' AS daily_payout_cap, og.caps->'revenue'->>'daily' AS daily_revenue_cap,
                COALESCE((SELECT SUM(c.payout) FROM conversions c WHERE c.network_id = og.network_id AND c.status = 'approved'
                   AND c.created_at >= date_trunc('day', now()) AND og.offer_ids ? c.offer_id::text), 0)::numeric(14,4) AS payout_today,
                COALESCE((SELECT SUM(c.revenue) FROM conversions c WHERE c.network_id = og.network_id AND c.status = 'approved'
                   AND c.created_at >= date_trunc('day', now()) AND og.offer_ids ? c.offer_id::text), 0)::numeric(14,4) AS revenue_today
           FROM offer_groups og WHERE og.network_id = $1 AND og.caps_enabled
             AND (og.caps->'payout'->>'daily' IS NOT NULL OR og.caps->'revenue'->>'daily' IS NOT NULL)`,
        [nid],
      ),
    ]);

    const sumRatio = (used: number, cap: number) => (cap > 0 ? Number(((used / cap) * 100).toFixed(2)) : 0);
    const summary = [
      { category: 'click', dailyUsedPct: clickCap.rows.length ? sumRatio(clickCap.rows.reduce((s, r) => s + r.clicks_today, 0), clickCap.rows.reduce((s, r) => s + r.daily_click_cap, 0)) : null, globalUsedPct: null },
      { category: 'conversion',
        dailyUsedPct: convCap.rows.some((r) => r.daily_conversion_cap != null)
          ? sumRatio(convCap.rows.filter((r) => r.daily_conversion_cap != null).reduce((s, r) => s + r.conversions_today, 0), convCap.rows.filter((r) => r.daily_conversion_cap != null).reduce((s, r) => s + (r.daily_conversion_cap ?? 0), 0)) : null,
        globalUsedPct: convCap.rows.some((r) => r.total_conversion_cap != null)
          ? sumRatio(convCap.rows.filter((r) => r.total_conversion_cap != null).reduce((s, r) => s + r.conversions_total, 0), convCap.rows.filter((r) => r.total_conversion_cap != null).reduce((s, r) => s + (r.total_conversion_cap ?? 0), 0)) : null },
      { category: 'payout', dailyUsedPct: groupCap.rows.some((r) => r.daily_payout_cap != null)
          ? sumRatio(groupCap.rows.filter((r) => r.daily_payout_cap != null).reduce((s, r) => s + Number(r.payout_today), 0), groupCap.rows.filter((r) => r.daily_payout_cap != null).reduce((s, r) => s + Number(r.daily_payout_cap ?? 0), 0)) : null, globalUsedPct: null },
      { category: 'revenue', dailyUsedPct: groupCap.rows.some((r) => r.daily_revenue_cap != null)
          ? sumRatio(groupCap.rows.filter((r) => r.daily_revenue_cap != null).reduce((s, r) => s + Number(r.revenue_today), 0), groupCap.rows.filter((r) => r.daily_revenue_cap != null).reduce((s, r) => s + Number(r.daily_revenue_cap ?? 0), 0)) : null, globalUsedPct: null },
    ];

    const dateWhereFor = (alias: string) => {
      const where: string[] = ['1=1'];
      const params: unknown[] = [nid];
      if (f.from) { params.push(f.from); where.push(`${alias}.created_at >= $${params.length}`); }
      if (f.to) { params.push(f.to); where.push(`${alias}.created_at <= $${params.length}`); }
      return { where: where.join(' AND '), params };
    };

    let detailRows: { date: string; entity: string; entityId: string; cap: number; actual: number; usedPct: number }[] = [];
    if (f.category === 'click') {
      const { where, params } = dateWhereFor('cl');
      const { rows } = await query<{ day: string; offer_id: string; actual: number }>(
        `SELECT date_trunc('day', cl.created_at) AS day, cl.offer_id, COUNT(*)::int AS actual
           FROM clicks cl JOIN offers o ON o.id = cl.offer_id AND o.network_id = cl.network_id
          WHERE cl.network_id = $1 AND o.daily_click_cap IS NOT NULL AND ${where}
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
        `SELECT date_trunc('day', c.created_at) AS day, c.offer_id, COUNT(*)::int AS actual
           FROM conversions c JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
          WHERE c.network_id = $1 AND c.status = 'approved' AND o.daily_conversion_cap IS NOT NULL AND ${where}
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
      const { rows } = await query<{ day: string; group_id: string; group_name: string; cap: string | null; actual: string }>(
        `SELECT date_trunc('day', c.created_at) AS day, og.id AS group_id, og.name AS group_name, og.caps->'${col}'->>'daily' AS cap,
                COALESCE(SUM(c.${col}),0)::numeric(14,4) AS actual
           FROM conversions c
           JOIN offer_groups og ON og.network_id = c.network_id AND og.offer_ids ? c.offer_id::text
             AND og.caps_enabled AND og.caps->'${col}'->>'daily' IS NOT NULL
          WHERE c.network_id = $1 AND c.status = 'approved' AND ${where}
          GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC`,
        params,
      );
      detailRows = rows.map((r) => ({ date: r.day, entity: r.group_name, entityId: r.group_id, cap: Number(r.cap ?? 0), actual: Number(r.actual), usedPct: sumRatio(Number(r.actual), Number(r.cap ?? 0)) }));
    }

    sendOk(res, { summary, category: f.category, rows: detailRows });
  }));

  // ── Cohort report — real per-day-of-click "aging" breakdown: for each cohort day (the day a click
  // happened), how many of a chosen conversion-side metric landed exactly N calendar days later.
  // Verified against the live reference: cells are NOT cumulative (Day 2 can be 0 while Day 1 is
  // nonzero) and a cell renders as "—" (not 0) when day N hasn't happened yet relative to today —
  // e.g., a cohort from yesterday can only ever show a real Day 1 value so far.
  const cohortSchema = z.object({
    from: z.string(),
    to: z.string(),
    topLevelMetric: z.enum(['clicks', 'unique_clicks']).default('clicks'),
    metric: z.enum(['conversions', 'payout', 'revenue']).default('conversions'),
    offerId: z.string().uuid().optional(),
    publisherId: z.string().uuid().optional(),
    advertiserId: z.string().uuid().optional(),
    smartLinkId: z.string().uuid().optional(),
    country: z.string().max(3).optional(),
    device: z.string().max(30).optional(),
  });
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

    const { rows: clickRows } = await query<{ cohort_day: string; clicks: number; unique_clicks: number }>(
      `SELECT date_trunc('day', cl.created_at) AS cohort_day, COUNT(*)::int AS clicks,
              COUNT(*) FILTER (WHERE cl.is_unique)::int AS unique_clicks
         FROM clicks cl ${advertiserJoin}
        WHERE ${clickWhere.join(' AND ')}
        GROUP BY 1 ORDER BY 1`,
      params,
    );

    const convCol = f.metric === 'payout' ? 'SUM(c.payout)' : f.metric === 'revenue' ? 'SUM(c.revenue)' : 'COUNT(*)';
    const { rows: convRows } = await query<{ cohort_day: string; day_offset: number; value: string }>(
      `SELECT date_trunc('day', k.created_at) AS cohort_day,
              (floor(EXTRACT(EPOCH FROM (c.created_at - k.created_at)) / 86400)::int + 1) AS day_offset,
              COALESCE(${convCol}, 0)::numeric(14,4) AS value
         FROM conversions c
         JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id ${advertiserJoin ? 'JOIN offers o ON o.id = k.offer_id AND o.network_id = k.network_id' : ''}
        WHERE c.status = 'approved' AND c.created_at >= k.created_at AND ${clickWhere.join(' AND ').replace(/cl\./g, 'k.')}
        GROUP BY 1, 2 ORDER BY 1, 2`,
      params,
    );

    // pg returns `date_trunc(...)` as a JS Date — two separate query results produce two distinct
    // Date instances for the same instant, which are NOT equal as Map keys (reference equality).
    // Normalize to an ISO string key on both sides before using it as a lookup key.
    const dayKey = (d: unknown) => new Date(d as string).getTime();
    const byDay = new Map<number, Map<number, number>>();
    for (const r of convRows) {
      const key = dayKey(r.cohort_day);
      if (!byDay.has(key)) byDay.set(key, new Map());
      byDay.get(key)!.set(r.day_offset, Number(r.value));
    }

    const now = Date.now();
    const maxDay = Math.max(1, Math.min(31, Math.ceil((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000) + 1));
    const rows = clickRows.map((r) => {
      const cohortMs = dayKey(r.cohort_day);
      const dayOffsets = byDay.get(cohortMs) ?? new Map<number, number>();
      const days: (number | null)[] = [];
      for (let n = 1; n <= maxDay; n++) {
        const elapsed = cohortMs + n * 86400000 <= now;
        days.push(elapsed ? (dayOffsets.get(n) ?? 0) : null);
      }
      return { date: new Date(cohortMs).toISOString(), topLevel: f.topLevelMetric === 'unique_clicks' ? r.unique_clicks : r.clicks, days };
    });

    sendOk(res, { maxDay, rows });
  }));

  // ── Click to Conversion Time report — real distribution of (conversion.created_at -
  // click.created_at) across 7 fixed buckets, grouped by offer (or by publisher when scoped to one
  // offer, for the expand-by-Partner drill-down). Only counts conversions with a resolvable click
  // (INNER JOIN on click_id) — an offline/manual conversion has no click to measure a delta from,
  // so it's honestly excluded rather than bucketed as instant.
  const mttiSchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    groupBy: z.enum(['offer', 'publisher']).default('offer'),
    offerId: z.string().uuid().optional(),
  });
  r.get('/click-to-conversion-time', validateQuery(mttiSchema), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const f = res.locals.query as z.infer<typeof mttiSchema>;
    const where = ['c.network_id = $1', "c.status = 'approved'"];
    const params: unknown[] = [nid];
    if (f.from) { params.push(f.from); where.push(`c.created_at >= $${params.length}`); }
    if (f.to) { params.push(f.to); where.push(`c.created_at <= $${params.length}`); }
    if (f.groupBy === 'publisher' && f.offerId) { params.push(f.offerId); where.push(`c.offer_id = $${params.length}`); }
    const groupCol = f.groupBy === 'publisher' ? 'c.publisher_id' : 'c.offer_id';

    const { rows } = await query<{
      key: string; b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number; total: number;
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
              COUNT(*)::int AS total
         FROM deltas WHERE grp IS NOT NULL
        GROUP BY 1 ORDER BY total DESC LIMIT 500`,
      params,
    );
    sendOk(res, rows);
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
    goalIds: z.string().min(1),
    from: z.string(), to: z.string(),
    childDim: z.enum(funnelChildDims).optional(),
    publisherId: z.string().uuid().optional(),
    country: z.string().max(3).optional(),
    device: z.string().max(40).optional(),
    sub1: z.string().max(200).optional(), sub2: z.string().max(200).optional(), sub3: z.string().max(200).optional(),
    sub4: z.string().max(200).optional(), sub5: z.string().max(200).optional(),
  });
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
