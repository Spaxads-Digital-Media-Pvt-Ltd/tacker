/**
 * Postgres reporting provider (spec §9). Builds a safe, parameterized aggregation over clicks +
 * conversions with whitelisted dimensions. Clicks and conversions are each aggregated in a CTE and
 * FULL-OUTER-JOINed on the group key, so a group with clicks-but-no-conversions (or vice-versa)
 * still appears. All grouping/aggregation is in SQL — never row-by-row in Node (spec §3B).
 *
 * Rollups (audit F-20): when a report only groups / filters by what the 15-minute rollups carry and
 * the rollup worker has a window (lib/reporting/rollups.ts), whole buckets inside that window come
 * from stats_clicks_15m / stats_conversions_15m and the rest — the recent hours, partial buckets at the
 * edges of the range, dirty buckets, anything before the backfill — from the raw tables: UNION ALL,
 * then aggregated as one, so the numbers are exactly the raw query's. Day / hour group in the
 * request's time zone (UTC unless the request names one).
 *
 * Billing rows (CPC paid clicks / CPM bookings — lib/offer-settings/billing.ts) are money, not conversions: their
 * payout / revenue count, `conversions` / `total_conversions` leave them out. A conversion with no click row behind
 * it (view-through, a CPM booking) is placed by its own country / device. Impressions (opt-in metrics) are a third
 * aggregate over the raw impressions table, joined on the same group key.
 *
 * Dimension/metric names come ONLY from the whitelists below; all VALUES are parameterized.
 */
import { query } from '../db/pool.js';
import { env } from '../../config/env.js';
import { MONEY_SORT_METRICS, moneyFieldsOf } from './types.js';
import { mbcJsonSql } from './money-by-currency.js';
import { rollupWindow, binSql, type RollupWindow } from './rollups.js';
import { formatInZone, isUtcZone } from './time-zone.js';
import type { Dimension, Metric, MetricValue, MoneyByCurrency, ReportRequest, ReportResult, ReportRow, ReportingProvider, SortOnlyKey } from './types.js';
import { rejectedClickSql } from '../click-rejections.js';
import { billingRowSql } from '../offer-settings/billing.js';
import { IMPRESSION_METRICS } from './types.js';

type DimMap = Record<Dimension, { click: string; conv: string; imp: string }>;

/** `tz` is a SQL expression: the literal 'UTC' or a parameter placeholder. */
const dimSql = (tz: string): DimMap => ({
  offer: { click: 'clicks.offer_id', conv: 'c.offer_id', imp: 'i.offer_id' },
  publisher: { click: 'clicks.publisher_id', conv: 'c.publisher_id', imp: 'i.publisher_id' },
  advertiser: { click: 'o.advertiser_id', conv: 'c.advertiser_id', imp: 'o.advertiser_id' },
  smartLink: { click: 'clicks.smart_link_id', conv: 'k.smart_link_id', imp: 'NULL::uuid' },
  country: { click: 'clicks.country', conv: CONV_COUNTRY, imp: 'i.country' },
  device: { click: 'clicks.device', conv: CONV_DEVICE, imp: 'i.device' },
  city: { click: 'clicks.city', conv: 'k.city', imp: 'i.city' },
  region: { click: 'clicks.region', conv: 'k.region', imp: 'i.region' },
  isp: { click: 'clicks.isp', conv: 'k.isp', imp: 'i.isp' },
  browser: { click: 'clicks.browser', conv: 'k.browser', imp: 'i.browser' },
  os: { click: 'clicks.os', conv: 'k.os', imp: 'i.os' },
  day: { click: `date_trunc('day', clicks.created_at, ${tz})`, conv: `date_trunc('day', c.created_at, ${tz})`, imp: `date_trunc('day', i.created_at, ${tz})` },
  hour: { click: `date_trunc('hour', clicks.created_at, ${tz})`, conv: `date_trunc('hour', c.created_at, ${tz})`, imp: `date_trunc('hour', i.created_at, ${tz})` },
  sub1: { click: 'clicks.sub1', conv: 'k.sub1', imp: 'i.sub1' },
  sub2: { click: 'clicks.sub2', conv: 'k.sub2', imp: 'i.sub2' },
  sub3: { click: 'clicks.sub3', conv: 'k.sub3', imp: 'i.sub3' },
  sub4: { click: 'clicks.sub4', conv: 'k.sub4', imp: 'i.sub4' },
  sub5: { click: 'clicks.sub5', conv: 'k.sub5', imp: 'i.sub5' },
});

