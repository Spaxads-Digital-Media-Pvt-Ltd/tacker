/**
 * Saved report configs (localStorage, see ReportPageKit's loadSavedReports) → a link that reopens
 * the report WITH that config. Only params the target page reads from the URL on load are written:
 *
 *  - aggregate pages (Offer/Partner/Advertiser/Smart Link/Daily/Hourly): `from`, `to`, `f.*`, `x.*`,
 *    `mf.*`, `ignoreFail`, `orderBy`, `orderDir`
 *  - Flex (/app/analytics?tab=flex): the same plus `dims`
 *  - Nested (/app/analytics?tab=nested): the same plus `parent` / `child`
 *
 * Hidden columns aren't URL state on any of them, so they aren't carried (the page's own Load menu
 * still applies them).
 */
import { cleanFilterValues, IGNORE_FAIL_PARAM, writeUrlFilters, writeUrlMetricFilters, type UrlMetricFilters } from './reportFilterState.ts';

export type SavedReportKind = 'aggregate' | 'flex' | 'nested';
export interface SavedReportSource { key: string; label: string; route: string; kind: SavedReportKind }

/** Every page that saves report configs, by its localStorage key (`tracker.savedReports.<key>`). */
export const SAVED_REPORT_SOURCES: readonly SavedReportSource[] = [
  { key: 'offer-report', label: 'Offer', route: '/app/reports/offer', kind: 'aggregate' },
  { key: 'partner-report', label: 'Partner', route: '/app/reports/partner', kind: 'aggregate' },
  { key: 'advertiser-report', label: 'Advertiser', route: '/app/reports/advertiser', kind: 'aggregate' },
  { key: 'smartlink-report', label: 'Smart Link', route: '/app/reports/smartlink', kind: 'aggregate' },
  { key: 'daily-report', label: 'Daily', route: '/app/reports/daily', kind: 'aggregate' },
  { key: 'hourly-report', label: 'Hourly', route: '/app/reports/hourly', kind: 'aggregate' },
  { key: 'flex-report', label: 'Flex', route: '/app/analytics?tab=flex', kind: 'flex' },
  { key: 'nested-report', label: 'Nested', route: '/app/analytics?tab=nested', kind: 'nested' },
];

/** The saved-config fields a link can carry (everything is optional / unchecked: it's stored data). */
export interface SavedReportLinkConfig {
  from?: unknown; to?: unknown;
  filters?: unknown; exclusions?: unknown; metricFilters?: unknown;
  ignoreFailTraffic?: unknown; orderBy?: unknown; orderDir?: unknown;
  dims?: unknown; parentDim?: unknown; childDim?: unknown;
}

const nonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** `route` (which may already carry a query, e.g. `?tab=flex`) + the saved config as URL params. */
export function savedReportHref(source: Pick<SavedReportSource, 'route' | 'kind'>, config: SavedReportLinkConfig): string {
  const q = source.route.indexOf('?');
  const path = q < 0 ? source.route : source.route.slice(0, q);
  const next = new URLSearchParams(q < 0 ? '' : source.route.slice(q + 1));

  if (nonEmptyStr(config.from)) next.set('from', config.from);
  if (nonEmptyStr(config.to)) next.set('to', config.to);
  if (source.kind === 'flex' && Array.isArray(config.dims)) {
    const dims = config.dims.filter(nonEmptyStr);
    if (dims.length) next.set('dims', dims.join(','));
  }
  if (source.kind === 'nested') {
    if (nonEmptyStr(config.parentDim)) next.set('parent', config.parentDim);
    if (nonEmptyStr(config.childDim)) next.set('child', config.childDim);
  }
  writeUrlFilters(next, 'f', cleanFilterValues(config.filters));
  writeUrlFilters(next, 'x', cleanFilterValues(config.exclusions));
  if (config.metricFilters && typeof config.metricFilters === 'object') {
    // writeUrlMetricFilters drops non-numeric values; anything not shaped { op, value } is skipped here.
    const mf: UrlMetricFilters = {};
    for (const [k, e] of Object.entries(config.metricFilters as Record<string, unknown>)) {
      if (!e || typeof e !== 'object') continue;
      const { op, value } = e as { op?: unknown; value?: unknown };
      if ((op === '>' || op === '>=' || op === '<' || op === '<=') && (typeof value === 'string' || typeof value === 'number')) {
        mf[k] = { op, value: String(value) };
      }
    }
    writeUrlMetricFilters(next, mf);
  }
  if (config.ignoreFailTraffic === true) next.set(IGNORE_FAIL_PARAM, '1');
  if (nonEmptyStr(config.orderBy)) next.set('orderBy', config.orderBy);
  if (config.orderDir === 'asc' || config.orderDir === 'desc') next.set('orderDir', config.orderDir);

  const s = next.toString();
  return s ? `${path}?${s}` : path;
}
