/** Shared types/constants for Offers › Groups, matching the reference's real "Add Offer Group"
 * wizard field set: Currency, Labels/Notes, and an "Enable Caps" toggle guarding a
 * Click/Conversion/Payout/Revenue × Daily/Weekly/Monthly/Global cap matrix. */
export interface CapWindow { daily?: number | null; weekly?: number | null; monthly?: number | null; global?: number | null }
export interface Caps { clicks?: CapWindow; conversions?: CapWindow; payout?: CapWindow; revenue?: CapWindow }

export interface OfferGroup {
  id: string; ref: number; name: string; advertiserId: string | null; offerIds: string[];
  currency: string; labels: string | null; notes: string | null; status: string;
  capsEnabled: boolean; caps: Caps; createdAt: string; updatedAt: string;
  /**
   * Today's conversion money. `currencies` / `moneyByCurrency` (newer API): the conversions' own
   * currencies and the money split by currency — the stats are in THOSE currencies, not the group's
   * (`currency` is the group's own setting, used for its caps). Several → never one summed figure.
   */
  today?: { clicks: number; payout: string; revenue: string; currencies?: string[]; moneyByCurrency?: unknown };
}

export const CURRENCIES = [
  { value: 'USD', label: '$ US Dollar (USD)' },
  { value: 'EUR', label: '€ Euro (EUR)' },
  { value: 'GBP', label: '£ British Pound (GBP)' },
  { value: 'CAD', label: '$ Canadian Dollar (CAD)' },
];

export const CAP_TYPES = [
  { key: 'clicks', label: 'Click Caps' },
  { key: 'conversions', label: 'Conversion Caps' },
  { key: 'payout', label: 'Payout Caps' },
  { key: 'revenue', label: 'Revenue Caps' },
] as const;

export const TIME_INTERVALS = ['daily', 'weekly', 'monthly', 'global'] as const;
export const TIME_INTERVAL_LABEL: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', global: 'Global' };

export function fmtMoney(v: string | number | undefined): string {
  return `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}