/** A conversion's country / device: its click's, else its own (view-through, CPM bookings — no click row). */
const CONV_COUNTRY = 'COALESCE(k.country, c.country)';
const CONV_DEVICE = 'COALESCE(k.device, c.device)';
/** SQL: a billing row (money, not a conversion). */
const BILLING = billingRowSql('c');

/** The same dimensions over the rollups (r = stats_clicks_15m, rv = stats_conversions_15m). */
const rollupDimSql = (tz: string): Partial<Record<Dimension, { click: string; conv: string }>> => ({
  offer: { click: 'r.offer_id', conv: 'rv.offer_id' },
  publisher: { click: 'r.publisher_id', conv: 'rv.publisher_id' },
  advertiser: { click: 'o.advertiser_id', conv: 'rv.advertiser_id' },
  smartLink: { click: 'r.smart_link_id', conv: 'rv.smart_link_id' },
  country: { click: 'r.country', conv: 'rv.country' },
  device: { click: 'r.device', conv: 'rv.device' },
  day: { click: `date_trunc('day', r.bucket, ${tz})`, conv: `date_trunc('day', rv.bucket, ${tz})` },
  hour: { click: `date_trunc('hour', r.bucket, ${tz})`, conv: `date_trunc('hour', rv.bucket, ${tz})` },
});

const ROLLUP_DIMS = new Set<Dimension>(['offer', 'publisher', 'advertiser', 'smartLink', 'country', 'device', 'day', 'hour']);
const ROLLUP_FILTERS = new Set<string>([
  'from', 'to', 'offerId', 'publisherId', 'advertiserId', 'smartLinkId', 'country', 'device',
  'excludeOfferId', 'excludePublisherId', 'excludeAdvertiserId', 'excludeSmartLinkId', 'excludeCountry', 'excludeDevice',
  'excludeRejected',
]);

/** Can the rollups answer this report? (Everything else — city, ISP, subs, "ignore fail traffic" — is raw.) */
export function rollupEligible(req: ReportRequest): boolean {
  if (!req.groupBy.every((d) => ROLLUP_DIMS.has(d))) return false;
  // The rollups count rejected clicks but not their fraud scores: without them, the average is raw.
  if (req.filters.excludeRejected && req.metrics.includes('avg_fraud_score')) return false;
  return Object.entries(req.filters).every(([k, v]) =>
    v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0) || ROLLUP_FILTERS.has(k));
}

// ORDER BY expressions over the outer `s` row (cr/epc are ratios, computed the same way as below).
// `currencies` / `money_by_currency` are never sort keys (request.ts refuses them as orderBy).
type OrderMetric = Exclude<Metric, 'currencies' | 'money_by_currency' | 'impressions' | 'unique_impressions' | 'invalid_impressions' | 'ctr'> | SortOnlyKey;
const ORDER_COL: Record<OrderMetric, string> = {
  clicks: 's.clicks', unique_clicks: 's.unique_clicks', conversions: 's.conversions',
  // Sort-only: net (valid) clicks — what the admin reports' "Clicks" column shows.
  valid_clicks: '(s.clicks - s.invalid_clicks)',
  payout: 's.payout', revenue: 's.revenue', margin: 's.margin',
  cr: 's.conversions::numeric / NULLIF(s.clicks, 0)', epc: 's.payout / NULLIF(s.clicks, 0)',
  invalid_clicks: 's.invalid_clicks', total_conversions: 's.total_conversions', avg_fraud_score: 's.avg_fraud_score',
};

export interface PostgresProviderOptions {
  /** Read the rollups when a report fits them (default: REPORTING_ROLLUPS). */
  rollups?: boolean;
}

export class PostgresReportingProvider implements ReportingProvider {
  constructor(private readonly opts: PostgresProviderOptions = {}) {}

