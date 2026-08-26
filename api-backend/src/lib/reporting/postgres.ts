/**
 * Postgres reporting provider (spec §9). Builds a safe, parameterized aggregation over clicks +
 * conversions with whitelisted dimensions. Clicks and conversions are each aggregated in a CTE and
 * FULL-OUTER-JOINed on the group key, so a group with clicks-but-no-conversions (or vice-versa)
 * still appears. All grouping/aggregation is in SQL — never row-by-row in Node (spec §3B).
 *
 * Dimension/metric names come ONLY from the whitelists below; all VALUES are parameterized.
 */
import { query } from '../db/pool.js';
import type { Dimension, Metric, ReportRequest, ReportResult, ReportRow, ReportingProvider } from './types.js';

const DIM_SQL: Record<Dimension, { click: string; conv: string; clickNeedsOffers?: boolean }> = {
  offer: { click: 'clicks.offer_id', conv: 'c.offer_id' },
  publisher: { click: 'clicks.publisher_id', conv: 'c.publisher_id' },
  advertiser: { click: 'o.advertiser_id', conv: 'c.advertiser_id', clickNeedsOffers: true },
  smartLink: { click: 'clicks.smart_link_id', conv: 'k.smart_link_id' },
  country: { click: 'clicks.country', conv: 'k.country' },
  device: { click: 'clicks.device', conv: 'k.device' },
  city: { click: 'clicks.city', conv: 'k.city' },
  region: { click: 'clicks.region', conv: 'k.region' },
  isp: { click: 'clicks.isp', conv: 'k.isp' },
  browser: { click: 'clicks.browser', conv: 'k.browser' },
  os: { click: 'clicks.os', conv: 'k.os' },
  day: { click: "date_trunc('day', clicks.created_at)", conv: "date_trunc('day', c.created_at)" },
  hour: { click: "date_trunc('hour', clicks.created_at)", conv: "date_trunc('hour', c.created_at)" },
  sub1: { click: 'clicks.sub1', conv: 'k.sub1' },
  sub2: { click: 'clicks.sub2', conv: 'k.sub2' },
  sub3: { click: 'clicks.sub3', conv: 'k.sub3' },
  sub4: { click: 'clicks.sub4', conv: 'k.sub4' },
  sub5: { click: 'clicks.sub5', conv: 'k.sub5' },
};

// Metrics usable in ORDER BY map to a concrete output column (cr/epc order by clicks).
const ORDER_COL: Record<Metric, string> = {
  clicks: 'clicks', unique_clicks: 'unique_clicks', conversions: 'conversions',
  payout: 'payout', revenue: 'revenue', margin: 'margin', cr: 'clicks', epc: 'clicks',
  invalid_clicks: 'invalid_clicks', total_conversions: 'total_conversions', avg_fraud_score: 'avg_fraud_score',
};

