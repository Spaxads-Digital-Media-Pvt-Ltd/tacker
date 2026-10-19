/**
 * Analytics › Flex — verified against the live reference (URL `/analytics/flex`, real data: 15 rows
 * grouped by Offer × Partner). Structurally this is the same real 21-tile Summary grid + collapsible
 * Performance Graph + Detailed Report shell used by every "Reporting › X" page (ReportPageKit.tsx),
 * but the Detailed Report groups by up to 4 user-picked dimensions at once instead of one fixed
 * dimension — this app's reporting engine already supports multi-dimension `groupBy` (used internally
 * by the old generic Custom Report), so "Flex" is that same real capability with a dedicated,
 * reference-matched page instead of the old generic drawer UI.
 *
 * "Add Columns" picks which dimensions become table columns (Offer, Partner, Advertiser, Smart Link,
 * Country, Device, City, Region, ISP, OS, Browser, Sub1-5 — the same real dimension set added for
 * Analytics › Dimensional, DimensionalReport.tsx). The reference caps this picker at 10 and organizes
 * it into categories (Account/Device/Geolocation/Misc/Offer/User Management); this app's reporting
 * engine caps multi-dimension `groupBy` at 4 (MAX_GROUP_BY, api-backend/src/lib/reporting/request.ts)
 * — the picker here is capped at 4 for real rather than accepting picks the backend would silently
 * truncate. The reference's "Add Customer Value Metrics" section is omitted entirely: this app has no
 * customer-level LTV/event data (matches Customer Value's own nav entries — Custom Data Points,
 * Conversion Events Report — which are inert placeholders elsewhere in the app for the same reason).
 *
 * The Detailed Report's metric columns (Clicks, Total CV, RPA, CPA, CVR, Revenue, Payout, Profit,
 * Margin, EPC) are the reference's own fixed default set, not user-configurable there either — all
 * real, derived via the same `deriveRow` used by every other report page. Money is in each row's own
 * currency (`currencies` — lib/reportCurrency): a row mixing currencies shows "Mixed", the Summary
 * shows per-currency amounts, and mixed revenue isn't plotted — never a cross-currency sum.
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced),
 * columns / Reporting Filters / chips / sort immediately. The applied report is mirrored to the
 * address bar (keeping `tab=flex`), so the URL itself is the shareable link.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreVertical, Plus, Search, X } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { uaDimensionLabel } from '../../../lib/userAgentDisplay';
import { PageHeader, Spinner, StateBlock, PromptModal } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../../shared-components/primitives/TableActionsKit';
import {
  type AggResult, type AggRow, METRICS_PARAM, DASH, DEVICE_OPTIONS, pct, num,
  deriveRow, type DerivedRow, MiniChart, SummaryGrid, Pagination,
  type MetricFilters, METRIC_FILTER_FIELDS, passesMetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
  type ReportingFiltersValue, EMPTY_REPORTING_FILTERS, reportingChips, withoutReportingChip,
  type SavedReportConfig, loadSavedReports, persistSavedReports,
  fetchAllPages, useReportExport, ExportStatus,
  useGraphRows, GraphCappedNote,
} from '../../../shared-components/primitives/ReportPageKit';
import { useServerSavedReports } from '../../../lib/savedReports';
import {
  readUrlFilters, writeUrlFilters, readUrlDate, readUrlIds, readUrlMetricFilters, writeUrlMetricFilters,
  IGNORE_FAIL_PARAM, readUrlFlag,
} from '../../../lib/reportFilterState';
import { useReportOpts, type Opts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { ActiveFilterChips } from '../../../shared-components/primitives/ActiveFilterChips';
import { useAutoDateRange } from '../reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../../shared-components/primitives/reportControl';
import {
  combineCurrencies, combineMoneyByCurrency, currenciesOf, filterWithMoneyRule, hasMoneyFilter, isMixed, mixedTitle, moneyByCurrencyOf,
  moneyFilterBlockedBy, resolveCurrency, showSortedWithinNote, withBreakdownMetrics, withCurrenciesMetric, withRowCurrency, type RowCurrency,
} from '../../../lib/reportCurrency';
import { CurrencyNotes, Money, MoneyPct } from '../../../shared-components/primitives/ReportMoney';
import { FLEX_COLUMN_SORT, flexExportRow, flexOrderBy, type FlexOrderMetric } from '../../../lib/flexReport';
import { bucketLabel } from '../../../lib/reportTime';
import { useReportZone, type ZoneDays } from '../../../lib/useReportZone';

interface SmartLink { id: string; name: string }

const DIM_OPTIONS = [
  { key: 'offer', label: 'Offer' },
  { key: 'publisher', label: 'Partner' },
  { key: 'advertiser', label: 'Advertiser' },
  { key: 'smartLink', label: 'Smart Link' },
  { key: 'country', label: 'Country' },
  { key: 'device', label: 'Device' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'Region' },
  { key: 'isp', label: 'ISP' },
  { key: 'os', label: 'OS' },
  { key: 'browser', label: 'Browser' },
  { key: 'sub1', label: 'Sub1' },
  { key: 'sub2', label: 'Sub2' },
  { key: 'sub3', label: 'Sub3' },
  { key: 'sub4', label: 'Sub4' },
  { key: 'sub5', label: 'Sub5' },
] as const;
type DimKey = (typeof DIM_OPTIONS)[number]['key'];
const MAX_DIMS = 4;

const METRIC_COLUMNS = ['Clicks', 'Total CV', 'RPA', 'CPA', 'CVR', 'Revenue', 'Payout', 'Profit', 'Margin', 'EPC'] as const;
// Each sortable column's API sort key (lib/flexReport): Clicks → `valid_clicks`, the net count it shows.
type OrderMetric = FlexOrderMetric;

function resolveName(dim: DimKey, id: string | null, opts: Opts, smartLinkMap: Map<string, string>): string {
  if (id == null) return DASH;
  if (dim === 'offer') { const m = opts.offerMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'publisher') { const m = opts.pubMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'advertiser') { const m = opts.advMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'smartLink') return smartLinkMap.get(id) ?? id.slice(0, 8) + '…';
  return uaDimensionLabel(dim, bucketLabel(dim, id)); // Day / Hour: the bucket's own local day / hour
}

function linkFor(dim: DimKey, id: string): string | null {
  if (dim === 'offer') return `/app/offers/${id}`;
  if (dim === 'publisher') return `/app/publishers/${id}`;
  if (dim === 'advertiser') return `/app/advertisers/${id}`;
  if (dim === 'smartLink') return `/app/smart-links/${id}`;
  return null;
}

/** One row's metric cells — only the shown columns (matching the header), money in the row's currency. */
function metricCells(shown: Set<string>, d: DerivedRow, rc: RowCurrency) {
  return (
    <>
      {shown.has('Clicks') && <td className="px-4 py-3 text-right">{d.clicks.toLocaleString()}</td>}
      {shown.has('Total CV') && <td className="px-4 py-3 text-right">{d.totalCv.toLocaleString()}</td>}
      {shown.has('RPA') && <td className="px-4 py-3 text-right"><Money value={d.rpa} rc={rc} /></td>}
      {shown.has('CPA') && <td className="px-4 py-3 text-right"><Money value={d.cpa} rc={rc} /></td>}
      {shown.has('CVR') && <td className="px-4 py-3 text-right">{pct(d.cvr)}</td>}
      {shown.has('Revenue') && <td className="px-4 py-3 text-right"><Money value={d.revenue} rc={rc} /></td>}
      {shown.has('Payout') && <td className="px-4 py-3 text-right"><Money value={d.payout} rc={rc} /></td>}
      {shown.has('Profit') && <td className="px-4 py-3 text-right"><Money value={d.margin} rc={rc} /></td>}
      {shown.has('Margin') && <td className="px-4 py-3 text-right"><MoneyPct value={d.marginPct} rc={rc} /></td>}
      {shown.has('EPC') && <td className="px-4 py-3 text-right"><Money value={d.epc} rc={rc} /></td>}
    </>
  );
}

