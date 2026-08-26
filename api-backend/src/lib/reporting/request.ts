/**
 * Parse + policy-restrict a report request (spec §9, §3A). The AUDIENCE decides which metrics and
 * dimensions are even allowed — publishers never get revenue/margin; advertisers never get payout
 * or publisher-identifying dimensions. `forceFilters` pins owner scope and CANNOT be overridden by
 * the caller (a publisher report is always filtered to their own publisher_id).
 */
import { z } from 'zod';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../http/pagination.js';
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

export const reportQuerySchema = z.object({
  groupBy: z.string().optional(),
  metrics: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  // Comma-separated for a multi-value (IN-list) filter — one value works the same as before.
  offerId: z.string().max(2000).optional(),
  publisherId: z.string().max(2000).optional(),
  advertiserId: z.string().max(2000).optional(),
  smartLinkId: z.string().max(2000).optional(),
  country: z.string().max(2000).optional(),
  device: z.string().max(2000).optional(),
  city: z.string().max(2000).optional(),
  region: z.string().max(2000).optional(),
  isp: z.string().max(2000).optional(),
  browser: z.string().max(2000).optional(),
  os: z.string().max(2000).optional(),
  sub1: z.string().max(2000).optional(),
  sub2: z.string().max(2000).optional(),
  sub3: z.string().max(2000).optional(),
  sub4: z.string().max(2000).optional(),
  sub5: z.string().max(2000).optional(),
  excludeOfferId: z.string().uuid().optional(),
  excludePublisherId: z.string().uuid().optional(),
  excludeAdvertiserId: z.string().uuid().optional(),
  excludeSmartLinkId: z.string().uuid().optional(),
  excludeCountry: z.string().max(3).optional(),
  excludeDevice: z.string().max(30).optional(),
  excludeInvalid: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
  orderBy: z.string().optional(),
  orderDir: z.enum(['asc', 'desc']).optional(),
});

type RawQuery = z.infer<typeof reportQuerySchema>;

function csv<T extends string>(value: string | undefined, allowed: T[]): T[] {
  if (!value) return [];
  const set = new Set(allowed as string[]);
  return value.split(',').map((s) => s.trim()).filter((s) => set.has(s)) as T[];
}

/** A filter query param is one value or a comma-separated IN-list — normalize to FilterValue. */
function multi(value: string | undefined, upper = false): FilterValue | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (upper ? s.toUpperCase() : s));
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

export function buildReportRequest(
  networkId: string,
  raw: RawQuery,
  audience: ReportAudience,
  forceFilters: ReportFilters = {},
): ReportRequest {
  const allowedDims = DIM_POLICY[audience];
  const allowedMetrics = METRIC_POLICY[audience];

  const groupBy = csv<Dimension>(raw.groupBy, allowedDims).slice(0, MAX_GROUP_BY);
  const metricsReq = csv<Metric>(raw.metrics, allowedMetrics);
  const metrics = metricsReq.length ? metricsReq : allowedMetrics;

  const orderBy = raw.orderBy && (allowedMetrics as string[]).includes(raw.orderBy)
    ? (raw.orderBy as Metric) : undefined;

  // User filters first, then forced owner-scope filters win (cannot be overridden).
  const filters: ReportFilters = {
    ...(raw.from ? { from: raw.from } : {}),
    ...(raw.to ? { to: raw.to } : {}),
    ...(multi(raw.offerId) ? { offerId: multi(raw.offerId) } : {}),
    ...(multi(raw.publisherId) ? { publisherId: multi(raw.publisherId) } : {}),
    ...(multi(raw.advertiserId) ? { advertiserId: multi(raw.advertiserId) } : {}),
    ...(multi(raw.smartLinkId) ? { smartLinkId: multi(raw.smartLinkId) } : {}),
    ...(multi(raw.country, true) ? { country: multi(raw.country, true) } : {}),
    ...(multi(raw.device) ? { device: multi(raw.device) } : {}),
    ...(multi(raw.city) ? { city: multi(raw.city) } : {}),
    ...(multi(raw.region) ? { region: multi(raw.region) } : {}),
    ...(multi(raw.isp) ? { isp: multi(raw.isp) } : {}),
    ...(multi(raw.browser) ? { browser: multi(raw.browser) } : {}),
    ...(multi(raw.os) ? { os: multi(raw.os) } : {}),
    ...(multi(raw.sub1) ? { sub1: multi(raw.sub1) } : {}),
    ...(multi(raw.sub2) ? { sub2: multi(raw.sub2) } : {}),
    ...(multi(raw.sub3) ? { sub3: multi(raw.sub3) } : {}),
    ...(multi(raw.sub4) ? { sub4: multi(raw.sub4) } : {}),
    ...(multi(raw.sub5) ? { sub5: multi(raw.sub5) } : {}),
    ...(raw.excludeOfferId ? { excludeOfferId: raw.excludeOfferId } : {}),
    ...(raw.excludePublisherId ? { excludePublisherId: raw.excludePublisherId } : {}),
    ...(raw.excludeAdvertiserId ? { excludeAdvertiserId: raw.excludeAdvertiserId } : {}),
    ...(raw.excludeSmartLinkId ? { excludeSmartLinkId: raw.excludeSmartLinkId } : {}),
    ...(raw.excludeCountry ? { excludeCountry: raw.excludeCountry.toUpperCase() } : {}),
    ...(raw.excludeDevice ? { excludeDevice: raw.excludeDevice } : {}),
    ...(raw.excludeInvalid ? { excludeInvalid: true } : {}),
    ...forceFilters,
  };

  return {
    networkId,
    groupBy: groupBy.length ? groupBy : (['offer'] as Dimension[]),
    metrics,
    filters,
    limit: raw.limit,
    offset: raw.offset,
    ...(orderBy ? { orderBy } : {}),
    ...(raw.orderDir ? { orderDir: raw.orderDir } : {}),
  };
}
