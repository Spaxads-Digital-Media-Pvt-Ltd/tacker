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
/** What the KPI worker uses when a link leaves a setting empty (api-backend lib/smart-links/kpi.ts) — the
 * form starts from the same values, so a link behaves the same whether it was made here or via the API. */
export const KPI_DEFAULTS = { runFrequencyHours: 1, lookbackHours: 24, minClicks: 50 } as const;

/** One KPI scoring run of a smart link (Run Record) — GET /api/smart-links/:id/kpi-runs. Money is text. */
export interface KpiRunItem {
  itemId: string; offerId: string; offerName: string | null; clicks: number; conversions: number;
  payout: string; revenue: string; score: string | null; weight: number | null;
}
export interface KpiRun {
  id: string; ranAt: string; metric: 'CVR' | 'EPC' | 'Revenue'; lookbackHours: number; minClicks: number;
  /** false = no item qualified yet (min clicks + a score above zero) — /sl rotated evenly. */
  weighted: boolean; items: KpiRunItem[];
}

export function fmtMoney(v: string | number | undefined): string {
  return `$${Number(v ?? 0).toFixed(2)}`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}