type SavedConfig = SavedReportConfig<OrderMetric> & { dims: DimKey[] };

const DEFAULT_DIMS: DimKey[] = ['offer', 'publisher'];

/**
 * Initial report state from the URL — what the page mirrors to the address bar (`from`, `to`, `dims`,
 * `f.*`/`x.*`, `mf.*`, `ignoreFail`, `orderBy`/`orderDir`) plus the legacy deep-link ids the
 * Offer/Partner/Advertiser/Smart Link/Event report pages send ("Open Flex Report").
 */
function readFlexUrl(zone: ZoneDays) {
  const sp = new URLSearchParams(window.location.search);
  const filters = readUrlFilters(sp, 'f');
  const deepLinks: [string, string[]][] = [
    ['offer', readUrlIds(sp, 'offerId')],
    ['partner', readUrlIds(sp, 'publisherId', 'partnerId')],
    ['advertiser', readUrlIds(sp, 'advertiserId')],
    ['smartLink', readUrlIds(sp, 'smartLinkId')],
  ];
  for (const [k, ids] of deepLinks) if (ids.length && !filters[k]?.length) filters[k] = ids;
  const urlDims = (sp.get('dims') ?? '').split(',').filter((d): d is DimKey => DIM_OPTIONS.some((o) => o.key === d));
  let from = readUrlDate(sp, 'from', zone.daysAgo(7));
  const to = readUrlDate(sp, 'to', zone.today());
  if (from > to) from = to;
  return {
    from, to, filters,
    exclusions: readUrlFilters(sp, 'x'),
    metricFilters: readUrlMetricFilters<MetricFilters>(sp, METRIC_FILTER_FIELDS.map((f) => f.key)),
    ignoreFail: readUrlFlag(sp, IGNORE_FAIL_PARAM),
    dims: urlDims.length ? Array.from(new Set(urlDims)).slice(0, MAX_DIMS) : DEFAULT_DIMS,
    orderBy: flexOrderBy(sp.get('orderBy')),
    orderDir: (sp.get('orderDir') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
  };
}

export default function FlexReport() {
  const opts = useReportOpts();
  const smartLinkMap = useMemo(() => new Map(opts.smartLinks?.map((s: { value: string; label: string }) => [s.value, s.label]) ?? []), [opts.smartLinks]);

  const [searchParams, setSearchParams] = useSearchParams();
  // D7: the report's time zone — the network's unless one is picked beside the dates: its days,
  // "today" and the presets; requests send plain dates + tz.
  const zone = useReportZone();
  const [init] = useState(() => readFlexUrl(zone));
  // Dates apply on their own once they form a valid range (see useAutoDateRange); columns, Reporting
  // Filters and sort apply immediately and return to page 1. `page` lives with the range, so a new
  // range and the page reset land in one render (one request).
  const range = useAutoDateRange(init.from, init.to);
  const { appliedFrom, appliedTo, page, setPage, toFirstPage } = range;
  const [dims, setDims] = useState<DimKey[]>(init.dims);
  const [dimPickerOpen, setDimPickerOpen] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(init.filters);
  const [exclusions, setExclusions] = useState<FilterValues>(init.exclusions);
  const [metricFilters, setMetricFilters] = useState<MetricFilters>(init.metricFilters);
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(init.ignoreFail);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [orderBy, setOrderBy] = useState<OrderMetric>(init.orderBy);
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>(init.orderDir);
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Page ⋮ menu: Save / Load / Show API Request. No separate Copy Link — the applied report is
  // mirrored to the address bar, so the URL is the link.
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('flex-report') as unknown as { name: string; config: SavedConfig }[]);
  useServerSavedReports('flex-report', setSavedReports); // the server is the source of truth (F-24)
  const [showApiRequest, setShowApiRequest] = useState(false);
  const pageMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pageMenuOpen) return;
    const onDown = (e: MouseEvent) => { if (!pageMenuRef.current?.contains(e.target as Node)) { setPageMenuOpen(false); setLoadOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pageMenuOpen]);

  const { data: offers } = useQuery<{ id: string; name: string }[]>('/api/offers');
  const { data: publishers } = useQuery<{ id: string; name: string }[]>('/api/publishers');
  const { data: advertisers } = useQuery<{ id: string; name: string }[]>('/api/advertisers');
  const { data: smartLinksList } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)).sort()
    .map((c) => ({ value: c, label: countryLabel(c) })).sort((a, b) => a.label.localeCompare(b.label)), [countryAgg]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'smartLink', label: 'Smart Link', options: (smartLinksList ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
  ], [offers, advertisers, publishers, smartLinksList, countryOptions]);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const excludeOfferId = exclusions['offer']?.join(',');
  const excludeAdvertiserId = exclusions['advertiser']?.join(',');
  const excludePublisherId = exclusions['partner']?.join(',');
  const excludeSmartLinkId = exclusions['smartLink']?.join(',');
  const excludeCountry = exclusions['country']?.join(',');
  const excludeDevice = exclusions['device']?.join(',');
  const dimParams = {
    offerId: filters['offer']?.join(','), advertiserId: filters['advertiser']?.join(','),
    publisherId: filters['partner']?.join(','), smartLinkId: filters['smartLink']?.join(','),
    country: filters['country']?.join(','), device: filters['device']?.join(','),
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeSmartLinkId, excludeCountry, excludeDevice,
    excludeInvalid: ignoreFailTraffic ? 1 : undefined,
  };

  // The applied report lives in the address bar (replace, not push), so reload / back / a pasted
  // link reopen it. `tab` is kept, or the Analytics shell would switch tabs.
  const tab = searchParams.get('tab');
  const urlState = useMemo(() => {
    const next = new URLSearchParams();
    if (tab) next.set('tab', tab);
    next.set('from', appliedFrom); next.set('to', appliedTo);
    if (dims.length) next.set('dims', dims.join(','));
    writeUrlFilters(next, 'f', filters);
    writeUrlFilters(next, 'x', exclusions);
    writeUrlMetricFilters(next, metricFilters);
    if (ignoreFailTraffic) next.set(IGNORE_FAIL_PARAM, '1');
    next.set('orderBy', orderBy); next.set('orderDir', orderDir);
    return next.toString();
  }, [tab, appliedFrom, appliedTo, dims, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);

  // Rows without money-bearing conversions (and older APIs) format in the network's default currency.
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';

  const groupByStr = dims.join(',');
  const summaryQs = qs({ groupBy: 'none', metrics: withBreakdownMetrics('clicks,unique_clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,avg_fraud_score'), ...zone.range(appliedFrom, appliedTo), ...dimParams });
  const { data: summaryData, loading: summaryLoading, error: summaryError } = useQuery<AggResult>(`/api/reports?${summaryQs}`);
  const summary = useMemo(() => {
    const rows = summaryData?.rows ?? [];
    if (!rows.length) return null;
    const totals = rows.reduce((acc, r) => {
      acc.clicks += num(r.metrics['clicks'] ?? 0); acc.unique_clicks += num(r.metrics['unique_clicks'] ?? 0);
      acc.invalid_clicks += num(r.metrics['invalid_clicks'] ?? 0);
      acc.conversions += num(r.metrics['conversions'] ?? 0); acc.total_conversions += num(r.metrics['total_conversions'] ?? 0);
      acc.payout += num(r.metrics['payout'] ?? 0);
      acc.revenue += num(r.metrics['revenue'] ?? 0); acc.margin += num(r.metrics['margin'] ?? 0);
      return acc;
    }, { clicks: 0, unique_clicks: 0, invalid_clicks: 0, conversions: 0, total_conversions: 0, payout: 0, revenue: 0, margin: 0 });
    return deriveRow(totals);
  }, [summaryData]);
  // The summary's money currency ("Mixed" → per-currency amounts on the money tiles, newer API).
  const summaryRc = useMemo(() => combineCurrencies((summaryData?.rows ?? []).map((r) => currenciesOf(r.metrics)), currency), [summaryData, currency]);
  const summaryBreakdown = useMemo(() => combineMoneyByCurrency((summaryData?.rows ?? []).map((r) => moneyByCurrencyOf(r.metrics))), [summaryData]);

  const chronological = appliedFrom !== appliedTo;
  const graphQs = qs({ groupBy: chronological ? 'day' : 'hour', metrics: withCurrenciesMetric('clicks,revenue'), ...zone.range(appliedFrom, appliedTo), ...dimParams });
  // Every day in range, 200 per request up to GRAPH_DAY_CAP (useGraphRows) — one limit=200 request
  // kept only the oldest 200 active days and silently dropped the newer ones.
  const graph = useGraphRows(graphOpen ? `/api/reports?${graphQs}` : null);
  const graphSeries = useMemo(() => {
    const dimKey = chronological ? 'day' : 'hour';
    const rows = [...graph.rows].sort((a, b) => (a.dimensions[dimKey] ?? '').localeCompare(b.dimensions[dimKey] ?? ''));
    return {
      labels: rows.map((r) => (r.dimensions[dimKey] ?? '').slice(0, 10)),
      revenue: rows.map((r) => num(r.metrics['revenue'] ?? 0)),
      clicks: rows.map((r) => num(r.metrics['clicks'] ?? 0)),
      // Revenue across points in different currencies isn't one comparable series — not plotted then.
      rc: combineCurrencies(rows.map((r) => currenciesOf(r.metrics)), currency),
    };
  }, [graph.rows, chronological, currency]);

  const tableQsFor = (limit: number, offset: number) => qs({
    groupBy: groupByStr, metrics: withCurrenciesMetric(METRICS_PARAM),
    ...zone.range(appliedFrom, appliedTo), ...dimParams,
    orderBy, orderDir, limit, offset,
  });
  const tableQs = tableQsFor(pageSize, (page - 1) * pageSize);
  // No columns picked → nothing to group by: no request, the body shows a hint instead.
  const { data, loading, error } = useQuery<AggResult>(dims.length ? `/api/reports?${tableQs}` : null);

  const toRow = (r: AggRow) => ({
    key: dims.map((d) => r.dimensions[d] ?? '~').join('|'),
    dims: dims.map((d) => ({ dim: d, raw: r.dimensions[d] ?? null, name: resolveName(d, r.dimensions[d] ?? null, opts, smartLinkMap) })),
    derived: deriveRow(r.metrics),
    rc: resolveCurrency(currenciesOf(r.metrics), currency),
    metrics: r.metrics,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toRow only closes over the listed values
  const loadedRows = useMemo(() => (data?.rows ?? []).map(toRow), [data, dims, opts, smartLinkMap, currency]);
  // A Payout/Revenue threshold has no currency: not applied while the loaded rows span several
  // currencies (the flyout disables it and the results bar says so) — lib/reportCurrency.
  const moneyBlocked = useMemo(() => moneyFilterBlockedBy(loadedRows.map((r) => r.rc)), [loadedRows]);
  const rows = useMemo(() => loadedRows
    .filter((r) => !q.trim() || r.dims.some((d) => d.name.toLowerCase().includes(q.trim().toLowerCase())))
    .filter((r) => passesMetricFilters(r.derived, metricFilters, !!moneyBlocked)),
  [loadedRows, q, metricFilters, moneyBlocked]);

  // Column picks apply at once and return to page 1.
  const addDim = (k: DimKey) => {
    if (dims.length < MAX_DIMS && !dims.includes(k)) { setDims([...dims, k]); toFirstPage(); }
    setDimPickerOpen(false);
  };
  const removeDim = (k: DimKey) => { setDims(dims.filter((d) => d !== k)); toFirstPage(); };

  // Reset dates, columns and every Reporting Filter in one render → one request per query. The
  // debounced range catches up to the same values later and is then a no-op.
  const clearAll = () => {
    range.reset({ from: zone.daysAgo(7), to: zone.today() });
    setDims(DEFAULT_DIMS); setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
  };
  const toggleSort = (m: OrderMetric) => {
    if (orderBy === m) setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setOrderBy(m); setOrderDir('desc'); }
    toFirstPage();
  };
  const reporting: ReportingFiltersValue = { filters, exclusions, metricFilters, ignoreFailTraffic };
  // Flyout Apply, chip removal and the chips' "Clear all" apply at once and return to page 1.
  const setReporting = (v: ReportingFiltersValue) => {
    setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic);
    toFirstPage();
  };

  const shownMetrics = useMemo(() => new Set(METRIC_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  // Money as the API's exact decimal text and EPC as the API's value (lib/flexReport `flexExportRow`).
  const toExportRow = (r: ReturnType<typeof toRow>) => flexExportRow(
    r.dims.map((d) => ({ label: DIM_OPTIONS.find((o) => o.key === d.dim)?.label ?? d.dim, name: d.name })), r.derived, r.metrics);
  // Export every row matching the applied filters (all pages), with the same client-side metric
  // filters as the table — but not the "Search this page" box, which only narrows the visible page.
  // Money stays plain decimals with the row's currency in a trailing `currency` column ("MIXED",
  // money columns left empty, for a row whose conversions mix currencies).
  const reportExport = useReportExport();
  const runExport = (format: 'csv' | 'xlsx') => {
    if (!dims.length) return;
    void reportExport.run(format, 'flex-report', async () => {
      const res = await fetchAllPages<AggRow>((limit, offset) => `/api/reports?${tableQsFor(limit, offset)}`, 200);
      return { ...res, rows: filterWithMoneyRule(res.rows.map(toRow), (r) => r.rc, (r, skip) => passesMetricFilters(r.derived, metricFilters, skip)).map((r) => withRowCurrency(toExportRow(r), r.rc)) };
    });
  };

  const saveReport = (name: string) => {
    const config: SavedConfig = { from: appliedFrom, to: appliedTo, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns], dims };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('flex-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    // range.reset sets the inputs, the applied range and page 1 together — one render, one request.
    range.reset({ from: config.from, to: config.to });
    setFilters(config.filters); setDims(config.dims);
    setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(flexOrderBy(config.orderBy)); setOrderDir(config.orderDir); setHiddenColumns(new Set(config.hiddenColumns));
    setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('flex-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
  };

  return (
    <>
      <PageHeader title="Flex Report" subtitle="Analytics › Flex" />

      <ReportCard className="mb-4">
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, columns and filters" />
          <FiltersButton count={reportingFiltersCount(reporting)} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout
                moneyFilterBlockedBy={moneyBlocked}
                dimCategories={FILTER_CATEGORIES}
                value={reporting}
                onApply={setReporting}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </FiltersButton>
          <div ref={pageMenuRef} className="relative">
            <button type="button" title="Page Actions" aria-label="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
              className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {pageMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <button onClick={() => { setPageMenuOpen(false); setSaveModalOpen(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Save</button>
                <div className="relative" onMouseEnter={() => setLoadOpen(true)} onMouseLeave={() => setLoadOpen(false)}>
                  <button disabled={!savedReports.length} onClick={() => setLoadOpen((s) => !s)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
                    Load{savedReports.length ? ` (${savedReports.length})` : ''} <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {loadOpen && savedReports.length > 0 && (
                    <div className="absolute right-full top-0 mr-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      {savedReports.map((s) => (
                        <div key={s.name} className="flex items-center justify-between px-3 py-1.5 text-small hover:bg-accent-subtle">
                          <button onClick={() => applySavedReport(s.config)} className="flex-1 truncate text-left text-fg">{s.name}</button>
                          <button onClick={() => deleteSavedReport(s.name)} className="ml-2 text-fg-muted hover:text-danger-text">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { setPageMenuOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
        </>}>
          <DateRangeField idPrefix="flex-report" from={range.from} to={range.to} max={zone.today()} zone={zone} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <ControlField label="Columns" htmlFor="flex-report-columns" className="w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button id="flex-report-columns" type="button" className={`btn-ghost ${CONTROL} flex items-center gap-1.5 !px-3.5`} onClick={() => setDimPickerOpen((o) => !o)} disabled={dims.length >= MAX_DIMS}>
                  <Plus size={15} /> Add Columns <span className="text-fg-muted">{dims.length}/{MAX_DIMS}</span>
                </button>
                {dimPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setDimPickerOpen(false)} />
                    <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-52 overflow-y-auto rounded-card border border-border bg-elevated p-1 shadow-elevated">
                      {DIM_OPTIONS.filter((d) => !dims.includes(d.key)).map((d) => (
                        <button key={d.key} onClick={() => addDim(d.key)} className="block w-full rounded-[var(--radius)] px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{d.label}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {dims.map((d) => {
                const label = DIM_OPTIONS.find((o) => o.key === d)?.label;
                return (
                  <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-tiny font-medium text-accent-text">
                    {label}
                    <button type="button" onClick={() => removeDim(d)} aria-label={`Remove column ${label}`}><X size={12} /></button>
                  </span>
                );
              })}
            </div>
          </ControlField>
        </ReportControls>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
            <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
          </button>
          {summaryOpen && (
            summaryLoading ? <div className="pt-4"><Spinner /></div> : summaryError ? <p className="pt-3 text-small text-danger-text">{summaryError}</p> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
              <SummaryGrid summary={summary} currency={currency} rc={summaryRc} breakdown={summaryBreakdown} />
            )
          )}
        </div>
      </ReportCard>

      <div className="card mb-4">
        <button type="button" onClick={() => setGraphOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronRight size={14} className={`transition-transform ${graphOpen ? 'rotate-90' : ''}`} /> Performance Graph
        </button>
        {graphOpen && (
          graph.loading ? <div className="pt-4"><Spinner /></div> : graph.error ? <p className="pt-3 text-small text-danger-text">{graph.error}</p> : graphSeries.labels.length === 0 ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <div className="pt-4">
              {graph.capped && <GraphCappedNote shown={graphSeries.labels.length} unit={chronological ? 'days' : 'hours'} />}
              <div className="mb-2 flex items-center gap-4 text-tiny text-fg-secondary">
                {isMixed(graphSeries.rc)
                  ? <span className="text-fg-muted" title={mixedTitle(graphSeries.rc.currencies)}>Revenue not plotted — mixed currencies</span>
                  : <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded bg-accent-text" /> Revenue</span>}
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-fg-muted" /> Clicks</span>
              </div>
              <MiniChart labels={graphSeries.labels} revenue={isMixed(graphSeries.rc) ? null : graphSeries.revenue} clicks={graphSeries.clicks} />
            </div>
          )
        )}
      </div>

      <ReportCard>
        <ResultsBar position="top" loading={loading} title={<>Detailed Report <span className="ml-1 font-normal text-fg-muted">· Learn more about <Link to="/app/reports/custom-metrics" className="text-accent-text hover:underline">Custom Reporting Metrics</Link></span></>} actions={<>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className={`input ${CONTROL} !pl-8 sm:!w-56`} placeholder="Search this page…" title="Filters only the rows on the current page"
              aria-label="Search this page" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="relative">
            <button type="button" title="Table Actions" aria-label="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => { setTableActionsOpen(false); setExportOpen(false); }}>
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <div className="relative" onMouseEnter={() => setExportOpen(true)}>
                  <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button disabled={reportExport.busy} onClick={() => { runExport('csv'); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">CSV</button>
                      <button disabled={reportExport.busy} onClick={() => { runExport('xlsx'); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">Excel</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </>}>
          <CurrencyNotes sortedWithin={showSortedWithinNote(data?.sortedWithinCurrency, loadedRows.map((r) => r.rc))}
            moneyFilterBlockedBy={moneyBlocked} moneyFilterActive={hasMoneyFilter(metricFilters)} />
          <ActiveFilterChips
            chips={reportingChips(FILTER_CATEGORIES, reporting)}
            onRemove={(c) => setReporting(withoutReportingChip(reporting, c))}
            onClearAll={() => setReporting(EMPTY_REPORTING_FILTERS)} />
        </ResultsBar>

        <ReportBody>
        <ExportStatus busy={reportExport.busy} note={reportExport.note} error={reportExport.error} onDismiss={reportExport.dismiss} />
        {!dims.length ? <StateBlock>Add at least one column to see a breakdown.</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    {dims.map((d) => <th key={d} >{DIM_OPTIONS.find((o) => o.key === d)?.label}</th>)}
                    {shownMetrics.has('Clicks') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort(FLEX_COLUMN_SORT.Clicks)}>Clicks {orderBy === FLEX_COLUMN_SORT.Clicks ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Total CV') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('total_conversions')}>Total CV {orderBy === 'total_conversions' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('RPA') && <th className="text-right font-semibold">RPA</th>}
                    {shownMetrics.has('CPA') && <th className="text-right font-semibold">CPA</th>}
                    {shownMetrics.has('CVR') && <th className="text-right font-semibold">CVR</th>}
                    {shownMetrics.has('Revenue') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('revenue')}>Revenue {orderBy === 'revenue' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Payout') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('payout')}>Payout {orderBy === 'payout' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Profit') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('margin')}>Profit {orderBy === 'margin' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Margin') && <th className="text-right font-semibold">Margin</th>}
                    {shownMetrics.has('EPC') && <th className="text-right font-semibold">EPC</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-accent-subtle/40">
                      {r.dims.map((d, i) => (
                        <td key={i} >
                          {d.raw != null && linkFor(d.dim, d.raw) ? <Link to={linkFor(d.dim, d.raw)!} className="text-accent-text hover:underline">{d.name}</Link> : d.name}
                        </td>
                      ))}
                      {metricCells(shownMetrics, r.derived, r.rc)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-3 flex justify-end">
          {/* A failed request keeps the previous `data` in useQuery — never show its total as current. */}
          <Pagination total={error ? 0 : (data?.total ?? 0)} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
        </ReportBody>
      </ReportCard>

      {showColumns && <ColumnsModal allColumns={METRIC_COLUMNS} order={[...METRIC_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, columns: dims.join(','),
        offer: dimParams.offerId, advertiser: dimParams.advertiserId, partner: dimParams.publisherId, smartLink: dimParams.smartLinkId, country: dimParams.country, device: dimParams.device,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeSmartLink: excludeSmartLinkId, excludeCountry, excludeDevice,
        ignoreFailTraffic: ignoreFailTraffic ? 'true' : undefined,
      }} />}
      <PromptModal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save Report" message="Name this saved report:" placeholder="e.g. Flex Overview" onConfirm={saveReport} />
    </>
  );
}