  async runReport(req: ReportRequest): Promise<ReportResult> {
    const useRollups = (this.opts.rollups ?? env.REPORTING_ROLLUPS === 'on') && rollupEligible(req);
    const window = useRollups ? await rollupWindow(req.networkId) : null;
    return this.build(req, window);
  }

  private async build(req: ReportRequest, w: RollupWindow | null): Promise<ReportResult> {
    const gb = req.groupBy;
    const params: unknown[] = [req.networkId];
    // The report time zone: the literal 'UTC' (unchanged SQL) or a parameter — bound only when a
    // day / hour dimension uses it (Postgres rejects a parameter nothing references).
    const zoned = !isUtcZone(req.timeZone) && gb.some((d) => d === 'day' || d === 'hour');
    let tzSql = `'UTC'`;
    if (zoned) {
      params.push(req.timeZone);
      tzSql = `$${params.length}::text`;
    }
    const DIM_SQL = dimSql(tzSql);
    const ROLL_DIM_SQL = rollupDimSql(tzSql);
    const hybrid = w != null;

    const clickWhere = ['clicks.network_id = $1'];
    // Status is applied per-metric via FILTER below (not a hard WHERE) so both "total_conversions"
    // (all statuses) and "conversions"/payout/revenue (approved-only, the financially-realized ones)
    // can be computed from the same aggregated group.
    const convWhere = ['c.network_id = $1'];
    // The same filters over the rollups (only used for a hybrid read).
    const rollClickWhere = ['r.network_id = $1'];
    const rollConvWhere = ['rv.network_id = $1'];
    // … and over impressions (only used when an impression metric is asked for).
    const impWhere = ['i.network_id = $1'];

    // Every include filter accepts one value (`= $n`) or an array (an IN-list, via
    // `::text = ANY($n::text[])` — text-cast so it works uniformly whether the underlying column is
    // uuid or text). The Dimensional Report's multi-select "click row(s) to filter" needs this; every
    // other caller still just passes a single value. Returns the value's placeholder.
    // `imp`: the impressions column it filters (null = impressions have none — e.g. a smart link — so an include
    // filter on it matches no impression and an exclusion keeps them all).
    const add = (value: unknown, clickExpr: string, convExpr: string, op: '=' | '<>' | '>=' | '<=' = '=', roll?: [string, string] | null, imp?: string | null): string | null => {
      if (value == null || value === '') return null;
      // Exclusions keep rows whose value is NULL ("exclude smart link X" must not also drop all
      // traffic that has no smart link) — hence the explicit IS NULL / IS DISTINCT FROM.
      const exclude = op === '<>';
      const onImp = (cmp: (e: string) => string) => {
        if (imp) impWhere.push(cmp(imp));
        else if (imp === null && !exclude) impWhere.push('false');
      };
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        params.push(value);
        const p = `$${params.length}`;
        const cmp = (e: string) => (exclude ? `(${e} IS NULL OR ${e}::text <> ALL(${p}::text[]))` : `${e}::text = ANY(${p}::text[])`);
        clickWhere.push(cmp(clickExpr));
        convWhere.push(cmp(convExpr));
        if (roll) { rollClickWhere.push(cmp(roll[0])); rollConvWhere.push(cmp(roll[1])); }
        onImp(cmp);
        return p;
      }
      params.push(value);
      const p = `$${params.length}`;
      const cmp = (e: string) => (exclude ? `${e}::text IS DISTINCT FROM ${p}::text` : `${e} ${op} ${p}`);
      clickWhere.push(cmp(clickExpr));
      convWhere.push(cmp(convExpr));
      if (roll) { rollClickWhere.push(cmp(roll[0])); rollConvWhere.push(cmp(roll[1])); }
      onImp(cmp);
      return p;
    };
    const f = req.filters;
    const fromP = add(f.from, 'clicks.created_at', 'c.created_at', '>=', null, 'i.created_at');
    const toP = add(f.to, 'clicks.created_at', 'c.created_at', '<=', null, 'i.created_at');
    add(f.offerId, 'clicks.offer_id', 'c.offer_id', '=', ['r.offer_id', 'rv.offer_id'], 'i.offer_id');
    add(f.publisherId, 'clicks.publisher_id', 'c.publisher_id', '=', ['r.publisher_id', 'rv.publisher_id'], 'i.publisher_id');
    add(f.advertiserId, 'o.advertiser_id', 'c.advertiser_id', '=', ['o.advertiser_id', 'rv.advertiser_id'], 'o.advertiser_id');
    add(f.smartLinkId, 'clicks.smart_link_id', 'k.smart_link_id', '=', ['r.smart_link_id', 'rv.smart_link_id'], null);
    add(f.country, 'clicks.country', CONV_COUNTRY, '=', ['r.country', 'rv.country'], 'i.country');
    add(f.device, 'clicks.device', CONV_DEVICE, '=', ['r.device', 'rv.device'], 'i.device');
    add(f.city, 'clicks.city', 'k.city', '=', null, 'i.city');
    add(f.region, 'clicks.region', 'k.region', '=', null, 'i.region');
    add(f.isp, 'clicks.isp', 'k.isp', '=', null, 'i.isp');
    add(f.browser, 'clicks.browser', 'k.browser', '=', null, 'i.browser');
    add(f.os, 'clicks.os', 'k.os', '=', null, 'i.os');
    add(f.sub1, 'clicks.sub1', 'k.sub1', '=', null, 'i.sub1');
    add(f.sub2, 'clicks.sub2', 'k.sub2', '=', null, 'i.sub2');
    add(f.sub3, 'clicks.sub3', 'k.sub3', '=', null, 'i.sub3');
    add(f.sub4, 'clicks.sub4', 'k.sub4', '=', null, 'i.sub4');
    add(f.sub5, 'clicks.sub5', 'k.sub5', '=', null, 'i.sub5');
    // "Exclusions" (Everflow's own term) — same dimensions, inverted with <>.
    add(f.excludeOfferId, 'clicks.offer_id', 'c.offer_id', '<>', ['r.offer_id', 'rv.offer_id'], 'i.offer_id');
    add(f.excludePublisherId, 'clicks.publisher_id', 'c.publisher_id', '<>', ['r.publisher_id', 'rv.publisher_id'], 'i.publisher_id');
    add(f.excludeAdvertiserId, 'o.advertiser_id', 'c.advertiser_id', '<>', ['o.advertiser_id', 'rv.advertiser_id'], 'o.advertiser_id');
    add(f.excludeSmartLinkId, 'clicks.smart_link_id', 'k.smart_link_id', '<>', ['r.smart_link_id', 'rv.smart_link_id'], null);
    add(f.excludeCountry, 'clicks.country', CONV_COUNTRY, '<>', ['r.country', 'rv.country'], 'i.country');
    add(f.excludeDevice, 'clicks.device', CONV_DEVICE, '<>', ['r.device', 'rv.device'], 'i.device');
    // "Others › Ignore Fail Traffic" — drop fraud-flagged clicks from click-side metrics entirely, and
    // the conversions those clicks produced (a conversion with no resolvable click — offline/manual —
    // has nothing flagged and is kept; array_length of NULL or '{}' is NULL).
    if (f.excludeInvalid) {
      clickWhere.push('array_length(clicks.fraud_flags, 1) IS NULL');
      convWhere.push('array_length(k.fraud_flags, 1) IS NULL');
      impWhere.push('array_length(i.fraud_flags, 1) IS NULL');
    }
    // Partner / advertiser views and the automation: only clicks that reached the offer (the ones /click
    // rejected are recorded for the admin's reports — lib/click-rejections). They never convert, so
    // the conversion side is unchanged. Rejected impressions likewise.
    if (f.excludeRejected) {
      clickWhere.push(`NOT ${rejectedClickSql('clicks')}`);
      impWhere.push(`NOT ${rejectedClickSql('i')}`);
    }

