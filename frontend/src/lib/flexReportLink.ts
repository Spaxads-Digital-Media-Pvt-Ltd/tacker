/**
 * Row ⋮ "Open Flex Report" links from the aggregate report pages (Offer/Partner/Advertiser/Smart
 * Link/Daily/Hourly). Pure — `node --test` runs it (lib/__tests__/flexReportLink.test.ts).
 *
 * Only params Flex reads back on load (FlexReport.tsx `readFlexUrl`) are written: the date range
 * (`from`/`to`), dimension filters and exclusions (`f.*`/`x.*`) and Ignore Fail Traffic. Metric
 * filters are left out — they apply to the source page's rows, not to Flex's grouping.
 */
import { IGNORE_FAIL_PARAM, writeUrlFilters } from './reportFilterState.ts';

export interface FlexLinkContext {
  /** Applied range, YYYY-MM-DD (UTC days). */
  from: string;
  to: string;
  /** The page's applied Reporting Filters (only the parts Flex can read are used). */
  reporting: { filters: Record<string, string[]>; exclusions: Record<string, string[]>; ignoreFailTraffic: boolean };
  /**
   * The clicked row's entity as `[category, id]` (Flex filter keys: offer / partner / advertiser /
   * smartLink). It replaces any filter the page had for that category, so Flex shows that one row.
   */
  entity?: [category: string, id: string];
}

export function flexReportPath({ from, to, reporting, entity }: FlexLinkContext): string {
  const p = new URLSearchParams();
  p.set('tab', 'flex');
  p.set('from', from);
  p.set('to', to);
  writeUrlFilters(p, 'f', entity ? { ...reporting.filters, [entity[0]]: [entity[1]] } : reporting.filters);
  writeUrlFilters(p, 'x', reporting.exclusions);
  if (reporting.ignoreFailTraffic) p.set(IGNORE_FAIL_PARAM, '1');
  return `/app/analytics?${p.toString()}`;
}
