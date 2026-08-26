/**
 * Reporting interface (spec §9). Callers depend on THIS, never a concrete store, so ClickHouse can
 * replace Postgres at Phase 8 behind the same interface. Aggregation happens IN THE DATABASE —
 * never row-by-row in Node (spec §3B).
 */
export type Dimension =
  | 'offer' | 'publisher' | 'advertiser' | 'smartLink' | 'country' | 'device'
  | 'city' | 'region' | 'isp' | 'browser' | 'os'
  | 'day' | 'hour' | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5';

export type Metric =
  | 'clicks' | 'unique_clicks' | 'conversions' | 'cr' | 'payout' | 'revenue' | 'margin' | 'epc'
  | 'invalid_clicks' | 'total_conversions' | 'avg_fraud_score';

// Every include filter below accepts one value or several (an IN-list) — the Dimensional Report's
// "click row to filter" lets a user select multiple values within one dimension at once (spec-matched
// against the live reference), which needs `sub1 IN (...)` rather than just `sub1 = X`.
export type FilterValue = string | string[];

export interface ReportFilters {
  from?: string;         // ISO datetime (inclusive)
  to?: string;           // ISO datetime (inclusive)
  offerId?: FilterValue;
  publisherId?: FilterValue;
  advertiserId?: FilterValue;
  smartLinkId?: FilterValue;
  country?: FilterValue;
  device?: FilterValue;
  city?: FilterValue;
  region?: FilterValue;
  isp?: FilterValue;
  browser?: FilterValue;
  os?: FilterValue;
  sub1?: FilterValue;
  sub2?: FilterValue;
  sub3?: FilterValue;
  sub4?: FilterValue;
  sub5?: FilterValue;
  // "Exclusions" (Everflow's own term) — same dimensions as above, inverted.
  excludeOfferId?: string;
  excludePublisherId?: string;
  excludeAdvertiserId?: string;
  excludeSmartLinkId?: string;
  excludeCountry?: string;
  excludeDevice?: string;
  // "Others › Ignore Fail Traffic" — drop fraud-flagged clicks from click-side metrics entirely,
  // rather than just counting them separately (which invalid_clicks already does).
  excludeInvalid?: boolean;
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
  total: number; // total group count for this filter set, ignoring limit/offset (real COUNT, for pagination)
}

export interface ReportingProvider {
  runReport(req: ReportRequest): Promise<ReportResult>;
}
