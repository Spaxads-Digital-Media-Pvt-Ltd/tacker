/**
 * Analytics › Dynamic Nested — verified against the live reference (URL `/analytics/nested`, real
 * data: 6 real offer rows). Structurally the same real 22-column Detailed Report used by Smart Link
 * Report / Daily Report (Imp/RPM/CPM/VT CV/CTR/Throttle honestly dashed — no impression/pixel
 * tracking or per-click throttle outcome anywhere in this app), plus the same Summary/Performance
 * Graph/"Reporting Filters"/page-kebab shell every report page shares (ReportPageKit.tsx) — but here
 * BOTH the row (Parent) dimension and the expand-by (Child) dimension are user-picked instead of
 * fixed, generalizing the same expand-by-X pattern already used per-report (Offer→Partner,
 * Partner→Offer, Smart Link→Offer, ...) into one configurable page.
 *
 * Parent/Child share the same real dimension set already established for Analytics › Dimensional and
 * Flex (Offer, Partner, Advertiser, Smart Link, Country, Device, City, Region, ISP, OS, Browser,
 * Sub1-5) — the reference's much longer flat list (Account/Sales/Partner Manager, Referred By,
 * Carrier, Connection Type, DMA, Is Proxy, ZIP, Adv1-10, Attribution Method, Click/Conversion Error
 * Code, Device Brand/Model/Platform, User ID, ...) has no backing anywhere in this schema and is
 * omitted rather than faked (matches the exhaustive audit already done for Dimensional/Flex).
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced),
 * Parent / Child / Reporting Filters / chips / sort immediately. The applied report is mirrored to
 * the address bar (keeping `tab=nested`), so the URL itself is the shareable link.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreVertical, Search } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { uaDimensionLabel } from '../../../lib/userAgentDisplay';
import { PageHeader, Spinner, StateBlock, PromptModal } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../../shared-components/primitives/TableActionsKit';
import {
  type AggResult, type AggRow, METRICS_PARAM, DASH, DEVICE_OPTIONS, pct, num,
  deriveRow, type DerivedRow, MiniChart, SummaryGrid, RowKebabMenu, Pagination,
  type MetricFilters, METRIC_FILTER_FIELDS, passesMetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
  type ReportingFiltersValue, EMPTY_REPORTING_FILTERS, reportingChips, withoutReportingChip,
  type SavedReportConfig, loadSavedReports, persistSavedReports,
  fetchAllPages, useReportExport, ExportStatus,
  useGraphRows, GraphCappedNote,
} from '../../../shared-components/primitives/ReportPageKit';
import { useServerSavedReports } from '../../../lib/savedReports';
import {
  readUrlFilters, writeUrlFilters, readUrlDate, readUrlMetricFilters, writeUrlMetricFilters,
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
import { moneyExportCells } from '../../../lib/reportExportCells';
import { CurrencyNotes, Money, MoneyPct } from '../../../shared-components/primitives/ReportMoney';
import { bucketLabel, formatReportHourShort } from '../../../lib/reportTime';
import { useReportZone, type ZoneDays } from '../../../lib/useReportZone';
import { zoneRangeParams } from '../../../lib/reportZone';

interface SmartLink { id: string; name: string }

const DIM_OPTIONS = [
  { key: 'offer', label: 'Offer', filterParam: 'offerId' },
  { key: 'publisher', label: 'Partner', filterParam: 'publisherId' },
  { key: 'advertiser', label: 'Advertiser', filterParam: 'advertiserId' },
  { key: 'smartLink', label: 'Smart Link', filterParam: 'smartLinkId' },
  { key: 'country', label: 'Country', filterParam: 'country' },
  { key: 'device', label: 'Device', filterParam: 'device' },
  { key: 'city', label: 'City', filterParam: 'city' },
  { key: 'region', label: 'Region', filterParam: 'region' },
  { key: 'isp', label: 'ISP', filterParam: 'isp' },
  { key: 'os', label: 'OS', filterParam: 'os' },
  { key: 'browser', label: 'Browser', filterParam: 'browser' },
  { key: 'sub1', label: 'Sub1', filterParam: 'sub1' },
  { key: 'sub2', label: 'Sub2', filterParam: 'sub2' },
  { key: 'sub3', label: 'Sub3', filterParam: 'sub3' },
  { key: 'sub4', label: 'Sub4', filterParam: 'sub4' },
  { key: 'sub5', label: 'Sub5', filterParam: 'sub5' },
] as const;
type DimKey = (typeof DIM_OPTIONS)[number]['key'];

const ALL_COLUMNS = [
  'Imp', 'RPM', 'CPM', 'Gross Clicks', 'Clicks', 'Uniq. Clicks', 'Dup. Clicks', 'Invalid Clicks',
  'Total CV', 'CV', 'VT CV', 'CTR', 'Throttle', 'CVR', 'CPC', 'CPA', 'RPC', 'RPA',
  'Revenue', 'Payout', 'Profit', 'Margin',
] as const;
type OrderMetric = 'clicks' | 'unique_clicks' | 'invalid_clicks' | 'conversions' | 'total_conversions' | 'payout' | 'revenue' | 'margin';

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
/** One row's metric cells; money in the row's own currency ("Mixed" when its conversions mix currencies). */
function metricCells(shown: Set<string>, d: DerivedRow, rc: RowCurrency) {
  return (
    <>
      {shown.has('Imp') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('RPM') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('CPM') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('Gross Clicks') && <td className="px-4 py-3 text-right">{d.clicksGross.toLocaleString()}</td>}
      {shown.has('Clicks') && <td className="px-4 py-3 text-right">{d.clicks.toLocaleString()}</td>}
      {shown.has('Uniq. Clicks') && <td className="px-4 py-3 text-right">{d.uniqueClicks.toLocaleString()}</td>}
      {shown.has('Dup. Clicks') && <td className="px-4 py-3 text-right">{d.dupClicks.toLocaleString()}</td>}
      {shown.has('Invalid Clicks') && <td className="px-4 py-3 text-right">{d.invalidClicks.toLocaleString()}</td>}
      {shown.has('Total CV') && <td className="px-4 py-3 text-right">{d.totalCv.toLocaleString()}</td>}
      {shown.has('CV') && <td className="px-4 py-3 text-right">{d.cv.toLocaleString()}</td>}
      {shown.has('VT CV') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('CTR') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('Throttle') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('CVR') && <td className="px-4 py-3 text-right">{pct(d.cvr)}</td>}
      {shown.has('CPC') && <td className="px-4 py-3 text-right"><Money value={d.cpc} rc={rc} /></td>}
      {shown.has('CPA') && <td className="px-4 py-3 text-right"><Money value={d.cpa} rc={rc} /></td>}
      {shown.has('RPC') && <td className="px-4 py-3 text-right"><Money value={d.rpc} rc={rc} /></td>}
      {shown.has('RPA') && <td className="px-4 py-3 text-right"><Money value={d.rpa} rc={rc} /></td>}
      {shown.has('Revenue') && <td className="px-4 py-3 text-right"><Money value={d.revenue} rc={rc} /></td>}
      {shown.has('Payout') && <td className="px-4 py-3 text-right"><Money value={d.payout} rc={rc} /></td>}
      {shown.has('Profit') && <td className="px-4 py-3 text-right"><Money value={d.margin} rc={rc} /></td>}
      {shown.has('Margin') && <td className="px-4 py-3 text-right"><MoneyPct value={d.marginPct} rc={rc} /></td>}
    </>
  );
}

