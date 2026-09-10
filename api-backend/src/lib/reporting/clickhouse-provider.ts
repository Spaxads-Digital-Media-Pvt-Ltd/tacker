/**
 * ClickHouse-backed ReportingProvider (spec §9, Phase 8.5 analytics store).
 *
 * Translates the existing Postgres reporting semantics into ClickHouse SQL. Uses the
 * denormalized `tracker.clicks` and `tracker.conversions` tables populated by the
 * AnalyticsWriter (Phase 8.4). No JOINs to Postgres tables — all dimensions/metrics are
 * computed from ClickHouse alone.
 *
 * Key design decisions vs PostgresReportingProvider:
 *
 * 1. `advertiser` dimension: ClickHouse `clicks` does NOT carry `advertiser_id` (it lives on
 * the `offers` Postgres table). Clicks without conversions therefore show NULL in the
 * advertiser dimension. This is a known, documented limitation. For advertiser-heavy
 * reports the Postgres provider remains the more accurate fallback.
 *
 * 2. Date/time semantics: ClickHouse `timestamp` is DateTime64(3) stored in UTC. We truncate
 * with `toStartOfDay` / `toStartOfHour` (ClickHouse equivalents of Postgres `date_trunc`).
 * The incoming `from`/`to` strings are ISO datetimes from the caller; we pass them through
 * as ClickHouse `DateTime` literals (ClickHouse parses ISO natively in WHERE clauses).
 *
 * 3. Tenant isolation: every query MUST include `WHERE network_id = :networkId`. The caller
 * (buildReportRequest) always sets networkId; we parameterize it as {p1:String}.
 *
 * 4. Anti-double-counting: clicks and conversions are each aggregated in their own subquery
 * and joined on the group key. Clicks contribute click-side metrics; conversions contribute
 * conversion-side metrics. No row from either table is counted in the other's metrics.
 */
import { getClickHouse } from '../clickhouse/client.js';
import type { ClickHouseClient } from '@clickhouse/client';
import type {
 Dimension,
 Metric,
 ReportRequest,
 ReportResult,
 ReportRow,
 ReportingProvider,
} from './types.js';

// --- dimension → SQL fragments -------------------------------------------

// ClickHouse clicks table has all the needed columns directly (no offers JOIN needed).
const DIM_SQL_CLICK: Record<Dimension, string> = {
 offer: 'c.offer_id',
 publisher: 'c.publisher_id',
 // advertiser on clicks requires the offers table which is NOT in ClickHouse.
 // We expose it but it will be NULL for click-only rows (known limitation).
 advertiser: 'c.advertiser_id',
 smartLink: 'c.smart_link_id',
 country: 'c.country',
 device: 'c.device',
 city: 'c.city',
 region: 'c.region',
 isp: 'c.isp',
 browser: 'c.browser',
 os: 'c.os',
 day: 'toStartOfDay(c.timestamp)',
 hour: 'toStartOfHour(c.timestamp)',
 sub1: 'c.sub1',
 sub2: 'c.sub2',
 sub3: 'c.sub3',
 sub4: 'c.sub4',
 sub5: 'c.sub5',
};

const DIM_SQL_CONV: Record<Dimension, string> = {
 offer: 'k.offer_id',
 publisher: 'k.publisher_id',
 advertiser: 'k.advertiser_id',
 smartLink: 'k.smart_link_id',
 country: 'k.country',
 device: 'k.device',
 city: 'k.city',
 region: 'k.region',
 isp: 'k.isp',
 browser: 'k.browser',
 os: 'k.os',
 day: 'toStartOfDay(k.timestamp)',
 hour: 'toStartOfHour(k.timestamp)',
 sub1: 'k.sub1',
 sub2: 'k.sub2',
 sub3: 'k.sub3',
 sub4: 'k.sub4',
 sub5: 'k.sub5',
};

// ClickHouse doesn't have a `FILTER (WHERE ...)` clause like Postgres. We use
// conditional aggregation: SUM(IF(condition, value, 0)).
const METRIC_CLICKS: Record<Metric, string> = {
 clicks: 'COUNT(*)',
 unique_clicks: 'COUNTIf(c.is_unique = 1)',
 conversions: '0',
 cr: '0',
 payout: '0',
 revenue: '0',
 margin: '0',
 epc: '0',
 invalid_clicks: 'COUNTIf(length(c.fraud_flags) > 0)',
 total_conversions: '0',
 avg_fraud_score: 'AVG(c.fraud_score)',
};

const METRIC_CONV: Record<Metric, string> = {
 clicks: '0',
 unique_clicks: '0',
 conversions: "COUNTIf(k.status = 'approved')",
 cr: '0',
 payout: 'SUMIf(k.payout, k.status = \'approved\')',
 revenue: 'SUMIf(k.revenue, k.status = \'approved\')',
 margin: 'SUMIf(k.revenue - k.payout, k.status = \'approved\')',
 epc: '0',
 invalid_clicks: '0',
 total_conversions: 'COUNT(*)',
 avg_fraud_score: 'AVG(k.fraud_score)',
};