    // Hybrid read: whole buckets in [rs, re) that aren't dirty come from the rollups; every raw row
    // outside them from the raw tables. rs/re clip the rollup window to the requested range (only
    // buckets lying entirely inside it).
    let inRollup = (_col: string) => 'false';
    let outsideRollup = (_col: string) => 'true';
    if (hybrid) {
      params.push(w.low);
      const lowP = `$${params.length}::timestamptz`;
      params.push(w.high);
      const highP = `$${params.length}::timestamptz`;
      params.push(w.dirty);
      const dirtyP = `$${params.length}::timestamptz[]`;
      const rs = fromP ? `GREATEST(${lowP}, ${binSql(`${fromP}::timestamptz - interval '1 microsecond'`)} + interval '15 minutes')` : lowP;
      const re = toP ? `LEAST(${highP}, ${binSql(`${toP}::timestamptz + interval '1 microsecond'`)})` : highP;
      inRollup = (col) => `${col} >= ${rs} AND ${col} < ${re} AND ${col} <> ALL(${dirtyP})`;
      outsideRollup = (col) => `(${col} < ${rs} OR ${col} >= ${re} OR ${binSql(col)} = ANY(${dirtyP}))`;
    }

    const needsOffers = gb.includes('advertiser') || f.advertiserId != null || f.excludeAdvertiserId != null;
    const groupIdx = gb.map((_, i) => `d${i}`).join(', ');
    const comma = gb.length ? ',' : '';
    const rawClickDims = gb.map((d, i) => `${DIM_SQL[d].click} AS d${i}`).join(', ');
    const rawConvDims = gb.map((d, i) => `${DIM_SQL[d].conv} AS d${i}`).join(', ');
    const rollClickDims = gb.map((d, i) => `${ROLL_DIM_SQL[d]!.click} AS d${i}`).join(', ');
    const rollConvDims = gb.map((d, i) => `${ROLL_DIM_SQL[d]!.conv} AS d${i}`).join(', ');
    const groupSql = gb.length ? `GROUP BY ${groupIdx}` : '';