/** Single-dimension picker for the controls row (label comes from the surrounding ControlField). */
function SingleSelectDropdown({ id, value, onChange }: { id: string; value: DimKey; onChange: (k: DimKey) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button id={id} type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`input ${CONTROL} flex items-center justify-between text-left`}>
        {DIM_OPTIONS.find((d) => d.key === value)?.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {DIM_OPTIONS.map((d) => (
              <button key={d.key} onClick={() => { onChange(d.key); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${d.key === value ? 'text-accent-text' : 'text-fg'}`}>
                {d.key === value && '✓'} {d.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExpandedChildRows({
  childDim, parentFilterParam, parentRawId, from, to, tz, opts, smartLinkMap, shown, dimParams, currency,
}: {
  childDim: DimKey; parentFilterParam: string; parentRawId: string; from: string; to: string; tz: string;
  dimParams: Record<string, string | number | undefined>;
  opts: Opts; smartLinkMap: Map<string, string>; shown: Set<string>; currency: string;
}) {
  // Child rows use the page's filters + date range, narrowed to this parent. The parent value is set
  // last (overrides a page filter on the same dimension). Text values may contain commas ("Comcast
  // Cable, LLC"), so they're sent as `key[]=value`, which the API takes literally instead of splitting.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(dimParams)) if (v !== undefined && v !== '' && k !== parentFilterParam) params.set(k, String(v));
  params.set('groupBy', childDim); params.set('metrics', withCurrenciesMetric(METRICS_PARAM));
  for (const [k, v] of Object.entries(zoneRangeParams(from, to, tz))) params.set(k, v);
  params.set('limit', '200');
  if (/Id$/.test(parentFilterParam)) params.set(parentFilterParam, parentRawId);
  else params.append(`${parentFilterParam}[]`, parentRawId);
  const { data, loading, error } = useQuery<AggResult>(`/api/reports?${params.toString()}`);
  const rows = useMemo(() => (data?.rows ?? [])
    .filter((r) => r.dimensions[childDim])
    .map((r) => ({ raw: r.dimensions[childDim]!, name: resolveName(childDim, r.dimensions[childDim] ?? null, opts, smartLinkMap), derived: deriveRow(r.metrics), rc: resolveCurrency(currenciesOf(r.metrics), currency) })),
  [data, childDim, opts, smartLinkMap, currency]);

  if (loading) return <tr><td colSpan={1 + ALL_COLUMNS.length + 1} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (error) return <tr><td colSpan={1 + ALL_COLUMNS.length + 1} className="px-4 py-3 text-small text-danger-text">{error}</td></tr>;
  if (!rows.length) return <tr><td colSpan={1 + ALL_COLUMNS.length + 1} className="px-4 py-3 text-small text-fg-muted">No activity for this period.</td></tr>;
  return (
    <>
      {rows.map((r, i) => (
        <tr key={i} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{r.name}</td>
          {metricCells(shown, r.derived, r.rc)}
          <td />
        </tr>
      ))}
    </>
  );
}

function RowActionMenu({ dim, id, label }: { dim: DimKey; id: string; label: string }) {
  const url = linkFor(dim, id);
  const items = url ? [{ label: `View ${DIM_OPTIONS.find((d) => d.key === dim)?.label}: ${label}`.slice(0, 40), onClick: () => { window.location.href = url; } }] : [];
  // Uuid parents deep-link into Flex pre-filtered to that entity (Flex reads offerId/publisherId/…).
  const flexLink = /Id$/.test(DIM_OPTIONS.find((d) => d.key === dim)?.filterParam ?? '')
    ? `/app/analytics?tab=flex&${DIM_OPTIONS.find((d) => d.key === dim)!.filterParam}=${encodeURIComponent(id)}`
    : '/app/analytics?tab=flex';
  items.push({ label: 'Open Flex Report', onClick: () => { window.location.href = flexLink; } });
  return <RowKebabMenu items={items} />;
}

type SavedConfig = SavedReportConfig<OrderMetric> & { parentDim: DimKey; childDim: DimKey };

const ORDER_METRICS: OrderMetric[] = ['clicks', 'unique_clicks', 'invalid_clicks', 'conversions', 'total_conversions', 'payout', 'revenue', 'margin'];
const isDimKey = (v: string | null): v is DimKey => DIM_OPTIONS.some((d) => d.key === v);

/** Initial report state from the URL — what the page mirrors to the address bar. */
function readNestedUrl(zone: ZoneDays) {
  const sp = new URLSearchParams(window.location.search);
  let from = readUrlDate(sp, 'from', zone.daysAgo(7));
  const to = readUrlDate(sp, 'to', zone.today());
  if (from > to) from = to;
  const parent = sp.get('parent');
  const child = sp.get('child');
  const ob = sp.get('orderBy');
  return {
    from, to,
    parentDim: isDimKey(parent) ? parent : 'offer' as DimKey,
    childDim: isDimKey(child) ? child : 'publisher' as DimKey,
    filters: readUrlFilters(sp, 'f'),
    exclusions: readUrlFilters(sp, 'x'),
    metricFilters: readUrlMetricFilters<MetricFilters>(sp, METRIC_FILTER_FIELDS.map((f) => f.key)),
    ignoreFail: readUrlFlag(sp, IGNORE_FAIL_PARAM),
    orderBy: (ORDER_METRICS as string[]).includes(ob ?? '') ? (ob as OrderMetric) : 'clicks',
    orderDir: (sp.get('orderDir') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
  };
}

export default function DynamicNestedReport() {
  const opts = useReportOpts();
  const smartLinkMap = useMemo(() => new Map(opts.smartLinks?.map((s: { value: string; label: string }) => [s.value, s.label]) ?? []), [opts.smartLinks]);

  const [searchParams, setSearchParams] = useSearchParams();
  // D7: the report's time zone — the network's unless one is picked beside the dates: its days,
  // "today" and the presets; requests send plain dates + tz.
  const zone = useReportZone();
  const [init] = useState(() => readNestedUrl(zone));
  // Dates apply on their own once they form a valid range (see useAutoDateRange); Parent / Child,
  // Reporting Filters and sort apply immediately and return to page 1. `page` lives with the range,
  // so a new range and the page reset land in one render (one request).
  const range = useAutoDateRange(init.from, init.to);
  const { appliedFrom, appliedTo, page, setPage, toFirstPage } = range;
  const [parentDim, setParentDim] = useState<DimKey>(init.parentDim);
  const [childDim, setChildDim] = useState<DimKey>(init.childDim);
  const [filters, setFilters] = useState<FilterValues>(init.filters);
  const [exclusions, setExclusions] = useState<FilterValues>(init.exclusions);
  const [metricFilters, setMetricFilters] = useState<MetricFilters>(init.metricFilters);
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(init.ignoreFail);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('nested-report') as unknown as { name: string; config: SavedConfig }[]);
  useServerSavedReports('nested-report', setSavedReports); // the server is the source of truth (F-24)
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
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
    next.set('parent', parentDim); next.set('child', childDim);
    writeUrlFilters(next, 'f', filters);
    writeUrlFilters(next, 'x', exclusions);
    writeUrlMetricFilters(next, metricFilters);
    if (ignoreFailTraffic) next.set(IGNORE_FAIL_PARAM, '1');
    next.set('orderBy', orderBy); next.set('orderDir', orderDir);
    return next.toString();
  }, [tab, appliedFrom, appliedTo, parentDim, childDim, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);

  // Rows without money-bearing conversions (and older APIs) format in the network's default currency.
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';

  const summaryQs = qs({ groupBy: 'none', metrics: withBreakdownMetrics(METRICS_PARAM), ...zone.range(appliedFrom, appliedTo), ...dimParams });
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
      // A single day is charted per hour: keep the raw bucket so the chart can show its hour (lib/reportTime).
      labels: rows.map((r) => (dimKey === 'hour' ? r.dimensions[dimKey] ?? '' : (r.dimensions[dimKey] ?? '').slice(0, 10))),
      hourly: dimKey === 'hour',
      revenue: rows.map((r) => num(r.metrics['revenue'] ?? 0)),
      clicks: rows.map((r) => num(r.metrics['clicks'] ?? 0)),
      // Revenue across points in different currencies isn't one comparable series — not plotted then.
      rc: combineCurrencies(rows.map((r) => currenciesOf(r.metrics)), currency),
    };
  }, [graph.rows, chronological, currency]);

  const tableQsFor = (limit: number, offset: number) => qs({
    groupBy: parentDim, metrics: withCurrenciesMetric(METRICS_PARAM),
    ...zone.range(appliedFrom, appliedTo), ...dimParams,
    orderBy, orderDir, limit, offset,
  });
  const tableQs = tableQsFor(pageSize, (page - 1) * pageSize);
  const { data, loading, error } = useQuery<AggResult>(`/api/reports?${tableQs}`);

  const toParentRows = (src: AggRow[]) => src
    .filter((r) => r.dimensions[parentDim])
    .map((r) => ({ raw: r.dimensions[parentDim]!, name: resolveName(parentDim, r.dimensions[parentDim] ?? null, opts, smartLinkMap), derived: deriveRow(r.metrics), rc: resolveCurrency(currenciesOf(r.metrics), currency), metrics: r.metrics }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toParentRows only closes over the listed values
  const loadedRows = useMemo(() => toParentRows(data?.rows ?? []), [data, parentDim, opts, smartLinkMap, currency]);
  // A Payout/Revenue threshold has no currency: not applied while the loaded rows span several
  // currencies (the flyout disables it and the results bar says so) — lib/reportCurrency.
  const moneyBlocked = useMemo(() => moneyFilterBlockedBy(loadedRows.map((r) => r.rc)), [loadedRows]);
  const rows = useMemo(() => loadedRows
    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.derived, metricFilters, !!moneyBlocked)),
  [loadedRows, q, metricFilters, moneyBlocked]);

  // A new Parent re-keys every row, so expanded rows of the old Parent are dropped. A new Child keeps
  // them open (they re-fetch broken down by the new Child) and doesn't touch the parent table.
  const changeParent = (k: DimKey) => {
    if (k === parentDim) return;
    setParentDim(k); setExpanded(new Set()); toFirstPage();
  };
  // Reset dates, Parent/Child and every Reporting Filter in one render → one request per query. The
  // debounced range catches up to the same values later and is then a no-op.
  const clearAll = () => {
    range.reset({ from: zone.daysAgo(7), to: zone.today() });
    setParentDim('offer'); setChildDim('publisher'); setExpanded(new Set());
    setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
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
  const toggleExpand = (key: string) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  // Export every parent row matching the applied filters (all pages, not the expanded children), with
  // the same client-side metric filters as the table — but not the "Search this page" box.
  const reportExport = useReportExport();
  const runExport = (format: 'csv' | 'xlsx') => {
    void reportExport.run(format, 'nested-report', async () => {
      const res = await fetchAllPages<AggRow>((limit, offset) => `/api/reports?${tableQsFor(limit, offset)}`, 200);
      return { ...res, rows: exportRows(filterWithMoneyRule(toParentRows(res.rows), (r) => r.rc, (r, skip) => passesMetricFilters(r.derived, metricFilters, skip))) };
    });
  };
  // Money stays plain decimals with the row's currency in a trailing `currency` column ("MIXED",
  // money columns left empty, for a row whose conversions mix currencies).
  const exportRows = (list: ReturnType<typeof toParentRows>) => list.map((r) => withRowCurrency({
    [DIM_OPTIONS.find((d) => d.key === parentDim)?.label ?? parentDim]: r.name,
    imp: DASH, rpm: DASH, cpm: DASH, grossClicks: r.derived.clicksGross, clicks: r.derived.clicks,
    uniqueClicks: r.derived.uniqueClicks, dupClicks: r.derived.dupClicks, invalidClicks: r.derived.invalidClicks,
    totalCv: r.derived.totalCv, cv: r.derived.cv, vtCv: DASH, ctr: DASH, throttle: DASH,
    cvr: pct(r.derived.cvr),
    // Stored money exactly as the API sent them; CPC/CPA/RPC/RPA with the screen's rounding.
    ...moneyExportCells(r.derived, r.metrics),
    margin: pct(r.derived.marginPct),
  }, r.rc));

  const sortIcon = (m: OrderMetric) => (orderBy === m ? (orderDir === 'desc' ? '↓' : '↑') : '');
  const sortableHeader = (label: string, m: OrderMetric) => (
    <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort(m)}>{label} {sortIcon(m)}</th>
  );

  const saveReport = (name: string) => {
    const config: SavedConfig = { from: appliedFrom, to: appliedTo, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns], parentDim, childDim };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('nested-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    // range.reset sets the inputs, the applied range and page 1 together — one render, one request.
    range.reset({ from: config.from, to: config.to });
    setFilters(config.filters); setParentDim(config.parentDim); setChildDim(config.childDim); setExpanded(new Set());
    setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(config.orderBy); setOrderDir(config.orderDir); setHiddenColumns(new Set(config.hiddenColumns));
    setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('nested-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
  };

  const parentOpt = DIM_OPTIONS.find((d) => d.key === parentDim)!;
  const childOpt = DIM_OPTIONS.find((d) => d.key === childDim)!;

  return (
    <>
      <PageHeader title="Dynamic Nested Report" subtitle="Analytics › Dynamic Nested" />

      <ReportCard className="mb-4">
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, Parent / Child and filters" />
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
          <DateRangeField idPrefix="nested-report" from={range.from} to={range.to} max={zone.today()} zone={zone} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <ControlField label="Parent" htmlFor="nested-report-parent" className="w-full sm:w-44">
            <SingleSelectDropdown id="nested-report-parent" value={parentDim} onChange={changeParent} />
          </ControlField>
          <ControlField label="Child" htmlFor="nested-report-child" className="w-full sm:w-44">
            <SingleSelectDropdown id="nested-report-child" value={childDim} onChange={setChildDim} />
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
              <MiniChart labels={graphSeries.labels} formatLabel={graphSeries.hourly ? formatReportHourShort : undefined} revenue={isMixed(graphSeries.rc) ? null : graphSeries.revenue} clicks={graphSeries.clicks} />
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
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th >
                      {parentOpt.label}<br /><span className="text-[10px] normal-case text-fg-muted">↳ {childOpt.label}</span>
                    </th>
                    {shown.has('Imp') && <th className="text-right font-semibold">Imp</th>}
                    {shown.has('RPM') && <th className="text-right font-semibold">RPM</th>}
                    {shown.has('CPM') && <th className="text-right font-semibold">CPM</th>}
                    {shown.has('Gross Clicks') && sortableHeader('Gross Clicks', 'clicks')}
                    {shown.has('Clicks') && <th className="text-right font-semibold">Clicks</th>}
                    {shown.has('Uniq. Clicks') && sortableHeader('Uniq. Clicks', 'unique_clicks')}
                    {shown.has('Dup. Clicks') && <th className="text-right font-semibold">Dup. Clicks</th>}
                    {shown.has('Invalid Clicks') && sortableHeader('Invalid Clicks', 'invalid_clicks')}
                    {shown.has('Total CV') && sortableHeader('Total CV', 'total_conversions')}
                    {shown.has('CV') && sortableHeader('CV', 'conversions')}
                    {shown.has('VT CV') && <th className="text-right font-semibold">VT CV</th>}
                    {shown.has('CTR') && <th className="text-right font-semibold">CTR</th>}
                    {shown.has('Throttle') && <th className="text-right font-semibold">Throttle</th>}
                    {shown.has('CVR') && <th className="text-right font-semibold">CVR</th>}
                    {shown.has('CPC') && <th className="text-right font-semibold">CPC</th>}
                    {shown.has('CPA') && <th className="text-right font-semibold">CPA</th>}
                    {shown.has('RPC') && <th className="text-right font-semibold">RPC</th>}
                    {shown.has('RPA') && <th className="text-right font-semibold">RPA</th>}
                    {shown.has('Revenue') && sortableHeader('Revenue', 'revenue')}
                    {shown.has('Payout') && sortableHeader('Payout', 'payout')}
                    {shown.has('Profit') && sortableHeader('Profit', 'margin')}
                    {shown.has('Margin') && <th className="text-right font-semibold">Margin</th>}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.raw}>
                      <tr>
                        <td >
                          <button type="button" onClick={() => toggleExpand(r.raw)} className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
                            <ChevronRight size={13} className={`transition-transform ${expanded.has(r.raw) ? 'rotate-90' : ''}`} />
                            {r.name}
                          </button>
                        </td>
                        {metricCells(shown, r.derived, r.rc)}
                        <td className="text-right">
                          <RowActionMenu dim={parentDim} id={r.raw} label={r.name} />
                        </td>
                      </tr>
                      {expanded.has(r.raw) && (
                        <ExpandedChildRows
                          childDim={childDim} parentFilterParam={parentOpt.filterParam} parentRawId={r.raw}
                          from={appliedFrom} to={appliedTo} tz={zone.tz} opts={opts} smartLinkMap={smartLinkMap} shown={shown} dimParams={dimParams} currency={currency}
                        />
                      )}
                    </Fragment>
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

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, parent: parentDim, child: childDim,
        offer: dimParams.offerId, advertiser: dimParams.advertiserId, partner: dimParams.publisherId, smartLink: dimParams.smartLinkId, country: dimParams.country, device: dimParams.device,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeSmartLink: excludeSmartLinkId, excludeCountry, excludeDevice,
        ignoreFailTraffic: ignoreFailTraffic ? 'true' : undefined,
      }} />}
      <PromptModal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save Report" message="Name this saved report:" placeholder="e.g. Nested Overview" onConfirm={saveReport} />
    </>
  );
}
