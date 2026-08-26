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
 * real, derived via the same `deriveRow` used by every other report page.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreVertical, Plus, Search, X } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../../components/ui';
import { FilterButton, type FilterCategory, type FilterValues } from '../../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../../lib/export';
import {
  type AggResult, METRICS_PARAM, DASH, DEVICES, money, pct, num, toIso, daysAgo, todayStr,
  deriveRow, type DerivedRow, MiniChart, SummaryGrid, Pagination,
  type MetricFilters, passesMetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
  type SavedReportConfig, loadSavedReports, persistSavedReports,
} from '../../../components/ReportPageKit';
import { useReportOpts, type Opts } from '../Reports';

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
type OrderMetric = 'clicks' | 'total_conversions' | 'payout' | 'revenue' | 'margin';

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

function metricCells(d: DerivedRow) {
  return (
    <>
      <td className="px-4 py-3 text-right">{d.clicks.toLocaleString()}</td>
      <td className="px-4 py-3 text-right">{d.totalCv.toLocaleString()}</td>
      <td className="px-4 py-3 text-right">{money(d.rpa)}</td>
      <td className="px-4 py-3 text-right">{money(d.cpa)}</td>
      <td className="px-4 py-3 text-right">{pct(d.cvr)}</td>
      <td className="px-4 py-3 text-right">{money(d.revenue)}</td>
      <td className="px-4 py-3 text-right">{money(d.payout)}</td>
      <td className="px-4 py-3 text-right">{money(d.margin)}</td>
      <td className="px-4 py-3 text-right">{pct(d.marginPct)}</td>
      <td className="px-4 py-3 text-right">{money(d.epc)}</td>
    </>
  );
}

type SavedConfig = SavedReportConfig<OrderMetric> & { dims: DimKey[] };