    const clicksCte = !hybrid
      ? `SELECT ${rawClickDims}${comma}
              COUNT(*) AS clicks, COUNT(*) FILTER (WHERE clicks.is_unique) AS unique_clicks,
              COUNT(*) FILTER (WHERE array_length(clicks.fraud_flags, 1) > 0) AS invalid_clicks,
              COALESCE(AVG(clicks.fraud_score), 0) AS avg_fraud_score
         FROM clicks ${needsOffers ? 'LEFT JOIN offers o ON o.id = clicks.offer_id AND o.network_id = clicks.network_id' : ''}
        WHERE ${clickWhere.join(' AND ')}
        ${groupSql}`
      : `SELECT ${groupIdx}${comma}
              SUM(u.clicks) AS clicks, SUM(u.unique_clicks) AS unique_clicks, SUM(u.invalid_clicks) AS invalid_clicks,
              COALESCE(SUM(u.fs)::numeric / NULLIF(SUM(u.clicks), 0), 0) AS avg_fraud_score
         FROM (
           SELECT ${rawClickDims}${comma}
                  COUNT(*) AS clicks, COUNT(*) FILTER (WHERE clicks.is_unique) AS unique_clicks,
                  COUNT(*) FILTER (WHERE array_length(clicks.fraud_flags, 1) > 0) AS invalid_clicks,
                  SUM(clicks.fraud_score) AS fs
             FROM clicks ${needsOffers ? 'LEFT JOIN offers o ON o.id = clicks.offer_id AND o.network_id = clicks.network_id' : ''}
            WHERE ${clickWhere.join(' AND ')} AND ${outsideRollup('clicks.created_at')}
            ${groupSql}
           UNION ALL
           SELECT ${rollClickDims}${comma} ${f.excludeRejected
               ? 'r.clicks - r.rejected_clicks, r.unique_clicks, r.invalid_clicks - r.rejected_clicks'
               : 'r.clicks, r.unique_clicks, r.invalid_clicks'}, r.fraud_score_sum
             FROM stats_clicks_15m r ${needsOffers ? 'LEFT JOIN offers o ON o.id = r.offer_id AND o.network_id = r.network_id' : ''}
            WHERE ${rollClickWhere.join(' AND ')} AND ${inRollup('r.bucket')}
         ) u
        ${groupSql}`;

