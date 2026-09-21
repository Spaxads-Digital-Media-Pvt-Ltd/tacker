/**
 * Trackog-style report filter catalog.
 * Source of truth for every checkbox shown in Search Filter drawers, plus per-page defaults.
 * Keys marked `api` map to our reporting backend; others are UI-complete (shown, tracked, applied
 * as column visibility where possible) so the drawer matches Trackog 1:1.
 */

export type FilterKind = 'group' | 'metric' | 'column';

export interface FilterDef {
  key: string;
  label: string;
  kind: FilterKind;
  /** Backend dimension/metric key when supported; omit = UI-only for now. */
  api?: string;
}

/** Extra grouping dims shown on aggregate reports (Trackog top checkbox grid). */
export const EXTRA_GROUP_DIMS: FilterDef[] = [
  { key: 'landing_page_title', label: 'Landing Page Title', kind: 'group' },
  { key: 'smart_link_name', label: 'Smart Link Name', kind: 'group' },
  { key: 'coupon', label: 'Coupon', kind: 'group' },
  { key: 'country', label: 'Country', kind: 'group', api: 'country' },
  { key: 'date', label: 'Date', kind: 'group', api: 'day' },
  { key: 'currency', label: 'Currency', kind: 'group' },
  { key: 'smart_link_id', label: 'Smart Link ID', kind: 'group' },
  { key: 'source', label: 'Source', kind: 'group', api: 'sub1' },
  { key: 'device', label: 'Device', kind: 'group', api: 'device' },
  { key: 'hour', label: 'Hour', kind: 'group', api: 'hour' },
  { key: 'month', label: 'Month', kind: 'group' },
];

/** Full Group By catalog for Offer / Affiliate / Advertiser / Daily / Custom / Smart Link. */
export const GROUP_BY_ALL: FilterDef[] = [
  { key: 'offer_id', label: 'Offer ID', kind: 'group', api: 'offer' },
  { key: 'offer_title', label: 'Offer Title', kind: 'group', api: 'offer' },
  { key: 'offer_long_id', label: 'Offer Long ID', kind: 'group' },
  { key: 'offer_status', label: 'Offer Status', kind: 'group' },
  { key: 'referrer_offer_id', label: 'Referrer Offer ID', kind: 'group' },
  { key: 'referrer_offer_title', label: 'Referrer Offer Title', kind: 'group' },
  { key: 'affiliate_id', label: 'Affiliate ID', kind: 'group', api: 'publisher' },
  { key: 'affiliate_name', label: 'Affiliate Name', kind: 'group', api: 'publisher' },
  { key: 'affiliate_long_id', label: 'Affiliate Long ID', kind: 'group' },
  { key: 'affiliate_company', label: 'Affiliate Company', kind: 'group', api: 'publisher' },
  { key: 'advertiser_id', label: 'Advertiser ID', kind: 'group', api: 'advertiser' },
  { key: 'advertiser_name', label: 'Advertiser Name', kind: 'group', api: 'advertiser' },
  { key: 'advertiser_long_id', label: 'Advertiser Long ID', kind: 'group' },
  { key: 'advertiser_company', label: 'Advertiser Company', kind: 'group', api: 'advertiser' },
  { key: 'goal_id', label: 'Goal ID', kind: 'group' },
  { key: 'goal_title', label: 'Goal Title', kind: 'group' },
  { key: 'goal_value', label: 'Goal Value', kind: 'group' },
  { key: 'landing_page_title', label: 'Landing Page Title', kind: 'group' },
  { key: 'landing_page_id', label: 'Landing Page ID', kind: 'group' },
  { key: 'smart_link_name', label: 'Smart Link Name', kind: 'group' },
  { key: 'smart_link_id', label: 'Smart Link ID', kind: 'group' },
  { key: 'coupon', label: 'Coupon', kind: 'group' },
  { key: 'country', label: 'Country', kind: 'group', api: 'country' },
  { key: 'date', label: 'Date', kind: 'group', api: 'day' },
  { key: 'currency', label: 'Currency', kind: 'group' },
  { key: 'source', label: 'Source', kind: 'group', api: 'sub1' },
  { key: 'device', label: 'Device', kind: 'group', api: 'device' },
  { key: 'hour', label: 'Hour', kind: 'group', api: 'hour' },
  { key: 'month', label: 'Month', kind: 'group' },
];

