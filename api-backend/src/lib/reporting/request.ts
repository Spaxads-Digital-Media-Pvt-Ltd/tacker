/**
 * Parse + policy-restrict a report request (spec §9, §3A). The AUDIENCE decides which metrics and
 * dimensions are even allowed — publishers never get revenue/margin; advertisers never get payout
 * or publisher-identifying dimensions. `forceFilters` pins owner scope and CANNOT be overridden by
 * the caller (a publisher report is always filtered to their own publisher_id).
 */
import { z } from 'zod';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../http/pagination.js';
import { queryBool, queryDate } from '../http/query-params.js';
import type { Dimension, Metric, ReportRequest, ReportFilters, FilterValue } from './types.js';

export type ReportAudience = 'admin' | 'network' | 'publisher' | 'advertiser';

const ALL_DIMS: Dimension[] = ['offer', 'publisher', 'advertiser', 'smartLink', 'country', 'device', 'city', 'region', 'isp', 'browser', 'os', 'day', 'hour', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'];
const ALL_METRICS: Metric[] = ['clicks', 'unique_clicks', 'conversions', 'cr', 'payout', 'revenue', 'margin', 'epc', 'invalid_clicks', 'total_conversions', 'avg_fraud_score'];

const METRIC_POLICY: Record<ReportAudience, Metric[]> = {
  admin: ALL_METRICS,
  network: ALL_METRICS,
  publisher: ['clicks', 'unique_clicks', 'conversions', 'cr', 'payout', 'epc'], // NO revenue/margin
  advertiser: ['clicks', 'unique_clicks', 'conversions', 'cr', 'revenue'],      // NO payout/margin/epc
};

const DIM_POLICY: Record<ReportAudience, Dimension[]> = {
  admin: ALL_DIMS,
  network: ALL_DIMS,
  publisher: ['offer', 'country', 'device', 'city', 'region', 'isp', 'browser', 'os', 'day', 'hour', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'], // no advertiser
  advertiser: ['offer', 'country', 'device', 'city', 'region', 'isp', 'browser', 'os', 'day', 'hour'], // no publisher (identifying)
};

const MAX_GROUP_BY = 4;
const MAX_VALUES = 200;

const UUID = z.string().uuid();
/** One UUID or a comma-separated list of them — anything else is a 400 (never a uuid cast 500). */
const uuidCsv = z.string().max(40 * MAX_VALUES).refine(
  (v) => v.split(',').map((s) => s.trim()).filter(Boolean).every((s) => UUID.safeParse(s).success),
  { message: 'must be one or more comma-separated UUIDs' },
).optional();
/**
 * Text dimension values: `?city=a,b` (comma list) or repeated `?isp=Comcast, LLC&isp=Verizon` —
 * repeated params are taken literally, so values that contain a comma stay intact.
 */
const textList = z.preprocess(
  // Express's qs parser turns more than 20 repeated (or `key[]=`) params into an index-keyed object
  // ({ '0': 'a', '1': 'b', … }) instead of an array — read it back as the list it is.
  (v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => /^\d+$/.test(k))
    ? Object.entries(v as Record<string, unknown>).sort(([a], [b]) => Number(a) - Number(b)).map(([, x]) => x)
    : v),
  z.union([
    z.string().max(4000),
    z.array(z.string().max(500)).max(MAX_VALUES),
  ]).optional(),
);

export const reportQuerySchema = z.object({
  // "none" = a single grand-total row (summary tiles), otherwise a comma list of dimensions.
  groupBy: z.string().max(200).optional(),
  metrics: z.string().max(500).optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
  offerId: uuidCsv,
  publisherId: uuidCsv,
  advertiserId: uuidCsv,
  smartLinkId: uuidCsv,
  country: textList,
  device: textList,
  city: textList,
  region: textList,
  isp: textList,
  browser: textList,
  os: textList,
  sub1: textList,
  sub2: textList,
  sub3: textList,
  sub4: textList,
  sub5: textList,
  excludeOfferId: uuidCsv,
  excludePublisherId: uuidCsv,
  excludeAdvertiserId: uuidCsv,
  excludeSmartLinkId: uuidCsv,
  excludeCountry: textList,
  excludeDevice: textList,
  excludeInvalid: queryBool,
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
  orderBy: z.string().max(40).optional(),
  orderDir: z.enum(['asc', 'desc']).optional(),
}).refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(inclusiveTo(q.to)), { message: '`from` must not be after `to`', path: ['from'] });

type RawQuery = z.infer<typeof reportQuerySchema>;

/**
 * A date-only `to` (YYYY-MM-DD) means "through the end of that day" — as a bare date Postgres reads
 * it as midnight, which silently dropped the whole last day for API callers. Widened to the last
 * microsecond of the day (UTC — the pool pins the session TimeZone) so the existing inclusive `<=`
 * comparison covers the full day; a datetime `to` is passed through untouched.
 */
/** A date-only `from` is the start of that UTC day (explicit, so it never depends on the session zone). */
export function utcDayStart(from: string | undefined): string | undefined {
  if (from == null) return from;
  return /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : from;
}