const ORDER_COL: Record<Metric, string> = {
 clicks: 'clicks',
 unique_clicks: 'unique_clicks',
 conversions: 'conversions',
 cr: 'clicks',
 payout: 'payout',
 revenue: 'revenue',
 margin: 'margin',
 epc: 'clicks',
 invalid_clicks: 'invalid_clicks',
 total_conversions: 'total_conversions',
 avg_fraud_score: 'avg_fraud_score',
};

// --- provider ------------------------------------------------------------

export class ClickHouseReportingProvider implements ReportingProvider {
 private readonly client: ClickHouseClient;

 constructor(client?: ClickHouseClient) {
 this.client = client ?? getClickHouse();
 }

 async runReport(req: ReportRequest): Promise<ReportResult> {
 const gb = req.groupBy;
 const params: Array<unknown | unknown[]> = [req.networkId];
 const ph = (v: unknown) => { params.push(v); return `{p${params.length}:String}`; };
 const phArr = (v: unknown[]) => { params.push(v); return `{p${params.length}:Array(String)}`; };
 const phTs = (v: unknown) => { params.push(v); return `parseDateTime64BestEffort({p${params.length}:String}, 3)`; };

 const clickWhere: string[] = ['c.network_id = {p1:String}'];
 const convWhere: string[] = ['k.network_id = {p1:String}'];
 const f = req.filters;

 if (f.from) { clickWhere.push(`c.timestamp >= ${phTs(f.from)}`); convWhere.push(`k.timestamp >= ${phTs(f.from)}`); }
 if (f.to) { clickWhere.push(`c.timestamp <= ${phTs(f.to)}`); convWhere.push(`k.timestamp <= ${phTs(f.to)}`); }

 const addIn = (val: unknown, clickCol: string, convCol: string) => {
 if (val == null || val === '') return;
 const arr = Array.isArray(val) ? val : [val];
 if (arr.length === 0) return;
 clickWhere.push(`${clickCol} IN ${phArr(arr as unknown[])}`);
 convWhere.push(`${convCol} IN ${phArr(arr as unknown[])}`);
 };
 const addNe = (val: unknown, clickCol: string, convCol: string) => {
 if (val == null || val === '') return;
 clickWhere.push(`${clickCol} != ${ph(val)}`);
 convWhere.push(`${convCol} != ${ph(val)}`);
 };

 addIn(f.offerId, 'c.offer_id', 'k.offer_id');
 addIn(f.publisherId, 'c.publisher_id', 'k.publisher_id');
 addIn(f.advertiserId, 'c.advertiser_id', 'k.advertiser_id');
 addIn(f.smartLinkId, 'c.smart_link_id', 'k.smart_link_id');
 addIn(f.country, 'c.country', 'k.country');
 addIn(f.device, 'c.device', 'k.device');
 addIn(f.city, 'c.city', 'k.city');
 addIn(f.region, 'c.region', 'k.region');
 addIn(f.isp, 'c.isp', 'k.isp');
 addIn(f.browser, 'c.browser', 'k.browser');
 addIn(f.os, 'c.os', 'k.os');
 addIn(f.sub1, 'c.sub1', 'k.sub1');
 addIn(f.sub2, 'c.sub2', 'k.sub2');
 addIn(f.sub3, 'c.sub3', 'k.sub3');
 addIn(f.sub4, 'c.sub4', 'k.sub4');
 addIn(f.sub5, 'c.sub5', 'k.sub5');

 addNe(f.excludeOfferId, 'c.offer_id', 'k.offer_id');
 addNe(f.excludePublisherId, 'c.publisher_id', 'k.publisher_id');
 addNe(f.excludeAdvertiserId, 'c.advertiser_id', 'k.advertiser_id');
 addNe(f.excludeSmartLinkId, 'c.smart_link_id', 'k.smart_link_id');
 addNe(f.excludeCountry, 'c.country', 'k.country');
 addNe(f.excludeDevice, 'c.device', 'k.device');

 if (f.excludeInvalid) clickWhere.push('length(c.fraud_flags) = 0');

 const gbHas = gb.length > 0;
 const groupIdx = gb.map((_, i) => `d${i}`).join(', ');

 const ALL_METRICS: Metric[] = [
 'clicks','unique_clicks','invalid_clicks','avg_fraud_score',
 'conversions','total_conversions','payout','revenue',
 ];

 const clickSel = gb.map((d, i) => `${DIM_SQL_CLICK[d]} AS d${i}`).join(', ');
 const clickMetrics = ALL_METRICS.map(m => `${METRIC_CLICKS[m]} AS ${m}`).join(', ');
 const clicksCte =
 `SELECT ${gbHas ? clickSel + ',' : ''}${clickMetrics}
 FROM tracker.clicks c
 WHERE ${clickWhere.join(' AND ')}
 ${gbHas ? `GROUP BY ${groupIdx}` : ''}`;

 const convSel = gb.map((d, i) => `${DIM_SQL_CONV[d]} AS d${i}`).join(', ');
 const convMetrics = ALL_METRICS.map(m => `${METRIC_CONV[m]} AS ${m}`).join(', ');
 const conversionsCte =
 `SELECT ${gbHas ? convSel + ',' : ''}${convMetrics}
 FROM tracker.conversions k
 WHERE ${convWhere.join(' AND ')}
 ${gbHas ? `GROUP BY ${groupIdx}` : ''}`;

 const joinType = gbHas ? 'FULL OUTER JOIN' : 'CROSS JOIN';
 const onClause = gbHas
 ? 'ON ' + gb.map((_, i) => `COALESCE(toString(cl.d${i}), '\\0') = COALESCE(toString(cv.d${i}), '\\0')`).join(' AND ')
 : '';
 const dimSelect = gbHas
 ? gb.map((_, i) => `toString(COALESCE(cl.d${i}, cv.d${i})) AS d${i}`).join(', ') + ','
 : '';

 const derivedExpr: Record<string, string> = {
 cr: 'if(clicks > 0, round(conversions / clicks, 4), 0)',
 epc: 'if(clicks > 0, round(payout / clicks, 4), 0)',
 margin: 'revenue - payout',
 };
 const outerMetrics = req.metrics.map(m => {
 if (derivedExpr[m]) return `${derivedExpr[m]} AS ${m}`;
 return `${m}`;
 }).join(', ');

 const chronological = gbHas && gb.length === 1 && (gb[0] === 'day' || gb[0] === 'hour');
 const orderCol = req.orderBy ? ORDER_COL[req.orderBy] : (chronological ? 'd0' : 'clicks');
 const orderDir = req.orderDir
 ? (req.orderDir === 'asc' ? 'ASC' : 'DESC')
 : (chronological ? 'ASC' : 'DESC');

 const baseSql =
 `WITH cl AS (${clicksCte}), cv AS (${conversionsCte})
 SELECT ${dimSelect}
 COALESCE(cl.clicks, 0) AS clicks,
 COALESCE(cl.unique_clicks, 0) AS unique_clicks,
 COALESCE(cl.invalid_clicks, 0) AS invalid_clicks,
 COALESCE(cl.avg_fraud_score, 0) AS avg_fraud_score,
 COALESCE(cv.conversions, 0) AS conversions,
 COALESCE(cv.total_conversions, 0) AS total_conversions,
 COALESCE(cl.payout, 0) + COALESCE(cv.payout, 0) AS payout,
 COALESCE(cl.revenue, 0) + COALESCE(cv.revenue, 0) AS revenue,
 COALESCE(cl.revenue, 0) + COALESCE(cv.revenue, 0) - (COALESCE(cl.payout, 0) + COALESCE(cv.payout, 0)) AS margin,
 ${outerMetrics}
 FROM cl ${joinType} cv ${onClause}`;

 const qp: Record<string, unknown> = Object.fromEntries(
 params.map((v, i) => [`p${i + 1}`, v]),
 );
 const countSql = `SELECT COUNT(*)::UInt64 AS total FROM (${baseSql}) AS sub`;
 const countRes = await this.client.query({ query: countSql, query_params: qp, format: 'JSON' });
 const total = Number(((await countRes.json<{ total: number }>()) as { data: { total: number }[] }).data[0]?.total ?? 0);

 const pageParams = [...params, req.limit, req.offset];
 const pageSql = `${baseSql} ORDER BY ${orderCol} ${orderDir} LIMIT {p${params.length + 1}:UInt32} OFFSET {p${params.length + 2}:UInt32}`;
 const pageQp = Object.fromEntries(pageParams.map((v, i) => [`p${i + 1}`, v]));
 const res = await this.client.query({ query: pageSql, query_params: pageQp, format: 'JSON' });
 const rows = ((await res.json<Record<string, unknown>>()) as { data: Record<string, unknown>[] }).data;

 const out: ReportRow[] = rows.map((row) => {
 const dimensions: Record<string, string | null> = {};
 gb.forEach((d, i) => {
 const v = row[`d${i}`];
 dimensions[d] = v == null ? null : String(v);
 });
 const metrics: Record<string, string | number> = {};
 req.metrics.forEach((m) => {
 const v = row[m];
 if (v == null) return;
 if (m === 'avg_fraud_score') metrics[m] = Number(v);
 else if (['cr', 'epc'].includes(m)) metrics[m] = Number(v);
 else metrics[m] = String(v);
 });
 return { dimensions, metrics };
 });

 return { groupBy: gb, metrics: req.metrics, rows: out, total };
 }
}
