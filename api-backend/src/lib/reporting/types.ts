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
  | 'invalid_clicks' | 'total_conversions' | 'avg_fraud_score'
  // Sorted DISTINCT non-null currencies of the approved conversions behind payout/revenue/margin —
  // money is summed as stored, so more than one entry means the row's money mixes currencies.
  // Opt-in only (never in the default metric set, never an orderBy).
  | 'currencies'
  // The same approved conversions' money split by currency: { [currency]: { payout?, revenue?, margin? } }
  // (numeric(14,4) text; only the fields the audience may see; NULL currency excluded; {} when none).
  // Opt-in only, never an orderBy.
  | 'money_by_currency';

/** One currency's share of a row's money — numeric(14,4) text, only the fields the audience may see. */
export interface CurrencyMoney { payout?: string; revenue?: string; margin?: string }
/** Money keyed by ISO currency code — never summed across keys (no FX). */
export type MoneyByCurrency = Record<string, CurrencyMoney>;
export type MoneyField = keyof CurrencyMoney;
export const MONEY_FIELDS: readonly MoneyField[] = ['payout', 'revenue', 'margin'];

/**
 * Orderable metrics whose value is money or derived from money (epc = payout / clicks). Sorting by
 * one never compares currencies: rows are partitioned single-currency (by currency code, then the
 * value) → no money → mixed/unknown-currency last, and the result carries `sortedWithinCurrency`.
 * Every other orderable metric (clicks, unique_clicks, conversions, cr, invalid_clicks,
 * total_conversions, avg_fraud_score) is a count/ratio/score and sorts as before.
 */
export const MONEY_SORT_METRICS: ReadonlySet<string> = new Set<Metric>(['payout', 'revenue', 'margin', 'epc']);

/**
 * Sort-only keys — an ORDER BY that isn't a returned metric. `valid_clicks` = clicks − invalid
 * (fraud-flagged) clicks: the "Clicks" column the admin reports display (lib/reportMath deriveRow),
 * so sorting that column orders by the number shown rather than by gross clicks.
 */
export const SORT_ONLY_KEYS = ['valid_clicks'] as const;
export type SortOnlyKey = typeof SORT_ONLY_KEYS[number];
export type OrderKey = Metric | SortOnlyKey;

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
  // One value or several; a row whose value is NULL (e.g. no smart link) is never excluded.
  excludeOfferId?: FilterValue;
  excludePublisherId?: FilterValue;
  excludeAdvertiserId?: FilterValue;
  excludeSmartLinkId?: FilterValue;
  excludeCountry?: FilterValue;
  excludeDevice?: FilterValue;
  // "Others › Ignore Fail Traffic" — drop fraud-flagged clicks from click-side metrics entirely,
  // rather than just counting them separately (which invalid_clicks already does).
  excludeInvalid?: boolean;
  /** Leave out the clicks /click rejected (never sent to the offer — lib/click-rejections): partner /
   * advertiser reports and the automation see only traffic that reached the offer. Admin reports keep
   * them, as invalid clicks. Set by the server (buildReportRequest for the portal audiences), never a
   * query param. */
  excludeRejected?: boolean;
}

export interface ReportRequest {
  networkId: string;
  groupBy: Dimension[];
  metrics: Metric[];
  filters: ReportFilters;
  limit: number;
  offset: number;
  orderBy?: OrderKey;
  orderDir?: 'asc' | 'desc';
  /**
   * Which money fields `money_by_currency` may carry — set from the audience policy by
   * buildReportRequest (publisher: payout; advertiser: revenue). When absent, only the money
   * metrics this request itself lists (fail-closed).
   */
  moneyFields?: MoneyField[];
  /** IANA time zone the `day` / `hour` dimensions bucket in (F-20); absent = UTC. */
  timeZone?: string;
}

export type MetricValue = string | number | string[] | MoneyByCurrency;

export interface ReportRow {
  dimensions: Record<string, string | null>;
  metrics: Record<string, MetricValue>;
  /** Names for the entity dimensions (offer / publisher / advertiser / smartLink) — F-20; set by the
   * report endpoints (lib/reporting/labels.ts) so pages needn't load whole entity lists to map ids. */
  labels?: Record<string, { ref: number | null; name: string } | null>;
}

export interface ReportResult {
  groupBy: Dimension[];
  metrics: Metric[];
  rows: ReportRow[];
  total: number; // total group count for this filter set, ignoring limit/offset (real COUNT, for pagination)
  /** Present (true) only when orderBy is a money metric — see MONEY_SORT_METRICS. */
  sortedWithinCurrency?: true;
}

/** The money fields `money_by_currency` carries for a request (see ReportRequest.moneyFields). */
export function moneyFieldsOf(req: Pick<ReportRequest, 'metrics' | 'moneyFields'>): MoneyField[] {
  const allowed = req.moneyFields ?? req.metrics.filter((m): m is MoneyField => (MONEY_FIELDS as string[]).includes(m));
  return MONEY_FIELDS.filter((f) => allowed.includes(f));
}

/** A decimal string from the store ('1.5', '-2', '3.14159') as numeric(14,4)-style text ('1.5000'). */
export function money4(v: unknown): string {
  const s = String(v ?? '0').trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = ''] = m;
  // Round half away from zero on the 5th decimal (pg's numeric(14,4) cast does the same).
  let units = BigInt((int || '0') + (frac + '0000').slice(0, 4));
  if ((frac[4] ?? '0') >= '5') units += 1n;
  const out = `${units / 10000n}.${(units % 10000n).toString().padStart(4, '0')}`;
  return sign && units !== 0n ? `-${out}` : out;
}

export interface ReportingProvider {
  runReport(req: ReportRequest): Promise<ReportResult>;
}