export function inclusiveTo(to: string): string;
export function inclusiveTo(to: string | undefined): string | undefined;
export function inclusiveTo(to: string | undefined): string | undefined {
  if (to == null) return to;
  return /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999999Z` : to;
}

function csv<T extends string>(value: string | undefined, allowed: T[]): T[] {
  if (!value) return [];
  const set = new Set(allowed as string[]);
  return value.split(',').map((s) => s.trim()).filter((s) => set.has(s)) as T[];
}

/** A filter param is one value, a comma-separated list, or repeated params — normalize to FilterValue. */
function multi(value: string | string[] | undefined, upper = false): FilterValue | undefined {
  if (value == null || value === '') return undefined;
  const parts = (Array.isArray(value) ? value : value.split(','))
    .map((s) => s.trim()).filter(Boolean).map((s) => (upper ? s.toUpperCase() : s));
  const unique = Array.from(new Set(parts)).slice(0, MAX_VALUES);
  if (unique.length === 0) return undefined;
  return unique.length === 1 ? unique[0] : unique;
}

/** Which dimension each filter key reveals — a filter on a dimension the audience can't see is dropped. */
const FILTER_DIM: Record<string, Dimension> = {
  offerId: 'offer', publisherId: 'publisher', advertiserId: 'advertiser', smartLinkId: 'smartLink',
  country: 'country', device: 'device', city: 'city', region: 'region', isp: 'isp', browser: 'browser', os: 'os',
  sub1: 'sub1', sub2: 'sub2', sub3: 'sub3', sub4: 'sub4', sub5: 'sub5',
  excludeOfferId: 'offer', excludePublisherId: 'publisher', excludeAdvertiserId: 'advertiser',
  excludeSmartLinkId: 'smartLink', excludeCountry: 'country', excludeDevice: 'device',
};

export function buildReportRequest(
  networkId: string,
  raw: RawQuery,
  audience: ReportAudience,
  forceFilters: ReportFilters = {},
): ReportRequest {
  const allowedDims = DIM_POLICY[audience];
  const allowedMetrics = METRIC_POLICY[audience];

  const totalsOnly = raw.groupBy?.trim() === 'none';
  const groupBy = totalsOnly ? [] : csv<Dimension>(raw.groupBy, allowedDims).slice(0, MAX_GROUP_BY);
  const metricsReq = csv<Metric>(raw.metrics, allowedMetrics);
  const metrics = metricsReq.length ? metricsReq : allowedMetrics;

  const orderBy = raw.orderBy && (allowedMetrics as string[]).includes(raw.orderBy)
    ? (raw.orderBy as Metric) : undefined;

  const user: ReportFilters = {
    ...(raw.from ? { from: utcDayStart(raw.from) } : {}),
    ...(raw.to ? { to: inclusiveTo(raw.to) } : {}),
    offerId: multi(raw.offerId),
    publisherId: multi(raw.publisherId),
    advertiserId: multi(raw.advertiserId),
    smartLinkId: multi(raw.smartLinkId),
    country: multi(raw.country, true),
    device: multi(raw.device),
    city: multi(raw.city),
    region: multi(raw.region),
    isp: multi(raw.isp),
    browser: multi(raw.browser),
    os: multi(raw.os),
    sub1: multi(raw.sub1),
    sub2: multi(raw.sub2),
    sub3: multi(raw.sub3),
    sub4: multi(raw.sub4),
    sub5: multi(raw.sub5),
    excludeOfferId: multi(raw.excludeOfferId),
    excludePublisherId: multi(raw.excludePublisherId),
    excludeAdvertiserId: multi(raw.excludeAdvertiserId),
    excludeSmartLinkId: multi(raw.excludeSmartLinkId),
    excludeCountry: multi(raw.excludeCountry, true),
    excludeDevice: multi(raw.excludeDevice),
    ...(raw.excludeInvalid ? { excludeInvalid: true } : {}),
  };
  // Drop empty values, and any filter on a dimension this audience may not see (an advertiser
  // must not probe per-publisher volume by filtering on publisherId, even though the dimension
  // itself is hidden from them).
  const allowed = new Set<string>(allowedDims);
  const filters: ReportFilters = {};
  for (const [k, v] of Object.entries(user) as [keyof ReportFilters, unknown][]) {
    if (v === undefined) continue;
    const dim = FILTER_DIM[k];
    if (dim && !allowed.has(dim)) continue;
    (filters as Record<string, unknown>)[k] = v;
  }
  // Forced owner-scope filters win (cannot be overridden by the caller).
  Object.assign(filters, forceFilters);

  return {
    networkId,
    groupBy: totalsOnly ? [] : (groupBy.length ? groupBy : (['offer'] as Dimension[])),
    metrics,
    filters,
    limit: raw.limit,
    offset: raw.offset,
    ...(orderBy ? { orderBy } : {}),
    ...(raw.orderDir ? { orderDir: raw.orderDir } : {}),
  };
}
