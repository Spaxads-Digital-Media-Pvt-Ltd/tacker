/**
 * Flex Report (Analytics › Flex) — pure sort / export rules (no React / DOM, so `node --test` runs the
 * real code; see lib/__tests__/flexReport.test.ts). Used by pages/admin/analytics/FlexReport.tsx.
 * Exact export money / EPC reuse lib/offerReport (exactMoney) and lib/advertiserReport (apiEpc).
 */
import { exportRatio, pct, type DerivedRow } from './reportMath.ts';
import { exactMoney } from './offerReport.ts';
import { apiEpc } from './advertiserReport.ts';

/**
 * The API sort key behind each sortable column. "Clicks" shows net clicks (gross − invalid, see
 * reportMath `deriveRow`), so it sorts by the API's sort-only `valid_clicks` — not gross `clicks`.
 */
export const FLEX_COLUMN_SORT = {
  Clicks: 'valid_clicks', 'Total CV': 'total_conversions', Revenue: 'revenue', Payout: 'payout', Profit: 'margin',
} as const;
export type FlexOrderMetric = (typeof FLEX_COLUMN_SORT)[keyof typeof FLEX_COLUMN_SORT];
const FLEX_ORDER_METRICS = Object.values(FLEX_COLUMN_SORT) as FlexOrderMetric[];
export const DEFAULT_FLEX_ORDER: FlexOrderMetric = 'valid_clicks';

/**
 * The sort to apply from a URL `orderBy` or a saved report. `clicks` is what the Clicks column sent
 * before it sorted by net clicks — read as that column (`valid_clicks`) so old links and saved
 * reports keep sorting by the column they show; anything else unknown is the default.
 */
export function flexOrderBy(raw: string | null | undefined): FlexOrderMetric {
  if (raw === 'clicks') return 'valid_clicks';
  return (FLEX_ORDER_METRICS as string[]).includes(raw ?? '') ? (raw as FlexOrderMetric) : DEFAULT_FLEX_ORDER;
}

/**
 * One export row: the picked dimension columns (by label), then the metric columns. Clicks is the
 * net count the table shows; money is the exact decimal text the API returned and EPC the API's own
 * value (payout ÷ gross clicks) — never a float re-rounded with toFixed. RPA / CPA (calculated here)
 * use the screen's rounding (`exportRatio`).
 */
export function flexExportRow(
  dims: { label: string; name: string }[],
  d: DerivedRow,
  metrics: Record<string, string | number | undefined>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const { label, name } of dims) base[label] = name;
  return {
    ...base, clicks: d.clicks, totalCv: d.totalCv, rpa: exportRatio(d.rpa), cpa: exportRatio(d.cpa),
    cvr: pct(d.cvr), revenue: exactMoney(metrics, 'revenue'), payout: exactMoney(metrics, 'payout'),
    profit: exactMoney(metrics, 'margin'), margin: pct(d.marginPct), epc: apiEpc(metrics),
  };
}
