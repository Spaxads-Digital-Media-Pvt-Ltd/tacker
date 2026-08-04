/**
 * Parse + policy-restrict a report request (spec §9, §3A). The AUDIENCE decides which metrics and
 * dimensions are even allowed — publishers never get revenue/margin; advertisers never get payout
 * or publisher-identifying dimensions. `forceFilters` pins owner scope and CANNOT be overridden by
 * the caller (a publisher report is always filtered to their own publisher_id).
 */
import { z } from 'zod';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../http/pagination.js';
import type { Dimension, Metric, ReportRequest, ReportFilters } from './types.js';

export type ReportAudience = 'admin' | 'network' | 'publisher' | 'advertiser';

const ALL_DIMS: Dimension[] = ['offer', 'publisher', 'advertiser', 'country', 'device', 'day', 'hour', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'];
const ALL_METRICS: Metric[] = ['clicks', 'unique_clicks', 'conversions', 'cr', 'payout', 'revenue', 'margin', 'epc'];

const METRIC_POLICY: Record<ReportAudience, Metric[]> = {
  admin: ALL_METRICS,
  network: ALL_METRICS,
  publisher: ['clicks', 'unique_clicks', 'conversions', 'cr', 'payout', 'epc'], // NO revenue/margin
  advertiser: ['clicks', 'unique_clicks', 'conversions', 'cr', 'revenue'],      // NO payout/margin/epc
};

const DIM_POLICY: Record<ReportAudience, Dimension[]> = {
  admin: ALL_DIMS,
  network: ALL_DIMS,
  publisher: ['offer', 'country', 'device', 'day', 'hour', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'], // no advertiser
  advertiser: ['offer', 'country', 'device', 'day', 'hour'], // no publisher (identifying)
};

const MAX_GROUP_BY = 4;

export const reportQuerySchema = z.object({
  groupBy: z.string().optional(),
  metrics: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  offerId: z.string().uuid().optional(),
  publisherId: z.string().uuid().optional(),
  advertiserId: z.string().uuid().optional(),
  country: z.string().max(3).optional(),
  device: z.string().max(30).optional(),
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
    ...(raw.offerId ? { offerId: raw.offerId } : {}),
    ...(raw.publisherId ? { publisherId: raw.publisherId } : {}),
    ...(raw.advertiserId ? { advertiserId: raw.advertiserId } : {}),
    ...(raw.country ? { country: raw.country.toUpperCase() } : {}),
    ...(raw.device ? { device: raw.device } : {}),
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