export default function FlexReport() {
  const opts = useReportOpts();
  const smartLinkMap = useMemo(() => new Map(opts.smartLinks?.map((s: { value: string; label: string }) => [s.value, s.label]) ?? []), [opts.smartLinks]);

  const [dims, setDims] = useState<DimKey[]>(['offer', 'publisher']);
  const [dimPickerOpen, setDimPickerOpen] = useState(false);
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [appliedDims, setAppliedDims] = useState<DimKey[]>(dims);
  const [filters, setFilters] = useState<FilterValues>({});
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>({});
  const [exclusions, setExclusions] = useState<FilterValues>({});
  const [appliedExclusions, setAppliedExclusions] = useState<FilterValues>({});
  const [metricFilters, setMetricFilters] = useState<MetricFilters>({});
  const [appliedMetricFilters, setAppliedMetricFilters] = useState<MetricFilters>({});
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(false);
  const [appliedIgnoreFailTraffic, setAppliedIgnoreFailTraffic] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hasRun, setHasRun] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [orderBy, setOrderBy] = useState<OrderMetric>('clicks');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('flex-report') as unknown as { name: string; config: SavedConfig }[]);
  const [copied, setCopied] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);

  const { data: offers } = useQuery<{ id: string; name: string }[]>('/api/offers');
  const { data: publishers } = useQuery<{ id: string; name: string }[]>('/api/publishers');
  const { data: advertisers } = useQuery<{ id: string; name: string }[]>('/api/advertisers');
  const { data: smartLinksList } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)).sort()
    .map((c) => ({ value: c, label: c })), [countryAgg]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'smartLink', label: 'Smart Link', options: (smartLinksList ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICES.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })) },
  ], [offers, advertisers, publishers, smartLinksList, countryOptions]);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const excludeOfferId = appliedExclusions['offer']?.[0];
  const excludeAdvertiserId = appliedExclusions['advertiser']?.[0];
  const excludePublisherId = appliedExclusions['partner']?.[0];
  const excludeSmartLinkId = appliedExclusions['smartLink']?.[0];
  const excludeCountry = appliedExclusions['country']?.[0];
  const excludeDevice = appliedExclusions['device']?.[0];
  const dimParams = {
    offerId: appliedFilters['offer']?.[0], advertiserId: appliedFilters['advertiser']?.[0],
    publisherId: appliedFilters['partner']?.[0], smartLinkId: appliedFilters['smartLink']?.[0],
    country: appliedFilters['country']?.[0], device: appliedFilters['device']?.[0],
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeSmartLinkId, excludeCountry, excludeDevice,
    excludeInvalid: appliedIgnoreFailTraffic ? 1 : undefined,
  };

  const groupByStr = appliedDims.join(',');
  const summaryQs = qs({ groupBy: groupByStr, metrics: 'clicks,unique_clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,avg_fraud_score', from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams, limit: 200 });
  const { data: summaryData, loading: summaryLoading } = useQuery<AggResult>(hasRun ? `/api/reports?${summaryQs}` : null);
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

  const tableQs = qs({
    groupBy: groupByStr, metrics: METRICS_PARAM,
    from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams,
    orderBy, orderDir, limit: pageSize, offset: (page - 1) * pageSize,
  });
  const { data, loading, error } = useQuery<AggResult>(hasRun && appliedDims.length ? `/api/reports?${tableQs}` : null);

  const rows = useMemo(() => (data?.rows ?? []).map((r) => ({
    key: appliedDims.map((d) => r.dimensions[d] ?? '~').join('|'),
    dims: appliedDims.map((d) => ({ dim: d, raw: r.dimensions[d] ?? null, name: resolveName(d, r.dimensions[d] ?? null, opts, smartLinkMap) })),
    derived: deriveRow(r.metrics),
  }))
    .filter((r) => !q.trim() || r.dims.some((d) => d.name.toLowerCase().includes(q.trim().toLowerCase())))
    .filter((r) => passesMetricFilters(r.derived, appliedMetricFilters)),
  [data, appliedDims, opts, smartLinkMap, q, appliedMetricFilters]);

  const addDim = (k: DimKey) => { if (dims.length < MAX_DIMS && !dims.includes(k)) setDims([...dims, k]); setDimPickerOpen(false); };
  const removeDim = (k: DimKey) => setDims(dims.filter((d) => d !== k));

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedDims(dims); setAppliedFilters(filters);
    setAppliedExclusions(exclusions); setAppliedMetricFilters(metricFilters); setAppliedIgnoreFailTraffic(ignoreFailTraffic);
    setHasRun(true); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setDims(['offer', 'publisher']); setFilters({});
    setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedDims(['offer', 'publisher']); setAppliedFilters({});
    setAppliedExclusions({}); setAppliedMetricFilters({}); setAppliedIgnoreFailTraffic(false);
    setPage(1);
  };
  const toggleSort = (m: OrderMetric) => {
    if (orderBy === m) setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setOrderBy(m); setOrderDir('desc'); }
    setPage(1);
  };

  const shownMetrics = useMemo(() => new Set(METRIC_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const exportRows = () => rows.map((r) => {
    const base: Record<string, unknown> = {};
    r.dims.forEach((d) => { base[DIM_OPTIONS.find((o) => o.key === d.dim)?.label ?? d.dim] = d.name; });
    return {
      ...base, clicks: r.derived.clicks, totalCv: r.derived.totalCv, rpa: r.derived.rpa.toFixed(2), cpa: r.derived.cpa.toFixed(2),
      cvr: pct(r.derived.cvr), revenue: r.derived.revenue.toFixed(2), payout: r.derived.payout.toFixed(2),
      profit: r.derived.margin.toFixed(2), margin: pct(r.derived.marginPct), epc: r.derived.epc.toFixed(3),
    };
  });

  const saveReport = () => {
    const name = window.prompt('Name this saved report:');
    if (!name) return;
    const config: SavedConfig = { from, to, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns], dims };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('flex-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    setFrom(config.from); setTo(config.to); setFilters(config.filters); setDims(config.dims);
    setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setAppliedFrom(config.from); setAppliedTo(config.to); setAppliedFilters(config.filters); setAppliedDims(config.dims);
    setAppliedExclusions(config.exclusions ?? {}); setAppliedMetricFilters(config.metricFilters ?? {}); setAppliedIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(config.orderBy); setOrderDir(config.orderDir); setHiddenColumns(new Set(config.hiddenColumns));
    setPage(1); setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('flex-report', next as unknown as { name: string; config: SavedReportConfig<OrderMetric> }[]);
  };
  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Flex Report" subtitle="Analytics › Flex" action={
        <div className="relative">
          <button type="button" title="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
          {pageMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => setLoadOpen(false)}>
              <button onClick={saveReport} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Save</button>
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
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="relative">
            <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={() => setDimPickerOpen((o) => !o)} disabled={dims.length >= MAX_DIMS}>
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
          {dims.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-tiny font-medium text-accent-text">
              {DIM_OPTIONS.find((o) => o.key === d)?.label}
              <button onClick={() => removeDim(d)}><X size={12} /></button>
            </span>
          ))}
          <div className="relative">
            <FilterButton
              count={reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic })}
              onClick={() => setFilterOpen((o) => !o)}
            />
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
          summaryLoading ? <div className="pt-4"><Spinner /></div> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
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
          <div>
            <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
            <p className="text-tiny text-fg-muted">Learn more about <Link to="/app/reports/custom-metrics" className="text-accent-text hover:underline">Custom Reporting Metrics</Link></p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                        <button onClick={() => { downloadCsv('flex-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('flex-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {!appliedDims.length ? <StateBlock>Add at least one column to see a breakdown.</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[1400px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    {appliedDims.map((d) => <th key={d} className="whitespace-nowrap px-4 py-3 font-semibold">{DIM_OPTIONS.find((o) => o.key === d)?.label}</th>)}
                    {shownMetrics.has('Clicks') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('clicks')}>Clicks {orderBy === 'clicks' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Total CV') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('total_conversions')}>Total CV {orderBy === 'total_conversions' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('RPA') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">RPA</th>}
                    {shownMetrics.has('CPA') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CPA</th>}
                    {shownMetrics.has('CVR') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CVR</th>}
                    {shownMetrics.has('Revenue') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('revenue')}>Revenue {orderBy === 'revenue' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Payout') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('payout')}>Payout {orderBy === 'payout' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Profit') && <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort('margin')}>Profit {orderBy === 'margin' ? (orderDir === 'desc' ? '↓' : '↑') : ''}</th>}
                    {shownMetrics.has('Margin') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Margin</th>}
                    {shownMetrics.has('EPC') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">EPC</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-accent-subtle/40">
                      {r.dims.map((d, i) => (
                        <td key={i} className="whitespace-nowrap px-4 py-3">
                          {d.raw != null && linkFor(d.dim, d.raw) ? <Link to={linkFor(d.dim, d.raw)!} className="text-accent-text hover:underline">{d.name}</Link> : d.name}
                        </td>
                      ))}
                      {metricCells(r.derived)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-3 flex justify-end">
          <Pagination total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
      </div>

      {showColumns && <ColumnsModal allColumns={METRIC_COLUMNS} order={[...METRIC_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, columns: appliedDims.join(','),
        offer: dimParams.offerId, advertiser: dimParams.advertiserId, partner: dimParams.publisherId, smartLink: dimParams.smartLinkId, country: dimParams.country, device: dimParams.device,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeSmartLink: excludeSmartLinkId, excludeCountry, excludeDevice,
        ignoreFailTraffic: appliedIgnoreFailTraffic ? 'true' : undefined,
      }} />}
    </>
  );
}
