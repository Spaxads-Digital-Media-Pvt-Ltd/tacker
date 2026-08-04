/**
 * Reporting interface (spec §9). Callers depend on THIS, never a concrete store, so ClickHouse can
 * replace Postgres at Phase 8 behind the same interface. Aggregation happens IN THE DATABASE —
 * never row-by-row in Node (spec §3B).
 */
export type Dimension =
  | 'offer' | 'publisher' | 'advertiser' | 'country' | 'device'
  | 'day' | 'hour' | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5';

export type Metric =
  | 'clicks' | 'unique_clicks' | 'conversions' | 'cr' | 'payout' | 'revenue' | 'margin' | 'epc';

export interface ReportFilters {
  from?: string;         // ISO datetime (inclusive)
  to?: string;           // ISO datetime (inclusive)
  offerId?: string;
  publisherId?: string;
  advertiserId?: string;
  country?: string;
  device?: string;
}

export interface ReportRequest {
  networkId: string;
  groupBy: Dimension[];
  metrics: Metric[];
  filters: ReportFilters;
  limit: number;
  offset: number;
  orderBy?: Metric;
  orderDir?: 'asc' | 'desc';
}

export interface ReportRow {
  dimensions: Record<string, string | null>;
  metrics: Record<string, string | number>;
}

export interface ReportResult {
  groupBy: Dimension[];
  metrics: Metric[];
  rows: ReportRow[];
}

export interface ReportingProvider {
  runReport(req: ReportRequest): Promise<ReportResult>;
}
