/**
 * Postgres reporting provider (spec §9). Builds a safe, parameterized aggregation over clicks +
 * conversions with whitelisted dimensions. Clicks and conversions are each aggregated in a CTE and
 * FULL-OUTER-JOINed on the group key, so a group with clicks-but-no-conversions (or vice-versa)
 * still appears. All grouping/aggregation is in SQL — never row-by-row in Node (spec §3B).
 *
 * Dimension/metric names come ONLY from the whitelists below; all VALUES are parameterized.
 */
import { query } from '../db/pool.js';
import { MONEY_SORT_METRICS, moneyFieldsOf } from './types.js';
import { mbcJsonSql } from './money-by-currency.js';
import type { Dimension, Metric, MetricValue, MoneyByCurrency, ReportRequest, ReportResult, ReportRow, ReportingProvider } from './types.js';

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
  day: { click: "date_trunc('day', clicks.created_at, 'UTC')", conv: "date_trunc('day', c.created_at, 'UTC')" },
  hour: { click: "date_trunc('hour', clicks.created_at, 'UTC')", conv: "date_trunc('hour', c.created_at, 'UTC')" },
  sub1: { click: 'clicks.sub1', conv: 'k.sub1' },
  sub2: { click: 'clicks.sub2', conv: 'k.sub2' },
  sub3: { click: 'clicks.sub3', conv: 'k.sub3' },
  sub4: { click: 'clicks.sub4', conv: 'k.sub4' },
  sub5: { click: 'clicks.sub5', conv: 'k.sub5' },
};

