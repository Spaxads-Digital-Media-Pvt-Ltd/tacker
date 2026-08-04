/**
 * 24h KPI summary — the numbers behind the dashboard overview tiles. Reuses the reporting provider
 * with an empty groupBy (grand total) so the figures match the Reports screens, and applies the same
 * audience metric policy: publishers never get revenue/margin, advertisers never get payout/margin/epc.
 * Owner scope is pinned via forceFilters (a publisher summary is always their own publisher_id).
 */
import { getReportingProvider } from './index.js';
import type { ReportAudience } from './request.js';
import type { Metric, ReportFilters } from './types.js';

const METRICS_BY_AUDIENCE: Record<ReportAudience, Metric[]> = {
  admin: ['clicks', 'conversions', 'cr', 'payout', 'revenue', 'margin', 'epc'],
  network: ['clicks', 'conversions', 'cr', 'payout', 'revenue', 'margin', 'epc'],
  publisher: ['clicks', 'conversions', 'cr', 'payout', 'epc'],
  advertiser: ['clicks', 'conversions', 'cr', 'revenue'],
};

export interface KpiSummary {
  clicks: number;
  conversions: number;
  cr: number;
  payout?: string;
  revenue?: string;
  margin?: string;
  epc?: number;
}

export async function summary24h(
  networkId: string, audience: ReportAudience, forceFilters: ReportFilters = {},
): Promise<KpiSummary> {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const metrics = METRICS_BY_AUDIENCE[audience];
  const result = await getReportingProvider().runReport({
    networkId, groupBy: [], metrics, filters: { from, ...forceFilters }, limit: 1, offset: 0,
  });
  const m = result.rows[0]?.metrics ?? {};
  const num = (k: string) => Number(m[k] ?? 0);
  const str = (k: string) => (m[k] == null ? undefined : String(m[k]));
  const out: KpiSummary = { clicks: num('clicks'), conversions: num('conversions'), cr: num('cr') };
  if ('payout' in m) out.payout = str('payout');
  if ('revenue' in m) out.revenue = str('revenue');
  if ('margin' in m) out.margin = str('margin');
  if ('epc' in m) out.epc = num('epc');
  return out;
}
