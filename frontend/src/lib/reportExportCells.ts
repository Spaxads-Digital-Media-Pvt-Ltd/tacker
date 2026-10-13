/**
 * The money / ratio cells of an aggregate report's export row (Partner, Smart Link, Daily, Hourly,
 * Dynamic Nested) — pure, so `node --test` runs the real code (lib/__tests__/reportExportPrecision.test.ts).
 *
 * One rule: export each value as its source produced it.
 *  - Stored money (Payout / Revenue / Profit): the API's exact numeric text (lib/offerReport `exactMoney`).
 *  - EPC: the API's own value (payout ÷ gross clicks, 4 places — lib/advertiserReport `apiEpc`).
 *  - Ratios the browser calculates (CPC / CPA / RPC / RPA): `exportRatio` — the screen's rounding.
 * A mixed-currency row still has all of these blanked afterwards by lib/reportCurrency `withRowCurrency`.
 */
import { exportRatio, type DerivedRow } from './reportMath.ts';
import { exactMoney } from './offerReport.ts';
import { apiEpc } from './advertiserReport.ts';

type Metrics = Record<string, string | number | undefined>;

/**
 * `{ cpc, cpa, [epc], rpc, rpa, revenue, payout, profit }` in that order (CSV column order follows
 * key order). `epc` only when the report exports it (Partner).
 */
export function moneyExportCells(d: DerivedRow, metrics: Metrics, opts: { epc?: boolean } = {}): Record<string, string> {
  return {
    cpc: exportRatio(d.cpc), cpa: exportRatio(d.cpa),
    ...(opts.epc ? { epc: apiEpc(metrics) } : {}),
    rpc: exportRatio(d.rpc), rpa: exportRatio(d.rpa),
    revenue: exactMoney(metrics, 'revenue'), payout: exactMoney(metrics, 'payout'), profit: exactMoney(metrics, 'margin'),
  };
}
