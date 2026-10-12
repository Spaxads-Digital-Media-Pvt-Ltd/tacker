/**
 * Conversion Report — pure display rules (no React / DOM, so `node --test` runs the real code; see
 * lib/__tests__/conversionReport.test.ts). Used by pages/admin/ConversionReport.tsx.
 */
import { money } from './reportMath.ts';

const DASH = '—';

/** Click → conversion time as "45s", "3m 20s", "26h 5m"; no originating click → "—". */
export function formatDelta(seconds: number | null | undefined): string {
  if (seconds == null) return DASH;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * A conversion's payout / revenue in the currency stored ON the conversion. A conversion recorded
 * without a currency is shown as a plain amount (with a note) — never formatted as an assumed USD.
 */
export function conversionMoney(value: string | null | undefined, currency: string | null | undefined): { text: string; title?: string } {
  if (value == null || value === '') return { text: DASH };
  const n = Number(value);
  if (!Number.isFinite(n)) return { text: value };
  const cur = (currency ?? '').trim();
  if (cur) return { text: money(n, cur) };
  return {
    text: n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    title: 'No currency was recorded on this conversion',
  };
}

/** The Currency cell / export value: the conversion's own currency, or "—" when none was recorded. */
export function conversionCurrency(currency: string | null | undefined): string {
  const cur = (currency ?? '').trim();
  return cur || DASH;
}

/**
 * Approve / reject move money in the ledger and the API allows them to the `admin` and `finance`
 * roles only (dashboard finance routes, requireRole('admin', 'finance')) — other roles get no
 * controls rather than buttons that fail with 403. Unknown role (still loading) → no controls.
 */
export function canModerateConversions(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'finance';
}
