/**
 * The admin dashboard's data — existing endpoints only, every /api/reports* call with the report
 * zone's `tz`. Each section owns its query, so one failure never blanks the page; `useQuery` keeps
 * the previous data while a new range loads (no skeleton flash on refetch).
 *
 * First load (default range): settings · summary (current) · summary (previous) · graph ·
 * dashboard periods · top offers · top partners · top advertisers · recent changes = 9 requests
 * (+ GET /api/me, which useReportZone shares with every report page). Names come from the report
 * rows' `labels` — no entity-list fetches. The per-entity hourly trend loads only when expanded.
 */
import { useEffect } from 'react';
import { useQuery } from '../../lib/useApi';
import type { AggRow } from '../../shared-components/primitives/ReportPageKit';
import type { DashboardRange, Window } from './range';

const SUMMARY_METRICS = 'clicks,conversions,payout,revenue,margin,currencies,money_by_currency';
const GRAPH_METRICS = 'clicks,conversions,payout,revenue,margin,currencies';
const TOP_METRICS = 'clicks,conversions,revenue,currencies';

/** A report row with entity names (backend attachLabels): `labels[dim] = { ref, name }`. */
export interface LabeledRow extends AggRow {
  labels?: Record<string, { ref: number | null; name: string } | null>;
}
export interface ReportPage { rows: LabeledRow[]; total?: number; sortedWithinCurrency?: boolean }

const reportPath = (params: Record<string, string>) => `/api/reports?${new URLSearchParams(params).toString()}`;

/** The network's default currency — money without a currency of its own (no conversions) is in it. */
export function useDefaultCurrency(): string {
  const { data } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  return data?.general?.defaultCurrency ?? 'USD';
}

/** One grand-total row for a window (`groupBy=none`). */
export function useSummary(w: Window, tz: string) {
  return useQuery<ReportPage>(reportPath({ groupBy: 'none', metrics: SUMMARY_METRICS, from: w.from, to: w.to, tz, limit: '1' }));
}

/**
 * The window's hour / day rows. Today has ≤ 24 hours and the longest preset 90 days, so one page of
 * 200 holds every bucket (useGraphRows' paging isn't needed — and this one can be retried).
 */
export function useGraph(range: DashboardRange | null) {
  return useQuery<ReportPage>(range
    ? reportPath({ groupBy: range.bucket, metrics: GRAPH_METRICS, from: range.current.from, to: range.current.to, tz: range.tz, limit: '200' })
    : null);
}

/** Yesterday / This month / Last month (and today) per-period totals, in the zone. */
export interface PeriodTotals {
  clicks: Record<PeriodKey, number>;
  conversions: Record<PeriodKey, number>;
  revenue: Record<PeriodKey, string>;
  payout: Record<PeriodKey, string>;
  margin: Record<PeriodKey, string>;
  currencies?: Partial<Record<PeriodKey, unknown>>;
  moneyByCurrency?: Partial<Record<PeriodKey, unknown>>;
}
export type PeriodKey = 'today' | 'yesterday' | 'month' | 'lastMonth';
export function usePeriods(tz: string) {
  return useQuery<PeriodTotals>(`/api/reports/dashboard?${new URLSearchParams({ tz }).toString()}`);
}

export type EntityDim = 'offer' | 'publisher' | 'advertiser';
export type RankMetric = 'revenue' | 'clicks' | 'conversions';

/** Top 5 by `metric`, ranked by the server (per currency for revenue). */
export function useTop(dim: EntityDim, metric: RankMetric, w: Window, tz: string) {
  return useQuery<ReportPage>(reportPath({
    groupBy: dim, metrics: TOP_METRICS, orderBy: metric, orderDir: 'desc', limit: '5', from: w.from, to: w.to, tz,
  }));
}

const FILTER_KEY: Record<EntityDim, string> = { offer: 'offerId', publisher: 'publisherId', advertiser: 'advertiserId' };

/** One entity's hourly rows for today — only while its row is expanded (`id` null = idle). */
export function useEntityHours(dim: EntityDim, id: string | null, today: Window, tz: string) {
  return useQuery<ReportPage>(id
    ? reportPath({ groupBy: 'hour', metrics: TOP_METRICS, [FILTER_KEY[dim]]: id, from: today.from, to: today.to, tz, limit: '200' })
    : null);
}

/** The network's latest audit-log entries (GET /api/audit-log). */
export interface AuditRow {
  id: string; ref: number; operationTime: string; service: string; changes: string; isNew: boolean;
  employee: string; method: string; portal: string;
}

const POLL_MS = 30_000;

/**
 * Recent changes: refreshed every 30 s while the tab is visible (and once on becoming visible again);
 * no timer while hidden, none after unmount.
 */
export function useRecentChanges() {
  const q = useQuery<AuditRow[]>('/api/audit-log', { limit: 5 });
  const { refetch } = q;
  useEffect(() => {
    let timer: number | undefined;
    const start = () => { if (timer === undefined) timer = window.setInterval(refetch, POLL_MS); };
    const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { refetch(); start(); } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refetch]);
  return q;
}
