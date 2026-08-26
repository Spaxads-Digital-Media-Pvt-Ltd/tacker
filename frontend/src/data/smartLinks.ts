/** Shared types/constants for Offers › Smart Links, matching the reference's real "Add Smart Link"
 * wizard field set: a Redirect Mechanism (KPI / Priority / Weight) instead of a plain rotation
 * toggle, a Catch-All Offer, and per-item Offer URL override + Position (Priority mechanism). */
export interface SmartLink {
  id: string; ref: number; name: string; status: string; labels: string | null;
  forceSsl: boolean; showToPartners: boolean; trackingDomainId: string | null;
  redirectMechanism: 'kpi' | 'priority' | 'weight'; catchAllOfferId: string | null;
  kpiRunFrequencyHours: number | null; kpiLookbackHours: number | null;
  kpiMetric: string | null; kpiMinClicks: number | null;
  todayRevenue?: string; createdAt: string; updatedAt: string;
}
export interface SmartLinkItem { id: string; offerId: string; weight: number; country: string | null; offerUrl: string | null; position: number | null }

export const REDIRECT_MECHANISMS = [
  { value: 'kpi', label: 'KPI' },
  { value: 'priority', label: 'Priority' },
  { value: 'weight', label: 'Weight' },
] as const;

export const KPI_METRICS = ['CVR', 'EPC', 'Revenue'] as const;
export const KPI_RUN_FREQUENCIES = [1, 6, 12, 24, 48] as const;
export const KPI_LOOKBACK_WINDOWS = [24, 48, 72, 168] as const;

export function fmtMoney(v: string | number | undefined): string {
  return `$${Number(v ?? 0).toFixed(2)}`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}