    // `currencies` (opt-in): the distinct currencies of exactly the conversions that feed payout /
    // revenue / margin (approved), so a caller can tell a single-currency sum from a mixed one.
    const wantCurrencies = req.metrics.includes('currencies');
    // A money sort (payout/revenue/margin/epc) must never compare currencies: each group's approved
    // conversions are classified as one currency (cur_n = 1, none without a currency) / none / mixed.
    const moneySort = req.orderBy != null && MONEY_SORT_METRICS.has(req.orderBy);
    const convFrom = `FROM conversions c LEFT JOIN clicks k ON k.click_id = c.click_id AND k.network_id = c.network_id
        WHERE ${convWhere.join(' AND ')}`;
    // `money_by_currency` (opt-in): the same approved conversions summed per (group, currency) — NULL
    // currency excluded — then folded into one jsonb object per group carrying only the audience's
    // money fields (whitelisted names; values numeric(14,4) text).
    const wantMbc = req.metrics.includes('money_by_currency');

    let convCtes: string;
    let mbcCtes = '';
    if (!hybrid) {
      convCtes = `cv AS (
        SELECT ${rawConvDims}${comma}
              COUNT(*) FILTER (WHERE NOT ${BILLING}) AS total_conversions,
              COUNT(*) FILTER (WHERE c.status = 'approved' AND NOT ${BILLING}) AS conversions,
              COUNT(*) FILTER (WHERE c.status = 'approved') AS money_rows,
              COALESCE(SUM(c.payout) FILTER (WHERE c.status = 'approved'), 0) AS payout,
              COALESCE(SUM(c.revenue) FILTER (WHERE c.status = 'approved'), 0) AS revenue${wantCurrencies ? `,
              array_agg(DISTINCT c.currency ORDER BY c.currency) FILTER (WHERE c.status = 'approved' AND c.currency IS NOT NULL) AS currencies` : ''}${moneySort ? `,
              COUNT(DISTINCT c.currency) FILTER (WHERE c.status = 'approved') AS cur_n,
              COUNT(*) FILTER (WHERE c.status = 'approved' AND c.currency IS NULL) AS cur_null,
              MIN(c.currency) FILTER (WHERE c.status = 'approved') AS cur_one` : ''}
         ${convFrom}
        ${groupSql})`;
      if (wantMbc) {
        mbcCtes = `, cm AS (
         SELECT ${gb.map((d, i) => `${DIM_SQL[d].conv} AS d${i}, `).join('')}c.currency AS cur,
                COALESCE(SUM(c.payout), 0) AS p, COALESCE(SUM(c.revenue), 0) AS r
         ${convFrom} AND c.status = 'approved' AND c.currency IS NOT NULL
         GROUP BY ${gb.map((_, i) => `d${i}, `).join('')}cur
       ), cmj AS (
         SELECT ${gb.map((_, i) => `cm.d${i}, `).join('')}${mbcJsonSql('cm', moneyFieldsOf(req))} AS mbc
           FROM cm ${gb.length ? `GROUP BY ${gb.map((_, i) => `cm.d${i}`).join(', ')}` : ''}
       )`;
      }
    } else {
      // Per (group, currency) from both sources, then folded per group — the currency split is what
      // `currencies`, the money-sort classification and `money_by_currency` are computed from.
      convCtes = `cvu AS (
        SELECT ${rawConvDims}${comma} c.currency AS cur,
               COUNT(*) FILTER (WHERE NOT ${BILLING}) AS total_conversions,
               COUNT(*) FILTER (WHERE c.status = 'approved' AND NOT ${BILLING}) AS conversions,
               COALESCE(SUM(c.payout) FILTER (WHERE c.status = 'approved'), 0) AS payout,
               COALESCE(SUM(c.revenue) FILTER (WHERE c.status = 'approved'), 0) AS revenue,
               COUNT(*) FILTER (WHERE c.status = 'approved') AS money_rows
          ${convFrom} AND ${outsideRollup('c.created_at')}
         GROUP BY ${gb.map((_, i) => `d${i}, `).join('')}cur
        UNION ALL
        SELECT ${rollConvDims}${comma} rv.currency, rv.total_conversions, rv.conversions, rv.payout, rv.revenue, rv.conversions + rv.billed_rows
          FROM stats_conversions_15m rv
         WHERE ${rollConvWhere.join(' AND ')} AND ${inRollup('rv.bucket')}
      ), cv AS (
        SELECT ${groupIdx}${comma}
               SUM(total_conversions) AS total_conversions, SUM(conversions) AS conversions, SUM(money_rows) AS money_rows,
               COALESCE(SUM(payout), 0) AS payout, COALESCE(SUM(revenue), 0) AS revenue${wantCurrencies ? `,
               array_agg(DISTINCT cur ORDER BY cur) FILTER (WHERE money_rows > 0 AND cur IS NOT NULL) AS currencies` : ''}${moneySort ? `,
               COUNT(DISTINCT cur) FILTER (WHERE money_rows > 0) AS cur_n,
               COALESCE(SUM(money_rows) FILTER (WHERE cur IS NULL), 0) AS cur_null,
               MIN(cur) FILTER (WHERE money_rows > 0) AS cur_one` : ''}
          FROM cvu
         ${groupSql})`;
      if (wantMbc) {
        mbcCtes = `, cm AS (
         SELECT ${gb.map((_, i) => `d${i}, `).join('')}cur, COALESCE(SUM(payout), 0) AS p, COALESCE(SUM(revenue), 0) AS r
           FROM cvu WHERE money_rows > 0 AND cur IS NOT NULL
          GROUP BY ${gb.map((_, i) => `d${i}, `).join('')}cur
       ), cmj AS (
         SELECT ${gb.map((_, i) => `cm.d${i}, `).join('')}${mbcJsonSql('cm', moneyFieldsOf(req))} AS mbc
           FROM cm ${gb.length ? `GROUP BY ${gb.map((_, i) => `cm.d${i}`).join(', ')}` : ''}
       )`;
      }
    }
    // Impressions (opt-in): their own aggregate over the raw impressions table, on the same group key.
    const wantImp = req.metrics.some((m) => IMPRESSION_METRICS.includes(m));
    const imPart = (i: number) => (wantImp ? `, im.d${i}` : '');
    const imCte = !wantImp ? '' : `, im AS (
        SELECT ${gb.map((d, i) => `${DIM_SQL[d].imp} AS d${i}`).join(', ')}${comma}
               COUNT(*) AS impressions, COUNT(*) FILTER (WHERE i.is_unique) AS unique_impressions,
               COUNT(*) FILTER (WHERE array_length(i.fraud_flags, 1) > 0) AS invalid_impressions
          FROM impressions i ${needsOffers ? 'LEFT JOIN offers o ON o.id = i.offer_id AND o.network_id = i.network_id' : ''}
         WHERE ${impWhere.join(' AND ')}
         ${groupSql})`;
    const imJoin = !wantImp ? '' : gb.length
      ? 'FULL OUTER JOIN im ON ' + gb.map((_, i) => `COALESCE(COALESCE(cl.d${i}, cv.d${i})::text, '~NULL~') = COALESCE(im.d${i}::text, '~NULL~')`).join(' AND ')
      : 'CROSS JOIN im';
    // cm's groups are a subset of cv's, so they attach on the merged group key (same NULL sentinel).
    const mbcJoin = !wantMbc ? '' : gb.length
      ? 'LEFT JOIN cmj ON ' + gb.map((_, i) => `COALESCE(COALESCE(cl.d${i}, cv.d${i}${imPart(i)})::text, '~NULL~') = COALESCE(cmj.d${i}::text, '~NULL~')`).join(' AND ')
      : 'CROSS JOIN cmj';

