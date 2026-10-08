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
 */
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreVertical, Search, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { PageHeader, Spinner, StateBlock, PromptModal } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../../shared-components/primitives/TableActionsKit';
import {
  type AggResult, type AggRow, METRICS_PARAM, DASH, DEVICE_OPTIONS, money, pct, num, toIso, daysAgo, todayStr,
  deriveRow, type DerivedRow, MiniChart, SummaryGrid, RowKebabMenu, Pagination,
  type MetricFilters, METRIC_FILTER_FIELDS, passesMetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
  type SavedReportConfig, loadSavedReports, persistSavedReports,
  fetchAllPages, useReportExport, ExportStatus,
} from '../../../shared-components/primitives/ReportPageKit';
import {
  readUrlFilters, readUrlDate, readUrlMetricFilters, writeUrlMetricFilters,
  IGNORE_FAIL_PARAM, readUrlFlag, reportLink, urlFilterParams,
} from '../../../lib/reportFilterState';
import { useReportOpts, type Opts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { ActiveFilterChips } from '../../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../../lib/filterChips';

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
  return id;
}
function linkFor(dim: DimKey, id: string): string | null {
  if (dim === 'offer') return `/app/offers/${id}`;
  if (dim === 'publisher') return `/app/publishers/${id}`;
  if (dim === 'advertiser') return `/app/advertisers/${id}`;
  if (dim === 'smartLink') return `/app/smart-links/${id}`;
  return null;
}
function metricCells(shown: Set<string>, d: DerivedRow) {
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
      {shown.has('CPC') && <td className="px-4 py-3 text-right">{money(d.cpc)}</td>}
      {shown.has('CPA') && <td className="px-4 py-3 text-right">{money(d.cpa)}</td>}
      {shown.has('RPC') && <td className="px-4 py-3 text-right">{money(d.rpc)}</td>}
      {shown.has('RPA') && <td className="px-4 py-3 text-right">{money(d.rpa)}</td>}
      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(d.revenue)}</td>}
      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(d.payout)}</td>}
      {shown.has('Profit') && <td className="px-4 py-3 text-right">{money(d.margin)}</td>}
      {shown.has('Margin') && <td className="px-4 py-3 text-right">{pct(d.marginPct)}</td>}
    </>
  );
}