export class PostgresReportingProvider implements ReportingProvider {
  async runReport(req: ReportRequest): Promise<ReportResult> {
    const gb = req.groupBy;
    const params: unknown[] = [req.networkId];
    const clickWhere = ['clicks.network_id = $1'];
    // Status is applied per-metric via FILTER below (not a hard WHERE) so both "total_conversions"
    // (all statuses) and "conversions"/payout/revenue (approved-only, the financially-realized ones)
    // can be computed from the same aggregated group.
    const convWhere = ['c.network_id = $1'];

    // Every include filter accepts one value (`= $n`) or an array (an IN-list, via
    // `::text = ANY($n::text[])` — text-cast so it works uniformly whether the underlying column is
    // uuid or text). The Dimensional Report's multi-select "click row(s) to filter" needs this; every
    // other caller still just passes a single value.
    const add = (value: unknown, clickExpr: string, convExpr: string, op: '=' | '<>' | '>=' | '<=' = '='): void => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) {
        if (value.length === 0) return;
        params.push(value);
        const p = `$${params.length}`;
        const cmp = op === '=' ? `= ANY(${p}::text[])` : `!= ALL(${p}::text[])`;
        clickWhere.push(`${clickExpr}::text ${cmp}`);
        convWhere.push(`${convExpr}::text ${cmp}`);
        return;
      }
      params.push(value);
      const p = `$${params.length}`;
      clickWhere.push(`${clickExpr} ${op} ${p}`);
      convWhere.push(`${convExpr} ${op} ${p}`);
    };
    const f = req.filters;
    add(f.from, 'clicks.created_at', 'c.created_at', '>=');
    add(f.to, 'clicks.created_at', 'c.created_at', '<=');
    add(f.offerId, 'clicks.offer_id', 'c.offer_id');
    add(f.publisherId, 'clicks.publisher_id', 'c.publisher_id');
    add(f.advertiserId, 'o.advertiser_id', 'c.advertiser_id');
    add(f.smartLinkId, 'clicks.smart_link_id', 'k.smart_link_id');
    add(f.country, 'clicks.country', 'k.country');
    add(f.device, 'clicks.device', 'k.device');
    add(f.city, 'clicks.city', 'k.city');
    add(f.region, 'clicks.region', 'k.region');
    add(f.isp, 'clicks.isp', 'k.isp');
    add(f.browser, 'clicks.browser', 'k.browser');
    add(f.os, 'clicks.os', 'k.os');
    add(f.sub1, 'clicks.sub1', 'k.sub1');
    add(f.sub2, 'clicks.sub2', 'k.sub2');
    add(f.sub3, 'clicks.sub3', 'k.sub3');
    add(f.sub4, 'clicks.sub4', 'k.sub4');
    add(f.sub5, 'clicks.sub5', 'k.sub5');
    // "Exclusions" (Everflow's own term) — same dimensions, inverted with <>.
    add(f.excludeOfferId, 'clicks.offer_id', 'c.offer_id', '<>');
    add(f.excludePublisherId, 'clicks.publisher_id', 'c.publisher_id', '<>');
    add(f.excludeAdvertiserId, 'o.advertiser_id', 'c.advertiser_id', '<>');
    add(f.excludeSmartLinkId, 'clicks.smart_link_id', 'k.smart_link_id', '<>');
    add(f.excludeCountry, 'clicks.country', 'k.country', '<>');
    add(f.excludeDevice, 'clicks.device', 'k.device', '<>');
    // "Others › Ignore Fail Traffic" — drop fraud-flagged clicks from click-side metrics entirely.
    if (f.excludeInvalid) clickWhere.push('array_length(clicks.fraud_flags, 1) IS NULL');

    const needsOffers = gb.includes('advertiser') || f.advertiserId != null || f.excludeAdvertiserId != null;
    const groupIdx = gb.map((_, i) => `d${i}`).join(', ');

    const clicksCte =
      `SELECT ${gb.map((d, i) => `${DIM_SQL[d].click} AS d${i}`).join(', ')}${gb.length ? ',' : ''}
              COUNT(*) AS clicks, COUNT(*) FILTER (WHERE clicks.is_unique) AS unique_clicks,
              COUNT(*) FILTER (WHERE array_length(clicks.fraud_flags, 1) > 0) AS invalid_clicks,
              COALESCE(AVG(clicks.fraud_score), 0) AS avg_fraud_score
         FROM clicks ${needsOffers ? 'LEFT JOIN offers o ON o.id = clicks.offer_id AND o.network_id = clicks.network_id' : ''}
        WHERE ${clickWhere.join(' AND ')}
        ${gb.length ? `GROUP BY ${groupIdx}` : ''}`;

    const convCte =
      `SELECT ${gb.map((d, i) => `${DIM_SQL[d].conv} AS d${i}`).join(', ')}${gb.length ? ',' : ''}
              COUNT(*) AS total_conversions,
              COUNT(*) FILTER (WHERE c.status = 'approved') AS conversions,
              COALESCE(SUM(c.payout) FILTER (WHERE c.status = 'approved'), 0) AS payout,
              COALESCE(SUM(c.revenue) FILTER (WHERE c.status = 'approved'), 0) AS revenue
         FROM conversions c LEFT JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
        WHERE ${convWhere.join(' AND ')}
        ${gb.length ? `GROUP BY ${groupIdx}` : ''}`;

    // FULL JOIN needs a hash/merge-joinable condition — Postgres rejects IS NOT DISTINCT FROM. Use
    // text-coalesced equality (NULL → sentinel) so null-dimension groups line up. Grand total
    // (no group by) → CROSS JOIN of the two single-row CTEs.
    const joinType = gb.length ? 'FULL OUTER JOIN' : 'CROSS JOIN';
    const onClause = gb.length
      ? 'ON ' + gb.map((_, i) => `COALESCE(cl.d${i}::text, '~NULL~') = COALESCE(cv.d${i}::text, '~NULL~')`).join(' AND ')
      : '';
    const dimSelect = gb.map((_, i) => `COALESCE(cl.d${i}, cv.d${i}) AS d${i}`).join(', ');
    // A day/hour-only report reads naturally in chronological order — default to that (the group's
    // own dimension column) rather than clicks-desc when the caller hasn't asked for a specific sort.
    const chronological = gb.length === 1 && (gb[0] === 'day' || gb[0] === 'hour');
    const orderCol = req.orderBy ? ORDER_COL[req.orderBy] : (chronological ? 'd0' : ORDER_COL['clicks']);
    const orderDir = req.orderDir ? (req.orderDir === 'asc' ? 'ASC' : 'DESC') : (chronological && !req.orderBy ? 'ASC' : 'DESC');

    const baseSql =
      `WITH cl AS (${clicksCte}), cv AS (${convCte})
       SELECT ${dimSelect ? dimSelect + ',' : ''}
              COALESCE(cl.clicks,0)::int AS clicks,
              COALESCE(cl.unique_clicks,0)::int AS unique_clicks,
              COALESCE(cl.invalid_clicks,0)::int AS invalid_clicks,
              COALESCE(cl.avg_fraud_score,0)::numeric(5,1) AS avg_fraud_score,
              COALESCE(cv.conversions,0)::int AS conversions,
              COALESCE(cv.total_conversions,0)::int AS total_conversions,
              COALESCE(cv.payout,0)::numeric(14,4) AS payout,
              COALESCE(cv.revenue,0)::numeric(14,4) AS revenue,
              (COALESCE(cv.revenue,0) - COALESCE(cv.payout,0))::numeric(14,4) AS margin
         FROM cl ${joinType} cv ${onClause}`;

    const countParams = [...params];
    const { rows: countRows } = await query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM (${baseSql}) AS sub`, countParams);
    const total = Number(countRows[0]?.total ?? 0);

    const pageParams = [...params];
    pageParams.push(req.limit);
    const limP = `$${pageParams.length}`;
    pageParams.push(req.offset);
    const offP = `$${pageParams.length}`;
    const sql = `${baseSql} ORDER BY ${orderCol} ${orderDir} LIMIT ${limP} OFFSET ${offP}`;

    const { rows } = await query<Record<string, unknown>>(sql, pageParams);

    const wanted = new Set(req.metrics);
    const out: ReportRow[] = rows.map((row) => {
      const dimensions: Record<string, string | null> = {};
      gb.forEach((d, i) => {
        const v = row[`d${i}`];
        dimensions[d] = v == null ? null : v instanceof Date ? v.toISOString() : String(v);
      });

      const clicks = Number(row['clicks']);
      const conversions = Number(row['conversions']);
      const payout = String(row['payout']);
      const revenue = String(row['revenue']);
      const margin = String(row['margin']);
      const all: Record<Metric, string | number> = {
        clicks,
        unique_clicks: Number(row['unique_clicks']),
        invalid_clicks: Number(row['invalid_clicks']),
        avg_fraud_score: Number(row['avg_fraud_score']),
        conversions,
        total_conversions: Number(row['total_conversions']),
        payout, revenue, margin,
        cr: clicks > 0 ? Number((conversions / clicks).toFixed(4)) : 0,
        epc: clicks > 0 ? Number((Number(payout) / clicks).toFixed(4)) : 0,
      };
      const metrics: Record<string, string | number> = {};
      for (const m of req.metrics) if (wanted.has(m)) metrics[m] = all[m];
      return { dimensions, metrics };
    });

    return { groupBy: gb, metrics: req.metrics, rows: out, total };
  }
}