    // FULL JOIN needs a hash/merge-joinable condition — Postgres rejects IS NOT DISTINCT FROM. Use
    // text-coalesced equality (NULL → sentinel) so null-dimension groups line up. Grand total
    // (no group by) → CROSS JOIN of the two single-row CTEs.
    const joinType = gb.length ? 'FULL OUTER JOIN' : 'CROSS JOIN';
    const onClause = gb.length
      ? 'ON ' + gb.map((_, i) => `COALESCE(cl.d${i}::text, '~NULL~') = COALESCE(cv.d${i}::text, '~NULL~')`).join(' AND ')
      : '';
    const dimSelect = gb.map((_, i) => `COALESCE(cl.d${i}, cv.d${i}${imPart(i)}) AS d${i}`).join(', ');
    // A day/hour-only report reads naturally in chronological order — default to that (the group's
    // own dimension column) rather than clicks-desc when the caller hasn't asked for a specific sort.
    const chronological = gb.length === 1 && (gb[0] === 'day' || gb[0] === 'hour');
    const orderCol = req.orderBy && req.orderBy in ORDER_COL ? ORDER_COL[req.orderBy as OrderMetric] : (chronological ? 's.d0' : ORDER_COL['clicks']);
    const orderDir = req.orderDir ? (req.orderDir === 'asc' ? 'ASC' : 'DESC') : (chronological && !req.orderBy ? 'ASC' : 'DESC');