function SingleSelectDropdown({ label, value, onChange }: { label: string; value: DimKey; onChange: (k: DimKey) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <label className="label">{label} <span className="text-danger-text">*</span></label>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between !py-2 text-left">
        {DIM_OPTIONS.find((d) => d.key === value)?.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-48 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
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
  childDim, parentFilterParam, parentRawId, from, to, opts, smartLinkMap, shown, dimParams,
}: {
  childDim: DimKey; parentFilterParam: string; parentRawId: string; from: string; to: string;
  dimParams: Record<string, string | number | undefined>;
  opts: Opts; smartLinkMap: Map<string, string>; shown: Set<string>;
}) {
  // Child rows use the page's filters + date range, narrowed to this parent. The parent value is set
  // last (overrides a page filter on the same dimension). Text values may contain commas ("Comcast
  // Cable, LLC"), so they're sent as `key[]=value`, which the API takes literally instead of splitting.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(dimParams)) if (v !== undefined && v !== '' && k !== parentFilterParam) params.set(k, String(v));
  params.set('groupBy', childDim); params.set('metrics', METRICS_PARAM);
  params.set('from', toIso(from)); params.set('to', toIso(to, true)); params.set('limit', '200');
  if (/Id$/.test(parentFilterParam)) params.set(parentFilterParam, parentRawId);
  else params.append(`${parentFilterParam}[]`, parentRawId);
  const { data, loading, error } = useQuery<AggResult>(`/api/reports?${params.toString()}`);
  const rows = useMemo(() => (data?.rows ?? [])
    .filter((r) => r.dimensions[childDim])
    .map((r) => ({ raw: r.dimensions[childDim]!, name: resolveName(childDim, r.dimensions[childDim] ?? null, opts, smartLinkMap), derived: deriveRow(r.metrics) })),
  [data, childDim, opts, smartLinkMap]);

  if (loading) return <tr><td colSpan={1 + ALL_COLUMNS.length + 1} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (error) return <tr><td colSpan={1 + ALL_COLUMNS.length + 1} className="px-4 py-3 text-small text-danger-text">{error}</td></tr>;
  if (!rows.length) return <tr><td colSpan={1 + ALL_COLUMNS.length + 1} className="px-4 py-3 text-small text-fg-muted">No activity for this period.</td></tr>;
  return (
    <>
      {rows.map((r, i) => (
        <tr key={i} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{r.name}</td>
          {metricCells(shown, r.derived)}
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

/** Initial report state from the URL — what "Copy Link to Report" writes. */
function readNestedUrl() {
  const sp = new URLSearchParams(window.location.search);
  let from = readUrlDate(sp, 'from', daysAgo(7));
  const to = readUrlDate(sp, 'to', todayStr());
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

  const [init] = useState(readNestedUrl);
  const [parentDim, setParentDim] = useState<DimKey>(init.parentDim);
  const [childDim, setChildDim] = useState<DimKey>(init.childDim);
  const [appliedParentDim, setAppliedParentDim] = useState<DimKey>(parentDim);
  const [appliedChildDim, setAppliedChildDim] = useState<DimKey>(childDim);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [filters, setFilters] = useState<FilterValues>(init.filters);
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(init.filters);
  const [exclusions, setExclusions] = useState<FilterValues>(init.exclusions);
  const [appliedExclusions, setAppliedExclusions] = useState<FilterValues>(init.exclusions);
  const [metricFilters, setMetricFilters] = useState<MetricFilters>(init.metricFilters);
  const [appliedMetricFilters, setAppliedMetricFilters] = useState<MetricFilters>(init.metricFilters);
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(init.ignoreFail);
  const [appliedIgnoreFailTraffic, setAppliedIgnoreFailTraffic] = useState(init.ignoreFail);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hasRun, setHasRun] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [orderBy, setOrderBy] = useState<OrderMetric>(init.orderBy);
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>(init.orderDir);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('nested-report') as unknown as { name: string; config: SavedConfig }[]);
  const [copied, setCopied] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

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
  const excludeOfferId = appliedExclusions['offer']?.join(',');
  const excludeAdvertiserId = appliedExclusions['advertiser']?.join(',');
  const excludePublisherId = appliedExclusions['partner']?.join(',');
  const excludeSmartLinkId = appliedExclusions['smartLink']?.join(',');
  const excludeCountry = appliedExclusions['country']?.join(',');
  const excludeDevice = appliedExclusions['device']?.join(',');
  const dimParams = {
    offerId: appliedFilters['offer']?.join(','), advertiserId: appliedFilters['advertiser']?.join(','),
    publisherId: appliedFilters['partner']?.join(','), smartLinkId: appliedFilters['smartLink']?.join(','),
    country: appliedFilters['country']?.join(','), device: appliedFilters['device']?.join(','),
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeSmartLinkId, excludeCountry, excludeDevice,
    excludeInvalid: appliedIgnoreFailTraffic ? 1 : undefined,
  };

  const summaryQs = qs({ groupBy: 'none', metrics: METRICS_PARAM, from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams });
  const { data: summaryData, loading: summaryLoading, error: summaryError } = useQuery<AggResult>(hasRun ? `/api/reports?${summaryQs}` : null);
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

  const chronological = appliedFrom !== appliedTo;
  const graphQs = qs({ groupBy: chronological ? 'day' : 'hour', metrics: 'clicks,revenue', from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams, limit: 200 });
  const { data: graphData } = useQuery<AggResult>(graphOpen ? `/api/reports?${graphQs}` : null);
  const graphSeries = useMemo(() => {
    const dimKey = chronological ? 'day' : 'hour';
    const rows = [...(graphData?.rows ?? [])].sort((a, b) => (a.dimensions[dimKey] ?? '').localeCompare(b.dimensions[dimKey] ?? ''));
    return {
      labels: rows.map((r) => (r.dimensions[dimKey] ?? '').slice(0, 10)),
      revenue: rows.map((r) => num(r.metrics['revenue'] ?? 0)),
      clicks: rows.map((r) => num(r.metrics['clicks'] ?? 0)),
    };
  }, [graphData, chronological]);

  const tableQsFor = (limit: number, offset: number) => qs({
    groupBy: appliedParentDim, metrics: METRICS_PARAM,
    from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams,
    orderBy, orderDir, limit, offset,
  });
  const tableQs = tableQsFor(pageSize, (page - 1) * pageSize);
  const { data, loading, error } = useQuery<AggResult>(hasRun ? `/api/reports?${tableQs}` : null);

  const toParentRows = (src: AggRow[]) => src
    .filter((r) => r.dimensions[appliedParentDim])
    .map((r) => ({ raw: r.dimensions[appliedParentDim]!, name: resolveName(appliedParentDim, r.dimensions[appliedParentDim] ?? null, opts, smartLinkMap), derived: deriveRow(r.metrics) }));
  const rows = useMemo(() => toParentRows(data?.rows ?? [])
    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.derived, appliedMetricFilters)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toParentRows only closes over the listed values
  [data, appliedParentDim, opts, smartLinkMap, q, appliedMetricFilters]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedParentDim(parentDim); setAppliedChildDim(childDim); setAppliedFilters(filters);
    setAppliedExclusions(exclusions); setAppliedMetricFilters(metricFilters); setAppliedIgnoreFailTraffic(ignoreFailTraffic);
    setHasRun(true); setPage(1); setExpanded(new Set());
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setParentDim('offer'); setChildDim('publisher');
    setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedParentDim('offer'); setAppliedChildDim('publisher');
    setAppliedFilters({}); setAppliedExclusions({}); setAppliedMetricFilters({}); setAppliedIgnoreFailTraffic(false);
    setPage(1);
  };
  const toggleSort = (m: OrderMetric) => {
    if (orderBy === m) setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setOrderBy(m); setOrderDir('desc'); }
    setPage(1);
  };
  const toggleExpand = (key: string) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  // Export every parent row matching the applied filters (all pages, not the expanded children), with
  // the same client-side metric filters as the table — but not the "Search this page" box.
  const reportExport = useReportExport();
  const runExport = (format: 'csv' | 'xlsx') => {
    void reportExport.run(format, 'nested-report', async () => {
      const res = await fetchAllPages<AggRow>((limit, offset) => `/api/reports?${tableQsFor(limit, offset)}`, 200);
      return { ...res, rows: exportRows(toParentRows(res.rows).filter((r) => passesMetricFilters(r.derived, appliedMetricFilters))) };
    });
  };
  const exportRows = (list: ReturnType<typeof toParentRows>) => list.map((r) => ({
    [DIM_OPTIONS.find((d) => d.key === appliedParentDim)?.label ?? appliedParentDim]: r.name,
    imp: DASH, rpm: DASH, cpm: DASH, grossClicks: r.derived.clicksGross, clicks: r.derived.clicks,
    uniqueClicks: r.derived.uniqueClicks, dupClicks: r.derived.dupClicks, invalidClicks: r.derived.invalidClicks,
    totalCv: r.derived.totalCv, cv: r.derived.cv, vtCv: DASH, ctr: DASH, throttle: DASH,
    cvr: pct(r.derived.cvr), cpc: r.derived.cpc.toFixed(2), cpa: r.derived.cpa.toFixed(2),
    rpc: r.derived.rpc.toFixed(2), rpa: r.derived.rpa.toFixed(2),
    revenue: r.derived.revenue.toFixed(2), payout: r.derived.payout.toFixed(2), profit: r.derived.margin.toFixed(2),
    margin: pct(r.derived.marginPct),
  }));

  const sortIcon = (m: OrderMetric) => (orderBy === m ? (orderDir === 'desc' ? '↓' : '↑') : '');
  const sortableHeader = (label: string, m: OrderMetric) => (
    <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort(m)}>{label} {sortIcon(m)}</th>
  );

  const saveReport = (name: string) => {
    const config: SavedConfig = { from, to, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns], parentDim, childDim };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('nested-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    setFrom(config.from); setTo(config.to); setFilters(config.filters); setParentDim(config.parentDim); setChildDim(config.childDim);
    setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setAppliedFrom(config.from); setAppliedTo(config.to); setAppliedFilters(config.filters); setAppliedParentDim(config.parentDim); setAppliedChildDim(config.childDim);
    setAppliedExclusions(config.exclusions ?? {}); setAppliedMetricFilters(config.metricFilters ?? {}); setAppliedIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(config.orderBy); setOrderDir(config.orderDir); setHiddenColumns(new Set(config.hiddenColumns));
    setPage(1); setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('nested-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
  };
  const copyLink = async () => {
    const mf = new URLSearchParams();
    writeUrlMetricFilters(mf, appliedMetricFilters);
    await navigator.clipboard?.writeText(reportLink({
      from: appliedFrom, to: appliedTo, parent: appliedParentDim, child: appliedChildDim,
      ...urlFilterParams('f', appliedFilters), ...urlFilterParams('x', appliedExclusions),
      ...Object.fromEntries(mf), [IGNORE_FAIL_PARAM]: appliedIgnoreFailTraffic,
      orderBy, orderDir,
    }));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const parentOpt = DIM_OPTIONS.find((d) => d.key === appliedParentDim)!;
  const childOpt = DIM_OPTIONS.find((d) => d.key === appliedChildDim)!;

  return (
    <>
      <PageHeader title="Dynamic Nested Report" subtitle="Analytics › Dynamic Nested" action={
        <div className="relative">
          <button type="button" title="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
          {pageMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => setLoadOpen(false)}>
              <button onClick={() => { setPageMenuOpen(false); setSaveModalOpen(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Save</button>
              <div className="relative" onMouseEnter={() => setLoadOpen(true)}>
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
              <button onClick={() => { copyLink(); setPageMenuOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{copied ? 'Copied!' : 'Copy Link to Report'}</button>
              <button onClick={() => { setPageMenuOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
            </div>
          )}
        </div>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <SingleSelectDropdown label="Parent" value={parentDim} onChange={setParentDim} />
          <SingleSelectDropdown label="Child" value={childDim} onChange={setChildDim} />
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg relative">
              <SlidersHorizontal size={15} />
              {reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic }) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic })}
                </span>
              )}
            </button>
            {filterOpen && (
              <ReportingFiltersFlyout
                dimCategories={FILTER_CATEGORIES}
                value={{ filters, exclusions, metricFilters, ignoreFailTraffic }}
                onApply={(v) => { setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic); }}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card mb-4">
        <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
        </button>
        {summaryOpen && (
          summaryLoading ? <div className="pt-4"><Spinner /></div> : summaryError ? <p className="pt-3 text-small text-danger-text">{summaryError}</p> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <SummaryGrid summary={summary} />
          )
        )}
      </div>

      <div className="card mb-4">
        <button type="button" onClick={() => setGraphOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronRight size={14} className={`transition-transform ${graphOpen ? 'rotate-90' : ''}`} /> Performance Graph
        </button>
        {graphOpen && (
          !graphData ? <div className="pt-4"><Spinner /></div> : graphSeries.labels.length === 0 ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <div className="pt-4">
              <div className="mb-2 flex items-center gap-4 text-tiny text-fg-secondary">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded bg-accent-text" /> Revenue</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-fg-muted" /> Clicks</span>
              </div>
              <MiniChart labels={graphSeries.labels} revenue={graphSeries.revenue} clicks={graphSeries.clicks} />
            </div>
          )
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <ActiveFilterChips className="mb-3"
            chips={[...chipsFromValues(FILTER_CATEGORIES, appliedFilters), ...chipsFromValues(FILTER_CATEGORIES, appliedExclusions, { exclude: true })]}
            onRemove={(c) => {
              if (c.exclude) { const n = withoutValue(appliedExclusions, c.key, c.value); setExclusions(n); setAppliedExclusions(n); }
              else { const n = withoutValue(appliedFilters, c.key, c.value); setFilters(n); setAppliedFilters(n); } setPage(1);
            }}
            onClearAll={() => { setFilters({}); setAppliedFilters({}); setExclusions({}); setAppliedExclusions({}); setPage(1); }} />
          <div>
            <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
            <p className="text-tiny text-fg-muted">Learn more about <Link to="/app/reports/custom-metrics" className="text-accent-text hover:underline">Custom Reporting Metrics</Link></p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search this page…" title="Filters only the rows on the current page" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="relative">
              <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
                className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
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
          </div>
        </div>

        <ExportStatus busy={reportExport.busy} note={reportExport.note} error={reportExport.error} onDismiss={reportExport.dismiss} />
        {!hasRun ? <StateBlock>Set parameters and run report</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
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
                        {metricCells(shown, r.derived)}
                        <td className="text-right">
                          <RowActionMenu dim={appliedParentDim} id={r.raw} label={r.name} />
                        </td>
                      </tr>
                      {expanded.has(r.raw) && (
                        <ExpandedChildRows
                          childDim={appliedChildDim} parentFilterParam={parentOpt.filterParam} parentRawId={r.raw}
                          from={appliedFrom} to={appliedTo} opts={opts} smartLinkMap={smartLinkMap} shown={shown} dimParams={dimParams}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-3 flex justify-end">
          <Pagination total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
      </div>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, parent: appliedParentDim, child: appliedChildDim,
        offer: dimParams.offerId, advertiser: dimParams.advertiserId, partner: dimParams.publisherId, smartLink: dimParams.smartLinkId, country: dimParams.country, device: dimParams.device,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeSmartLink: excludeSmartLinkId, excludeCountry, excludeDevice,
        ignoreFailTraffic: appliedIgnoreFailTraffic ? 'true' : undefined,
      }} />}
      <PromptModal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save Report" message="Name this saved report:" placeholder="e.g. Nested Overview" onConfirm={saveReport} />
    </>
  );
}