/** Report Options (metrics) — Trackog full list. Only `api` ones hit /api/reports. */
export const REPORT_OPTIONS: FilterDef[] = [
  { key: 'clicks', label: 'Clicks', kind: 'metric', api: 'clicks' },
  { key: 'unique_clicks', label: 'Unique Clicks', kind: 'metric', api: 'unique_clicks' },
  { key: 'rejected_clicks', label: 'Rejected Clicks', kind: 'metric' },
  { key: 'gross_clicks', label: 'Gross Clicks', kind: 'metric' },
  { key: 'impressions', label: 'Impressions', kind: 'metric' },
  { key: 'rejected_impressions', label: 'Rejected Impressions', kind: 'metric' },
  { key: 'conversions_approved', label: 'Conversions (Approved)', kind: 'metric', api: 'conversions' },
  { key: 'pending_conversions', label: 'Pending Conversions', kind: 'metric' },
  { key: 'extended_conversions', label: 'Extended Conversions', kind: 'metric' },
  { key: 'cancelled_conversions', label: 'Cancelled Conversions', kind: 'metric' },
  { key: 'rejected_conversions', label: 'Rejected Conversions', kind: 'metric' },
  { key: 'gross_conversions', label: 'Gross Conversions', kind: 'metric' },
  { key: 'sampled_conversions', label: 'Sampled Conversions', kind: 'metric' },
  { key: 'payout', label: 'Payout', kind: 'metric', api: 'payout' },
  { key: 'pending_payout', label: 'Pending Payout', kind: 'metric' },
  { key: 'extended_payout', label: 'Extended Payout', kind: 'metric' },
  { key: 'cancelled_payout', label: 'Cancelled Payout', kind: 'metric' },
  { key: 'rejected_payout', label: 'Rejected Payout', kind: 'metric' },
  { key: 'gross_payout', label: 'Gross Payout', kind: 'metric' },
  { key: 'revenue', label: 'Revenue', kind: 'metric', api: 'revenue' },
  { key: 'pending_revenue', label: 'Pending Revenue', kind: 'metric' },
  { key: 'extended_revenue', label: 'Extended Revenue', kind: 'metric' },
  { key: 'cancelled_revenue', label: 'Cancelled Revenue', kind: 'metric' },
  { key: 'rejected_revenue', label: 'Rejected Revenue', kind: 'metric' },
  { key: 'gross_revenue', label: 'Gross Revenue', kind: 'metric' },
  { key: 'sampled_revenue', label: 'Sampled Revenue', kind: 'metric' },
  { key: 'sale_amount', label: 'Sale Amount', kind: 'metric' },
  { key: 'pending_sale_amount', label: 'Pending Sale Amount', kind: 'metric' },
  { key: 'extended_sale_amount', label: 'Extended Sale Amount', kind: 'metric' },
  { key: 'cancelled_sale_amount', label: 'Cancelled Sale Amount', kind: 'metric' },
  { key: 'rejected_sale_amount', label: 'Rejected Sale Amount', kind: 'metric' },
  { key: 'gross_sale_amount', label: 'Gross Sale Amount', kind: 'metric' },
  { key: 'profit', label: 'Profit', kind: 'metric', api: 'margin' },
  { key: 'cr', label: 'Conversion Rate (CR)', kind: 'metric', api: 'cr' },
  { key: 'ctr', label: 'Click Through Rate (CTR)', kind: 'metric' },
  { key: 'epc', label: 'Earning Per Click (EPC)', kind: 'metric', api: 'epc' },
];

/** Default metrics on every aggregate Trackog report. */
export const DEFAULT_METRICS = [
  'clicks',
  'conversions_approved',
  'payout',
  'revenue',
  'profit',
  'cr',
] as const;

