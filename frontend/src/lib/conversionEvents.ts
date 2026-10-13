/**
 * Customer Value › Conversion Events Report — pure row / export rules (no React / DOM, so
 * `node --test` runs the real code; see lib/__tests__/conversionEvents.test.ts). Used by
 * pages/admin/CustomerValueConversionEvents.tsx.
 *
 * Money follows the Conversion report's rule (lib/conversionReport): shown in the currency stored
 * on the conversion — a conversion without one is a plain amount, never an assumed "$" — and
 * exported as the API's exact decimal text with a `currency` column.
 */
import { conversionCurrency } from './conversionReport.ts';
import { pageThrough } from './reportPaging.ts';

const DASH = '—';

export interface ConversionEvent {
  conversionId: string; createdAt: string; offerId: string; offerName: string;
  eventName: string | null; status: string; payout: string | null; revenue: string | null;
  /** The currency stored on the conversion (null when none was recorded). */
  currency?: string | null;
  dataPoints: { name: string; parameterKey: string; value: string }[];
  ruleName: string | null;
}

/** "MM/DD/YYYY HH:MM:SS", UTC. */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * One export row. Column order is the report's existing one, with `currency` added last; payout /
 * revenue are the API's exact text ("0.0015"), "—" when the conversion has none.
 */
export function eventExportRow(e: ConversionEvent): Record<string, string> {
  return {
    conversionId: e.conversionId, created: formatEventTime(e.createdAt), offer: e.offerName, event: e.eventName ?? DASH,
    status: e.status, payout: e.payout ?? DASH, revenue: e.revenue ?? DASH,
    dataPoints: e.dataPoints.map((dp) => `${dp.name}=${dp.value}`).join('; '), ruleApplied: e.ruleName ?? DASH,
    currency: conversionCurrency(e.currency),
  };
}

/** The API's page ceiling for /api/customer-value/conversion-events (limit ≤ 500). */
export const EVENTS_PAGE_SIZE = 500;

/**
 * Every event matching the applied User ID + date range, page by page (newest first; the API breaks
 * timestamp ties, so pages never overlap) up to `cap`. A failed page rejects — the caller shows the
 * error and writes no file, never a silently partial export.
 */
export function loadAllEvents(
  getPage: (limit: number, offset: number) => Promise<ConversionEvent[]>,
  cap: number,
): Promise<{ rows: ConversionEvent[]; capped: boolean }> {
  return pageThrough(getPage, EVENTS_PAGE_SIZE, cap).then(({ rows, capped }) => ({ rows, capped }));
}