    // Money: round(x, 4), not ::numeric(14,4) — a group's SUM can exceed the 10 integer digits one
    // amount column holds (the cast overflowed → 500; F-22 fixed the same in mbcJsonSql / /dashboard).
    const baseSql =
      `WITH cl AS (${clicksCte}), ${convCtes}${mbcCtes}${imCte}
       SELECT ${dimSelect ? dimSelect + ',' : ''}
              COALESCE(cl.clicks,0)::int AS clicks,
              COALESCE(cl.unique_clicks,0)::int AS unique_clicks,
              COALESCE(cl.invalid_clicks,0)::int AS invalid_clicks,
              COALESCE(cl.avg_fraud_score,0)::numeric(5,1) AS avg_fraud_score,
              COALESCE(cv.conversions,0)::int AS conversions,
              COALESCE(cv.total_conversions,0)::int AS total_conversions,
              round(COALESCE(cv.payout,0), 4) AS payout,
              round(COALESCE(cv.revenue,0), 4) AS revenue,
              round(COALESCE(cv.revenue,0) - COALESCE(cv.payout,0), 4) AS margin${wantImp ? `,
              COALESCE(im.impressions,0)::int AS impressions,
              COALESCE(im.unique_impressions,0)::int AS unique_impressions,
              COALESCE(im.invalid_impressions,0)::int AS invalid_impressions` : ''}${wantCurrencies ? `,
              COALESCE(cv.currencies, '{}'::text[]) AS currencies` : ''}${wantMbc ? `,
              COALESCE(cmj.mbc, '{}'::jsonb) AS money_by_currency` : ''}${moneySort ? `,
              -- 0 = money in exactly one currency, 1 = no approved conversion, 2 = mixed / unknown currency.
              CASE WHEN COALESCE(cv.money_rows, 0) = 0 THEN 1
                   WHEN cv.cur_n = 1 AND cv.cur_null = 0 THEN 0 ELSE 2 END AS money_bucket,
              CASE WHEN COALESCE(cv.money_rows, 0) > 0 AND cv.cur_n = 1 AND cv.cur_null = 0 THEN cv.cur_one END AS money_currency` : ''}
         FROM cl ${joinType} cv ${onClause} ${imJoin} ${mbcJoin}`;

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

    // Day / hour buckets in a non-UTC zone read as local wall time with their offset
    // ('2026-10-13T00:00:00+05:30'); UTC keeps the ISO instant ('2026-10-13T00:00:00.000Z').
    const fmtTime = (d: Date) => (zoned ? formatInZone(d, req.timeZone!) : d.toISOString());
    const wanted = new Set(req.metrics);
    const out: ReportRow[] = rows.map((row) => {
      const dimensions: Record<string, string | null> = {};
      gb.forEach((d, i) => {
        const v = row[`d${i}`];
        dimensions[d] = v == null ? null : v instanceof Date ? fmtTime(v) : String(v);
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
        impressions: Number(row['impressions'] ?? 0),
        unique_impressions: Number(row['unique_impressions'] ?? 0),
        invalid_impressions: Number(row['invalid_impressions'] ?? 0),
        ctr: Number(row['impressions'] ?? 0) > 0 ? Number((clicks / Number(row['impressions'])).toFixed(4)) : 0,
      };
      const metrics: Record<string, MetricValue> = {};
      for (const m of req.metrics) if (wanted.has(m)) metrics[m] = all[m];
      return { dimensions, metrics };
    });

    return { groupBy: gb, metrics: req.metrics, rows: out, total, ...(moneySort ? { sortedWithinCurrency: true as const } : {}) };
  }
}