export const CLICK_COLUMNS: FilterDef[] = [
  { key: 'click_id', label: 'Click ID', kind: 'column' },
  { key: 'offer_id', label: 'Offer ID', kind: 'column' },
  { key: 'offer_title', label: 'Offer Title', kind: 'column' },
  { key: 'affiliate_id', label: 'Affiliate ID', kind: 'column' },
  { key: 'affiliate_name', label: 'Affiliate Name', kind: 'column' },
  { key: 'affiliate_company', label: 'Affiliate Company', kind: 'column' },
  { key: 'smart_link_id', label: 'Smart Link ID', kind: 'column' },
  { key: 'advertiser_id', label: 'Advertiser ID', kind: 'column' },
  { key: 'advertiser_name', label: 'Advertiser Name', kind: 'column' },
  { key: 'advertiser_company', label: 'Advertiser Company', kind: 'column' },
  { key: 'landing_page_id', label: 'Landing Page ID', kind: 'column' },
  { key: 'source', label: 'Source', kind: 'column' },
  { key: 'ip', label: 'IP Address', kind: 'column' },
  { key: 'country', label: 'Country', kind: 'column' },
  { key: 'region', label: 'Region', kind: 'column' },
  { key: 'city', label: 'City', kind: 'column' },
  { key: 'isp', label: 'ISP', kind: 'column' },
  { key: 'device', label: 'Device', kind: 'column' },
  { key: 'browser', label: 'Browser', kind: 'column' },
  { key: 'os', label: 'Operating System', kind: 'column' },
  { key: 'user_agent', label: 'User Agent', kind: 'column' },
  { key: 'referer', label: 'Referer', kind: 'column' },
  { key: 'is_unique', label: 'Is Unique', kind: 'column' },
  { key: 'g1', label: 'G1', kind: 'column' },
  { key: 'g2', label: 'G2', kind: 'column' },
  { key: 'g3', label: 'G3', kind: 'column' },
  { key: 'g4', label: 'G4', kind: 'column' },
  { key: 'g5', label: 'G5', kind: 'column' },
  { key: 'g6', label: 'G6', kind: 'column' },
  { key: 'g7', label: 'G7', kind: 'column' },
  { key: 'g8', label: 'G8', kind: 'column' },
  { key: 'note', label: 'Note', kind: 'column' },
  { key: 'referrer_offer_id', label: 'Referrer Offer ID', kind: 'column' },
  { key: 'idfa', label: 'IDFA', kind: 'column' },
  { key: 'gaid', label: 'GAID', kind: 'column' },
  { key: 'app_name', label: 'App Name', kind: 'column' },
  { key: 'app_id', label: 'App ID', kind: 'column' },
  { key: 'creative_name', label: 'Creative Name', kind: 'column' },
  { key: 'currency', label: 'Currency', kind: 'column' },
  { key: 'revenue', label: 'Revenue', kind: 'column' },
  { key: 'payout', label: 'Payout', kind: 'column' },
  { key: 'brand', label: 'Brand', kind: 'column' },
  { key: 'is_rejected', label: 'Is Rejected', kind: 'column' },
  { key: 'proxy', label: 'Proxy', kind: 'column' },
  { key: 'connection_type', label: 'Connection Type', kind: 'column' },
  { key: 'proxy_country', label: 'Proxy Country', kind: 'column' },
  { key: 'latitude', label: 'Latitude', kind: 'column' },
  { key: 'longitude', label: 'Longitude', kind: 'column' },
  { key: 'erid', label: 'ERID', kind: 'column' },
  { key: 'gclid', label: 'Google Click ID', kind: 'column' },
  { key: 'fbclid', label: 'FB Click ID', kind: 'column' },
  { key: 'click_url', label: 'Click URL', kind: 'column' },
  { key: 'final_url', label: 'Final URL', kind: 'column' },
  { key: 'created_date', label: 'Created Date', kind: 'column' },
];

export const DEFAULT_CLICK_COLUMNS = [
  'click_id', 'offer_id', 'offer_title', 'affiliate_company', 'source',
  'ip', 'country', 'region', 'city', 'device', 'g1', 'created_date',
] as const;

export const CONVERSION_COLUMNS: FilterDef[] = [
  { key: 'conversion_id', label: 'Conversion ID', kind: 'column' },
  { key: 'click_id', label: 'Click ID', kind: 'column' },
  { key: 'offer_id', label: 'Offer ID', kind: 'column' },
  { key: 'offer_title', label: 'Offer Title', kind: 'column' },
  { key: 'affiliate_id', label: 'Affiliate ID', kind: 'column' },
  { key: 'affiliate_name', label: 'Affiliate Name', kind: 'column' },
  { key: 'affiliate_company', label: 'Affiliate Company', kind: 'column' },
  { key: 'advertiser_id', label: 'Advertiser ID', kind: 'column' },
  { key: 'advertiser_name', label: 'Advertiser Name', kind: 'column' },
  { key: 'advertiser_company', label: 'Advertiser Company', kind: 'column' },
  { key: 'goal_id', label: 'Goal ID', kind: 'column' },
  { key: 'goal_title', label: 'Goal Title', kind: 'column' },
  { key: 'goal_value', label: 'Goal Value', kind: 'column' },
  { key: 'transaction_id', label: 'Transaction ID', kind: 'column' },
  { key: 'status', label: 'Status', kind: 'column' },
  { key: 'landing_page_id', label: 'Landing Page ID', kind: 'column' },
  { key: 'landing_page_title', label: 'Landing Page Title', kind: 'column' },
  { key: 'type', label: 'Type', kind: 'column' },
  { key: 'payout', label: 'Payout', kind: 'column' },
  { key: 'revenue', label: 'Revenue', kind: 'column' },
  { key: 'method', label: 'Method', kind: 'column' },
  { key: 'note', label: 'Note', kind: 'column' },
  { key: 'created', label: 'Created', kind: 'column' },
  { key: 'source', label: 'Source', kind: 'column' },
  { key: 'ip', label: 'IP Address', kind: 'column' },
  { key: 'g1', label: 'G1', kind: 'column' },
];

