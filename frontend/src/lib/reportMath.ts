/**
 * Pure report math + formatting shared by every report page (re-exported from ReportPageKit).
 * No imports, no DOM — so `node --test` can exercise the real code (see lib/__tests__).
 */

/**
 * Money in a currency (ISO 4217, default USD). Falls back to "<CODE> 1,234.00" for a code Intl
 * doesn't know, so a bad currency on a row never breaks the table.
 */
export function money(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
export const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
/** The reporting `cr` metric — a 0–1 ratio (conversions ÷ clicks, see ReportView) — as a percentage
 * with 2 places, "2.87%"; no value reads "0.00%". The detail pages' General-tab stats share it. */
export const crPercent = (v: string | number | null | undefined): string => pct(Number(v ?? 0));

const EXPORT_RATIO = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
/**
 * A money ratio the browser calculates (CPC / CPA / RPC / RPA) as an export cell: 2 places rounded
 * exactly like the on-screen `money()` (Intl), with no symbol or grouping. `toFixed(2)` rounded the
 * binary float instead — 3.005 exported "3.00" while the table showed $3.01. Stored money and the
 * API's own EPC are exported as the API's exact values instead (lib/offerReport `exactMoney`,
 * lib/advertiserReport `apiEpc`), never through this.
 */
export function exportRatio(v: number): string {
  return EXPORT_RATIO.format(Number.isFinite(v) ? v : 0);
}
export const num = (v: string | number) => Number(v);

export function toIso(dateStr: string, endOfDay = false): string {
  return endOfDay ? `${dateStr}T23:59:59.999Z` : `${dateStr}T00:00:00.000Z`;
}
/**
 * The UTC calendar day `n` days before today. Report ranges are UTC days, so the step back is in
 * UTC too — stepping in local time and then formatting in UTC could land a day off near midnight.
 */
export function daysAgo(n: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
export function todayStr(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Per-row derived metrics from a `/api/reports` metrics bag. Approved conversions (`conversions`)
 * are the ones that carry payout/revenue, so every per-conversion ratio uses them: CVR and RPA
 * dividing by all-status `total_conversions` overstated CVR (it could pass 100%) and understated
 * RPA. Per-click ratios use valid (net) clicks.
 */
export function deriveRow(m: Record<string, string | number>) {
  const clicksGross = num(m['clicks'] ?? 0);
  const uniqueClicks = num(m['unique_clicks'] ?? 0);
  const invalidClicks = num(m['invalid_clicks'] ?? 0);
  const clicks = Math.max(0, clicksGross - invalidClicks); // net/valid clicks
  const dupClicks = Math.max(0, clicksGross - uniqueClicks);
  const totalCv = num(m['total_conversions'] ?? 0); // every status (pending/rejected too)
  const cv = num(m['conversions'] ?? 0); // approved only
  const payout = num(m['payout'] ?? 0);
  const revenue = num(m['revenue'] ?? 0);
  const margin = num(m['margin'] ?? 0);
  const fraudScore = num(m['avg_fraud_score'] ?? 0); // 0-100, avg of clicks.fraud_score for the group
  const epc = num(m['epc'] ?? 0); // real backend metric: payout / clicks
  return {
    clicksGross, clicks, uniqueClicks, dupClicks, invalidClicks, totalCv, cv, payout, revenue, margin, fraudScore, epc,
    cvr: clicks > 0 ? cv / clicks : 0,
    cpc: clicks > 0 ? payout / clicks : 0,
    cpa: cv > 0 ? payout / cv : 0,
    rpc: clicks > 0 ? revenue / clicks : 0,
    rpa: cv > 0 ? revenue / cv : 0,
    invalidPct: clicksGross > 0 ? invalidClicks / clicksGross : 0,
    marginPct: revenue > 0 ? margin / revenue : 0,
  };
}
export type DerivedRow = ReturnType<typeof deriveRow>;