// ORDER BY expressions over the outer `s` row (cr/epc are ratios, computed the same way as below).
// `currencies` / `money_by_currency` are never sort keys (request.ts refuses them as orderBy).
type OrderMetric = Exclude<Metric, 'currencies' | 'money_by_currency'>;
const ORDER_COL: Record<OrderMetric, string> = {
  clicks: 's.clicks', unique_clicks: 's.unique_clicks', conversions: 's.conversions',
  payout: 's.payout', revenue: 's.revenue', margin: 's.margin',
  cr: 's.conversions::numeric / NULLIF(s.clicks, 0)', epc: 's.payout / NULLIF(s.clicks, 0)',
  invalid_clicks: 's.invalid_clicks', total_conversions: 's.total_conversions', avg_fraud_score: 's.avg_fraud_score',
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
      // Exclusions keep rows whose value is NULL ("exclude smart link X" must not also drop all
      // traffic that has no smart link) — hence the explicit IS NULL / IS DISTINCT FROM.
      const exclude = op === '<>';
      if (Array.isArray(value)) {
        if (value.length === 0) return;
        params.push(value);
        const p = `$${params.length}`;
        const cmp = (e: string) => (exclude ? `(${e} IS NULL OR ${e}::text <> ALL(${p}::text[]))` : `${e}::text = ANY(${p}::text[])`);
        clickWhere.push(cmp(clickExpr));
        convWhere.push(cmp(convExpr));
        return;
      }
      params.push(value);
      const p = `$${params.length}`;
      const cmp = (e: string) => (exclude ? `${e}::text IS DISTINCT FROM ${p}::text` : `${e} ${op} ${p}`);
      clickWhere.push(cmp(clickExpr));
      convWhere.push(cmp(convExpr));
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
    // "Others › Ignore Fail Traffic" — drop fraud-flagged clicks from click-side metrics entirely, and
    // the conversions those clicks produced (a conversion with no resolvable click — offline/manual —
    // has nothing flagged and is kept; array_length of NULL or '{}' is NULL).
    if (f.excludeInvalid) {
      clickWhere.push('array_length(clicks.fraud_flags, 1) IS NULL');
      convWhere.push('array_length(k.fraud_flags, 1) IS NULL');
    }

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

    // `currencies` (opt-in): the distinct currencies of exactly the conversions that feed payout /
    // revenue / margin (approved), so a caller can tell a single-currency sum from a mixed one.
    const wantCurrencies = req.metrics.includes('currencies');
    // A money sort (payout/revenue/margin/epc) must never compare currencies: each group's approved
    // conversions are classified as one currency (cur_n = 1, none without a currency) / none / mixed.
    const moneySort = req.orderBy != null && MONEY_SORT_METRICS.has(req.orderBy);
    const convFrom = `FROM conversions c LEFT JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
        WHERE ${convWhere.join(' AND ')}`;
    const convCte =
      `SELECT ${gb.map((d, i) => `${DIM_SQL[d].conv} AS d${i}`).join(', ')}${gb.length ? ',' : ''}
              COUNT(*) AS total_conversions,
              COUNT(*) FILTER (WHERE c.status = 'approved') AS conversions,
              COALESCE(SUM(c.payout) FILTER (WHERE c.status = 'approved'), 0) AS payout,
              COALESCE(SUM(c.revenue) FILTER (WHERE c.status = 'approved'), 0) AS revenue${wantCurrencies ? `,
              array_agg(DISTINCT c.currency ORDER BY c.currency) FILTER (WHERE c.status = 'approved' AND c.currency IS NOT NULL) AS currencies` : ''}${moneySort ? `,
              COUNT(DISTINCT c.currency) FILTER (WHERE c.status = 'approved') AS cur_n,
              COUNT(*) FILTER (WHERE c.status = 'approved' AND c.currency IS NULL) AS cur_null,
              MIN(c.currency) FILTER (WHERE c.status = 'approved') AS cur_one` : ''}
         ${convFrom}
        ${gb.length ? `GROUP BY ${groupIdx}` : ''}`;

    // `money_by_currency` (opt-in): the same approved conversions summed per (group, currency) — NULL
    // currency excluded — then folded into one jsonb object per group carrying only the audience's
    // money fields (whitelisted names; values numeric(14,4) text).
    const wantMbc = req.metrics.includes('money_by_currency');
    const mbcCtes = wantMbc
      ? `, cm AS (
         SELECT ${gb.map((d, i) => `${DIM_SQL[d].conv} AS d${i}, `).join('')}c.currency AS cur,
                COALESCE(SUM(c.payout), 0) AS p, COALESCE(SUM(c.revenue), 0) AS r
         ${convFrom} AND c.status = 'approved' AND c.currency IS NOT NULL
         GROUP BY ${gb.map((_, i) => `d${i}, `).join('')}cur
       ), cmj AS (
         SELECT ${gb.map((_, i) => `cm.d${i}, `).join('')}${mbcJsonSql('cm', moneyFieldsOf(req))} AS mbc
           FROM cm ${gb.length ? `GROUP BY ${gb.map((_, i) => `cm.d${i}`).join(', ')}` : ''}
       )`
      : '';
    // cm's groups are a subset of cv's, so they attach on the merged group key (same NULL sentinel).
    const mbcJoin = !wantMbc ? '' : gb.length
      ? 'LEFT JOIN cmj ON ' + gb.map((_, i) => `COALESCE(COALESCE(cl.d${i}, cv.d${i})::text, '~NULL~') = COALESCE(cmj.d${i}::text, '~NULL~')`).join(' AND ')
      : 'CROSS JOIN cmj';

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
    const orderCol = req.orderBy && req.orderBy in ORDER_COL ? ORDER_COL[req.orderBy as OrderMetric] : (chronological ? 's.d0' : ORDER_COL['clicks']);
    const orderDir = req.orderDir ? (req.orderDir === 'asc' ? 'ASC' : 'DESC') : (chronological && !req.orderBy ? 'ASC' : 'DESC');

    const baseSql =
      `WITH cl AS (${clicksCte}), cv AS (${convCte})${mbcCtes}
       SELECT ${dimSelect ? dimSelect + ',' : ''}
              COALESCE(cl.clicks,0)::int AS clicks,
              COALESCE(cl.unique_clicks,0)::int AS unique_clicks,
              COALESCE(cl.invalid_clicks,0)::int AS invalid_clicks,
              COALESCE(cl.avg_fraud_score,0)::numeric(5,1) AS avg_fraud_score,
              COALESCE(cv.conversions,0)::int AS conversions,
              COALESCE(cv.total_conversions,0)::int AS total_conversions,
              COALESCE(cv.payout,0)::numeric(14,4) AS payout,
              COALESCE(cv.revenue,0)::numeric(14,4) AS revenue,
              (COALESCE(cv.revenue,0) - COALESCE(cv.payout,0))::numeric(14,4) AS margin${wantCurrencies ? `,
              COALESCE(cv.currencies, '{}'::text[]) AS currencies` : ''}${wantMbc ? `,
              COALESCE(cmj.mbc, '{}'::jsonb) AS money_by_currency` : ''}${moneySort ? `,
              -- 0 = money in exactly one currency, 1 = no approved conversion, 2 = mixed / unknown currency.
              CASE WHEN COALESCE(cv.conversions, 0) = 0 THEN 1
                   WHEN cv.cur_n = 1 AND cv.cur_null = 0 THEN 0 ELSE 2 END AS money_bucket,
              CASE WHEN COALESCE(cv.conversions, 0) > 0 AND cv.cur_n = 1 AND cv.cur_null = 0 THEN cv.cur_one END AS money_currency` : ''}
         FROM cl ${joinType} cv ${onClause} ${mbcJoin}`;

    const countParams = [...params];
    const { rows: countRows } = await query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM (${baseSql}) AS sub`, countParams);
    const total = Number(countRows[0]?.total ?? 0);

    const pageParams = [...params];
    pageParams.push(req.limit);
    const limP = `$${pageParams.length}`;
    pageParams.push(req.offset);
    const offP = `$${pageParams.length}`;
    // Stable tie-break on the group key so paging never repeats/skips rows with equal metrics.
    const tieBreak = gb.map((_, i) => `s.d${i}::text`).join(', ');
    // Money sort: single-currency rows first, by currency code and then the value within it; then
    // no-money rows; mixed-currency rows last in tie-break order (their sum is not comparable).
    // All of it in SQL, before LIMIT/OFFSET, so paging stays consistent.
    const orderSql = moneySort
      ? `s.money_bucket ASC, s.money_currency ASC NULLS LAST, CASE WHEN s.money_bucket = 0 THEN ${orderCol} END ${orderDir} NULLS LAST`
      : `${orderCol} ${orderDir} NULLS LAST`;
    const sql = `SELECT s.* FROM (${baseSql}) AS s
      ORDER BY ${orderSql}${tieBreak ? `, ${tieBreak}` : ''} LIMIT ${limP} OFFSET ${offP}`;

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
      const all: Record<Metric, MetricValue> = {
        clicks,
        unique_clicks: Number(row['unique_clicks']),
        invalid_clicks: Number(row['invalid_clicks']),
        avg_fraud_score: Number(row['avg_fraud_score']),
        conversions,
        total_conversions: Number(row['total_conversions']),
        payout, revenue, margin,
        cr: clicks > 0 ? Number((conversions / clicks).toFixed(4)) : 0,
        epc: clicks > 0 ? Number((Number(payout) / clicks).toFixed(4)) : 0,
        currencies: Array.isArray(row['currencies']) ? (row['currencies'] as unknown[]).map(String) : [],
        money_by_currency: (row['money_by_currency'] ?? {}) as MoneyByCurrency,
      };
      const metrics: Record<string, MetricValue> = {};
      for (const m of req.metrics) if (wanted.has(m)) metrics[m] = all[m];
      return { dimensions, metrics };
    });

    return { groupBy: gb, metrics: req.metrics, rows: out, total, ...(moneySort ? { sortedWithinCurrency: true as const } : {}) };
  }
}
