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
  country: { click: 'clicks.country', conv: 'k.country' },
  device: { click: 'clicks.device', conv: 'k.device' },
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
};

export class PostgresReportingProvider implements ReportingProvider {
  async runReport(req: ReportRequest): Promise<ReportResult> {
    const gb = req.groupBy;
    const params: unknown[] = [req.networkId];
    const clickWhere = ['clicks.network_id = $1'];
    const convWhere = ['c.network_id = $1', "c.status = 'approved'"];

    const add = (value: unknown, clickExpr: string, convExpr: string, op = '='): void => {
      if (value == null || value === '') return;
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
    add(f.country, 'clicks.country', 'k.country');
    add(f.device, 'clicks.device', 'k.device');

    const needsOffers = gb.includes('advertiser') || f.advertiserId != null;
    const groupIdx = gb.map((_, i) => `d${i}`).join(', ');

    const clicksCte =
      `SELECT ${gb.map((d, i) => `${DIM_SQL[d].click} AS d${i}`).join(', ')}${gb.length ? ',' : ''}
              COUNT(*) AS clicks, COUNT(*) FILTER (WHERE clicks.is_unique) AS unique_clicks
         FROM clicks ${needsOffers ? 'LEFT JOIN offers o ON o.id = clicks.offer_id AND o.network_id = clicks.network_id' : ''}
        WHERE ${clickWhere.join(' AND ')}
        ${gb.length ? `GROUP BY ${groupIdx}` : ''}`;

    const convCte =
      `SELECT ${gb.map((d, i) => `${DIM_SQL[d].conv} AS d${i}`).join(', ')}${gb.length ? ',' : ''}
              COUNT(*) AS conversions, COALESCE(SUM(c.payout),0) AS payout, COALESCE(SUM(c.revenue),0) AS revenue
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
    const orderCol = ORDER_COL[req.orderBy ?? 'clicks'];
    const orderDir = req.orderDir === 'asc' ? 'ASC' : 'DESC';
    params.push(req.limit);
    const limP = `$${params.length}`;
    params.push(req.offset);
    const offP = `$${params.length}`;

    const sql =
      `WITH cl AS (${clicksCte}), cv AS (${convCte})
       SELECT ${dimSelect ? dimSelect + ',' : ''}
              COALESCE(cl.clicks,0)::int AS clicks,
              COALESCE(cl.unique_clicks,0)::int AS unique_clicks,
              COALESCE(cv.conversions,0)::int AS conversions,
              COALESCE(cv.payout,0)::numeric(14,4) AS payout,
              COALESCE(cv.revenue,0)::numeric(14,4) AS revenue,
              (COALESCE(cv.revenue,0) - COALESCE(cv.payout,0))::numeric(14,4) AS margin
         FROM cl ${joinType} cv ${onClause}
        ORDER BY ${orderCol} ${orderDir}
        LIMIT ${limP} OFFSET ${offP}`;

    const { rows } = await query<Record<string, unknown>>(sql, params);

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
        conversions,
        payout, revenue, margin,
        cr: clicks > 0 ? Number((conversions / clicks).toFixed(4)) : 0,
        epc: clicks > 0 ? Number((Number(payout) / clicks).toFixed(4)) : 0,
      };
      const metrics: Record<string, string | number> = {};
      for (const m of req.metrics) if (wanted.has(m)) metrics[m] = all[m];
      return { dimensions, metrics };
    });

    return { groupBy: gb, metrics: req.metrics, rows: out };
  }
}
