/**
 * The one money formatter for cards, chart tooltips and chart axes. Built on lib/reportCurrency's
 * `moneyText` (currency resolution, "Mixed", per-currency breakdowns) and lib/reportMath's `money`
 * (Intl currency formatting) — it adds only what those don't cover: money arriving as TEXT (API
 * decimals), missing values, and compact axis ticks. Never sums or compares across currencies:
 * every function formats ONE amount in ONE resolved currency.
 */
import { money } from './reportMath';
import { moneyText, type MoneyByCurrency, type MoneyField, type MoneyText, type RowCurrency } from './reportCurrency';

export type { MoneyText } from './reportCurrency';

/**
 * API money is a decimal string. Returns the number, `null` for a missing value (null / undefined
 * only), or NaN for text that isn't a number ('' included). A real zero ("0", "0.0000") is 0.
 */
export function parseMoney(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = v.trim();
  return s === '' ? NaN : Number(s);
}

const MISSING: MoneyText = { text: '—', muted: true };
const INVALID: MoneyText = { text: 'Invalid amount', muted: true };

/**
 * One amount in a row/total's resolved currency — `moneyText` for text-or-number input.
 *  - null / undefined → a muted "—" (no value; never shown as $0.00)
 *  - "0" / "0.0000" / 0 → "$0.00" in its currency (a real zero is a value)
 *  - non-numeric text → a muted "Invalid amount" (the API never sends one; it's not silently 0)
 */
export function moneyDisplay(
  value: string | number | null | undefined,
  rc: RowCurrency,
  opts: { breakdown?: MoneyByCurrency | null; field?: MoneyField; roomy?: boolean } = {},
): MoneyText {
  const n = parseMoney(value);
  if (rc.kind === 'mixed') return moneyText(n !== null && Number.isFinite(n) ? n : 0, rc, opts);
  if (n === null) return MISSING;
  if (!Number.isFinite(n)) return INVALID;
  return moneyText(n, rc, opts);
}

/**
 * One amount in a known single currency (an offer's payout, an invoice total). `decimals` fixes the
 * fraction digits for rates quoted finer than cents (e.g. an RPM to 3 places) — display only; the
 * value itself is never rounded before use. Missing / invalid values read as in moneyDisplay.
 */
export function moneyIn(value: string | number | null | undefined, currency: string, opts: { decimals?: number } = {}): MoneyText {
  if (opts.decimals === undefined) return moneyDisplay(value, { kind: 'single', currency });
  const n = parseMoney(value);
  if (n === null) return MISSING;
  if (!Number.isFinite(n)) return INVALID;
  return { text: moneyFixed(n, currency, opts.decimals), muted: false };
}

const fixedCache = new Map<string, Intl.NumberFormat | null>();

/** `n` in `currency` with exactly `decimals` fraction digits; "USD 1.500" for codes Intl rejects. */
function moneyFixed(n: number, currency: string, decimals: number): string {
  const key = `${currency}:${decimals}`;
  let f = fixedCache.get(key);
  if (f === undefined) {
    try { f = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
    catch { f = null; }
    fixedCache.set(key, f);
  }
  return f ? f.format(n) : `${currency} ${n.toFixed(decimals)}`;
}

const compactCache = new Map<string, Intl.NumberFormat>();

/** Short axis label in one currency: "$0", "$1.5K", "€2.3M". Falls back to "USD 1.5K" for codes Intl rejects. */
export function moneyAxisTick(value: number, currency: string): string {
  let f = compactCache.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
    } catch {
      f = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
      return `${currency} ${f.format(value)}`;
    }
    compactCache.set(currency, f);
  }
  return f.format(value);
}

/** Full-precision amount for a chart tooltip / data table cell in one currency. */
export function moneyExact(value: number, currency: string): string {
  return money(value, currency);
}
