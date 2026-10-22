/**
 * My partners / My advertisers — the shapes the panels read (GET /api/my/…) and how they show money: one
 * amount per currency, never summed across currencies.
 */
import { money } from './platformBilling';

export type Money = Record<string, Partial<Record<'payout' | 'revenue' | 'margin', string>>>;
export interface Stats { clicks?: number; conversions?: number; payout?: string; revenue?: string; margin?: string; money_by_currency?: Money }
export interface Range { from: string; to: string; tz: string }
export interface LatestConversion {
  id: string; created_at: string; status: string; event_name: string | null; payout: string | null; revenue: string | null; currency: string | null;
  country: string | null; offer_id: string; offer_ref: number; offer_name: string; publisher_id: string | null; publisher_name: string | null;
}

/** "USD 4.00 · EUR 1.50" — one amount per currency. */
export function perCurrency(s: Stats | null | undefined, field: 'payout' | 'revenue' | 'margin'): string {
  const m = s?.money_by_currency ?? {};
  const parts = Object.entries(m).filter(([, v]) => v[field] !== undefined && Number(v[field]) !== 0).map(([c, v]) => money(v[field]!, c));
  return parts.length ? parts.join(' · ') : '—';
}
export const count = (n: number | undefined) => (n ?? 0).toLocaleString();