export const DEFAULT_CONVERSION_COLUMNS = [
  'conversion_id', 'click_id', 'offer_title', 'affiliate_company',
  'goal_title', 'transaction_id', 'status', 'landing_page_title',
] as const;

export const POSTBACK_COLUMNS: FilterDef[] = [
  { key: 'log_id', label: 'Log ID', kind: 'column' },
  { key: 'conversion_id', label: 'Conversion ID', kind: 'column' },
  { key: 'offer_id', label: 'Offer ID', kind: 'column' },
  { key: 'offer_title', label: 'Offer Title', kind: 'column' },
  { key: 'status', label: 'Status', kind: 'column' },
  { key: 'postback_id', label: 'Postback ID', kind: 'column' },
  { key: 'affiliate_id', label: 'Affiliate ID', kind: 'column' },
  { key: 'affiliate_name', label: 'Affiliate Name', kind: 'column' },
  { key: 'affiliate_company', label: 'Affiliate Company', kind: 'column' },
  { key: 'advertiser_id', label: 'Advertiser ID', kind: 'column' },
  { key: 'advertiser_name', label: 'Advertiser Name', kind: 'column' },
  { key: 'advertiser_company', label: 'Advertiser Company', kind: 'column' },
  { key: 'full_url', label: 'Full URL', kind: 'column' },
  { key: 'request_body', label: 'Request Body', kind: 'column' },
  { key: 'response_body', label: 'Response Body', kind: 'column' },
  { key: 'attempts', label: 'Attempts', kind: 'column' },
  { key: 'latency', label: 'Latency', kind: 'column' },
  { key: 'created_at', label: 'Created At', kind: 'column' },
];

export const DEFAULT_POSTBACK_COLUMNS = [
  'log_id', 'conversion_id', 'offer_title', 'status', 'postback_id',
  'affiliate_company', 'full_url', 'response_body', 'latency', 'created_at',
] as const;

/** Per-page default Group By keys (Trackog defaults from screenshots). */
export const DEFAULT_GROUP_BY: Record<string, string[]> = {
  offer: ['offer_id', 'offer_title'],
  affiliate: ['affiliate_id', 'affiliate_name'],
  advertiser: ['advertiser_id', 'advertiser_name'],
  daily: ['date'],
  goals: ['offer_title', 'goal_title'],
  smartlink: ['offer_id', 'offer_title', 'smart_link_id', 'smart_link_name'],
  custom: ['offer_id', 'offer_title', 'affiliate_id', 'affiliate_name', 'smart_link_id', 'smart_link_name'],
};

/** Compact extra-dim grid used on Offer/Affiliate aggregate drawers (top section). */
export const COMPACT_EXTRA_DIMS = EXTRA_GROUP_DIMS;

/** Map selected UI group keys → unique backend dimensions (max 4). */
export function toApiGroupBy(keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const def = GROUP_BY_ALL.find((d) => d.key === k) ?? EXTRA_GROUP_DIMS.find((d) => d.key === k);
    const api = def?.api;
    if (api && !seen.has(api)) {
      seen.add(api);
      out.push(api);
    }
  }
  return out.slice(0, 4);
}

/** Map selected UI metric keys → backend metrics. */
export function toApiMetrics(keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const def = REPORT_OPTIONS.find((d) => d.key === k);
    const api = def?.api;
    if (api && !seen.has(api)) {
      seen.add(api);
      out.push(api);
    }
  }
  return out.length ? out : ['clicks'];
}

export function metricLabel(apiKey: string): string {
  const hit = REPORT_OPTIONS.find((d) => d.api === apiKey);
  return hit?.label ?? apiKey;
}

export function dimLabel(apiKey: string): string {
  const map: Record<string, string> = {
    offer: 'Offer', publisher: 'Affiliate', advertiser: 'Advertiser',
    country: 'Country', device: 'Device', day: 'Date', hour: 'Hour',
    sub1: 'Source', sub2: 'Sub2', sub3: 'Sub3', sub4: 'Sub4', sub5: 'Sub5',
  };
  return map[apiKey] ?? apiKey;
}
