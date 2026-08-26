/**
 * Reporting › Partner — verified item-by-item against the live reference, including the full
 * Detailed Report column set (26 columns — notably wider than the Offer Report's: RPM/CPM/Gross
 * Clicks/VT CV/CTR are real TABLE columns here, not Summary-only, and EPC/"Click to Event
 * rate"/"Invalid Clicks %"/"cc" appear as well). Shares its Summary tile grid, "Reporting Filters"
 * flyout (Filters/Metric Filters/Exclusions/Others), and page-level kebab with the Offer Report —
 * see components/ReportPageKit.tsx.
 *
 * EPC (payout/clicks) is a real pre-existing backend metric never surfaced in this app's UI before.
 * "Invalid Clicks %" is real (invalid/gross, derived client-side). RPM/CPM/VT CV/CTR/Throttle/
 * Events/"Click to Event rate"/"cc" have no real source anywhere in this app (no impression/pixel
 * tracking, no view-through attribution, no per-click throttle outcome, no distinct "events" or
 * coupon-code-on-conversion concept) — shown as "—" rather than a fabricated value.
 *
 * Row actions are simpler than the Offer Report's: the live reference's Partner row kebab has only
 * View Partner + Open Flex Report (no visibility picker, no add-conversion — those are offer-scoped
 * concepts on the reference too).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search, MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { FilterButton, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import type { Advertiser, Offer, Publisher } from '../../types';
import {
  type AggResult, METRICS_PARAM, DASH, DEVICES, money, pct, num, toIso, daysAgo, todayStr,
  deriveRow, type DerivedRow, MiniChart, SummaryGrid, RowKebabMenu, Pagination,
  type MetricFilters, passesMetricFilters,
  reportingFiltersCount, ReportingFiltersFlyout,
  type SavedReportConfig, loadSavedReports, persistSavedReports,
} from '../../components/ReportPageKit';

const ALL_COLUMNS = [
  'RPM', 'CPM', 'Gross Clicks', 'Clicks', 'Uniq. Clicks', 'Dup. Clicks', 'Invalid Clicks', 'Total CV', 'CV',
  'VT CV', 'CTR', 'Throttle', 'Events', 'CVR', 'CPC', 'CPA', 'EPC', 'RPC', 'RPA', 'Revenue', 'Payout',
  'Profit', 'Margin', 'Click to Event Rate', 'Invalid Clicks %', 'CC',
] as const;
type OrderMetric = 'clicks' | 'unique_clicks' | 'invalid_clicks' | 'conversions' | 'total_conversions' | 'payout' | 'revenue' | 'margin' | 'avg_fraud_score';

function metricCells(shown: Set<string>, d: DerivedRow) {
  return (
    <>
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
      {shown.has('Events') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('CVR') && <td className="px-4 py-3 text-right">{pct(d.cvr)}</td>}
      {shown.has('CPC') && <td className="px-4 py-3 text-right">{money(d.cpc)}</td>}
      {shown.has('CPA') && <td className="px-4 py-3 text-right">{money(d.cpa)}</td>}
      {shown.has('EPC') && <td className="px-4 py-3 text-right">{money(d.epc)}</td>}
      {shown.has('RPC') && <td className="px-4 py-3 text-right">{money(d.rpc)}</td>}
      {shown.has('RPA') && <td className="px-4 py-3 text-right">{money(d.rpa)}</td>}
      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(d.revenue)}</td>}
      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(d.payout)}</td>}
      {shown.has('Profit') && <td className="px-4 py-3 text-right">{money(d.margin)}</td>}
      {shown.has('Margin') && <td className="px-4 py-3 text-right">{pct(d.marginPct)}</td>}
      {shown.has('Click to Event Rate') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('Invalid Clicks %') && <td className="px-4 py-3 text-right">{pct(d.invalidPct)}</td>}
      {shown.has('CC') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
    </>
  );
}

interface OfferRow { offerId: string; offerName: string; derived: DerivedRow }
function ExpandedOfferRows({ publisherId, colSpanBefore, shown }: { publisherId: string; colSpanBefore: number; shown: Set<string> }) {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data, loading } = useQuery<AggResult>(`/api/reports?groupBy=offer&metrics=${METRICS_PARAM}&publisherId=${publisherId}&limit=200`);
  const rows: OfferRow[] = useMemo(() => (data?.rows ?? [])
    .filter((r) => r.dimensions['offer'])
    .map((r) => ({
      offerId: r.dimensions['offer']!,
      offerName: offers?.find((o) => o.id === r.dimensions['offer'])?.name ?? r.dimensions['offer']!.slice(0, 8),
      derived: deriveRow(r.metrics),
    })), [data, offers]);

  if (loading) return <tr><td colSpan={colSpanBefore + ALL_COLUMNS.length} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (!rows.length) return <tr><td colSpan={colSpanBefore + ALL_COLUMNS.length} className="px-4 py-3 text-small text-fg-muted">No offer activity for this partner in the selected period.</td></tr>;

  return (
    <>
      {rows.map((r) => (
        <tr key={r.offerId} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{r.offerName}</td>
          {metricCells(shown, r.derived)}
          <td />
        </tr>
      ))}
    </>
  );
}

interface RowActionMenuProps { publisher: { id: string; name: string } }
function RowActionMenu({ publisher }: RowActionMenuProps) {
  const nav = useNavigate();
  return (
    <RowKebabMenu items={[
      { label: 'View Partner', onClick: () => nav(`/app/publishers/${publisher.id}`) },
      { label: 'Open Flex Report', onClick: () => nav(`/app/analytics?tab=flex&publisherId=${publisher.id}`) },
    ]} />
  );
}

type SavedConfig = SavedReportConfig<OrderMetric>;

export default function PartnerReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlPublisherId = searchParams.get('publisherId') ?? searchParams.get('partnerId') ?? '';

  const [from, setFrom] = useState(searchParams.get('from') ?? daysAgo(30));
  const [to, setTo] = useState(searchParams.get('to') ?? todayStr());
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const initialFilters: FilterValues = urlPublisherId ? { partner: [urlPublisherId] } : {};
  const [filters, setFilters] = useState<FilterValues>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(initialFilters);
  const [exclusions, setExclusions] = useState<FilterValues>({});
  const [appliedExclusions, setAppliedExclusions] = useState<FilterValues>({});
  const [metricFilters, setMetricFilters] = useState<MetricFilters>({});
  const [appliedMetricFilters, setAppliedMetricFilters] = useState<MetricFilters>({});
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(false);
  const [appliedIgnoreFailTraffic, setAppliedIgnoreFailTraffic] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [orderBy, setOrderBy] = useState<OrderMetric>((searchParams.get('orderBy') as OrderMetric) || 'clicks');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>((searchParams.get('orderDir') as 'asc' | 'desc') || 'desc');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) { setTableActionsOpen(false); setExportOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('partner-report'));
  const [copied, setCopied] = useState(false);
  const pageMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pageMenuOpen) return;
    const onDown = (e: MouseEvent) => { if (!pageMenuRef.current?.contains(e.target as Node)) { setPageMenuOpen(false); setLoadOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pageMenuOpen]);

  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country'])
    .filter((c): c is string => Boolean(c))
    .sort()
    .map((c) => ({ value: c, label: c })), [countryAgg]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICES.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })) },
  ], [offers, advertisers, publishers, countryOptions]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const advertiserIdFilter = appliedFilters['advertiser']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const countryFilter = appliedFilters['country']?.[0];
  const deviceFilter = appliedFilters['device']?.[0];
  const excludeOfferId = appliedExclusions['offer']?.[0];
  const excludeAdvertiserId = appliedExclusions['advertiser']?.[0];
  const excludePublisherId = appliedExclusions['partner']?.[0];
  const excludeCountry = appliedExclusions['country']?.[0];
  const excludeDevice = appliedExclusions['device']?.[0];

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  useEffect(() => {
    const next = new URLSearchParams();
    next.set('from', appliedFrom);
    next.set('to', appliedTo);
    if (publisherIdFilter) next.set('publisherId', publisherIdFilter);
    if (offerIdFilter) next.set('offerId', offerIdFilter);
    if (countryFilter) next.set('country', countryFilter);
    if (deviceFilter) next.set('device', deviceFilter);
    next.set('orderBy', orderBy);
    next.set('orderDir', orderDir);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFrom, appliedTo, publisherIdFilter, offerIdFilter, countryFilter, deviceFilter, orderBy, orderDir]);

  const dimParams = {
    offerId: offerIdFilter, advertiserId: advertiserIdFilter, publisherId: publisherIdFilter,
    country: countryFilter, device: deviceFilter,
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeCountry, excludeDevice,
    excludeInvalid: appliedIgnoreFailTraffic ? 1 : undefined,
  };

  const summaryQs = qs({ groupBy: 'publisher', metrics: METRICS_PARAM, from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams, limit: 200 });
  const { data: summaryData, loading: summaryLoading } = useQuery<AggResult>(`/api/reports?${summaryQs}`);
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

  const graphQs = qs({ groupBy: 'day', metrics: 'clicks,revenue', from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams, limit: 200 });
  const { data: graphData } = useQuery<AggResult>(graphOpen ? `/api/reports?${graphQs}` : null);
  const graphSeries = useMemo(() => {
    const rows = [...(graphData?.rows ?? [])].sort((a, b) => (a.dimensions['day'] ?? '').localeCompare(b.dimensions['day'] ?? ''));
    return {
      labels: rows.map((r) => (r.dimensions['day'] ?? '').slice(0, 10)),
      revenue: rows.map((r) => num(r.metrics['revenue'] ?? 0)),
      clicks: rows.map((r) => num(r.metrics['clicks'] ?? 0)),
    };
  }, [graphData]);

  const tableQs = qs({
    groupBy: 'publisher', metrics: METRICS_PARAM,
    from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams,
    orderBy, orderDir, limit: pageSize, offset: (page - 1) * pageSize,
  });
  const { data, loading, error } = useQuery<AggResult>(`/api/reports?${tableQs}`);

  const rows = useMemo(() => (data?.rows ?? [])
    .filter((r) => r.dimensions['publisher'])
    .map((r) => {
      const publisher = publishers?.find((p) => p.id === r.dimensions['publisher']);
      return { publisherId: r.dimensions['publisher']!, publisherName: publisher?.name ?? r.dimensions['publisher']!.slice(0, 8), publisherStatus: publisher?.status, derived: deriveRow(r.metrics) };
    })
    .filter((r) => !q.trim() || r.publisherName.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.derived, appliedMetricFilters)),
  [data, publishers, q, appliedMetricFilters]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedFilters(filters);
    setAppliedExclusions(exclusions); setAppliedMetricFilters(metricFilters); setAppliedIgnoreFailTraffic(ignoreFailTraffic);
    setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(30)); setTo(todayStr()); setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setAppliedFrom(daysAgo(30)); setAppliedTo(todayStr()); setAppliedFilters({});
    setAppliedExclusions({}); setAppliedMetricFilters({}); setAppliedIgnoreFailTraffic(false);
    setPage(1);
  };

  const toggleSort = (metric: OrderMetric) => {
    if (orderBy === metric) setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setOrderBy(metric); setOrderDir('desc'); }
    setPage(1);
  };
  const toggleExpand = (publisherId: string) => setExpanded((s) => { const n = new Set(s); n.has(publisherId) ? n.delete(publisherId) : n.add(publisherId); return n; });

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const exportRows = () => rows.map((r) => ({
    partner: r.publisherName, rpm: DASH, cpm: DASH, grossClicks: r.derived.clicksGross, clicks: r.derived.clicks,
    uniqueClicks: r.derived.uniqueClicks, dupClicks: r.derived.dupClicks, invalidClicks: r.derived.invalidClicks,
    totalCv: r.derived.totalCv, cv: r.derived.cv, vtCv: DASH, ctr: DASH, throttle: DASH, events: DASH,
    cvr: pct(r.derived.cvr), cpc: r.derived.cpc.toFixed(2), cpa: r.derived.cpa.toFixed(2), epc: r.derived.epc.toFixed(2),
    rpc: r.derived.rpc.toFixed(2), rpa: r.derived.rpa.toFixed(2),
    revenue: r.derived.revenue.toFixed(2), payout: r.derived.payout.toFixed(2), profit: r.derived.margin.toFixed(2),
    margin: pct(r.derived.marginPct), clickToEventRate: DASH, invalidClicksPct: pct(r.derived.invalidPct), cc: DASH,
  }));

  const sortIcon = (metric: OrderMetric) => (orderBy === metric ? (orderDir === 'desc' ? '↓' : '↑') : '');
  const sortableHeader = (label: string, metric: OrderMetric) => (
    <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort(metric)}>{label} {sortIcon(metric)}</th>
  );

  const saveReport = () => {
    const name = window.prompt('Name this saved report:');
    if (!name) return;
    const config: SavedConfig = { from, to, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns] };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('partner-report', next);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    setFrom(config.from); setTo(config.to); setFilters(config.filters);
    setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setAppliedFrom(config.from); setAppliedTo(config.to); setAppliedFilters(config.filters);
    setAppliedExclusions(config.exclusions ?? {}); setAppliedMetricFilters(config.metricFilters ?? {}); setAppliedIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(config.orderBy); setOrderDir(config.orderDir);
    setHiddenColumns(new Set(config.hiddenColumns));
    setPage(1); setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('partner-report', next);
  };
  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Partner Report" subtitle="Reporting › Partner" action={
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-small text-fg-secondary">(GMT+00:00) UTC <ChevronDown size={13} /></span>
          <span className="inline-flex items-center gap-1 text-small text-fg-secondary">$ {currency} <ChevronDown size={13} /></span>
          <div ref={pageMenuRef} className="relative">
            <button type="button" title="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {pageMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <button onClick={saveReport} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Save</button>
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
                <button onClick={() => { copyLink(); setPageMenuOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{copied ? 'Copied!' : 'Copy Link to Report'}</button>
                <button onClick={() => { setPageMenuOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
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
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search partners…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div ref={tableActionsRef} className="relative">
              <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
                className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                <MoreVertical size={15} />
              </button>
              {tableActionsOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                  <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                  <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
                    <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                      Export <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                    {exportOpen && (
                      <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                        <button onClick={() => { downloadCsv('partner-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('partner-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[2400px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">
                      Partner<br /><span className="text-[10px] normal-case text-fg-muted">↳ Offer</span>
                    </th>
                    {shown.has('RPM') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">RPM</th>}
                    {shown.has('CPM') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CPM</th>}
                    {shown.has('Gross Clicks') && sortableHeader('Gross Clicks', 'clicks')}
                    {shown.has('Clicks') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Clicks</th>}
                    {shown.has('Uniq. Clicks') && sortableHeader('Uniq. Clicks', 'unique_clicks')}
                    {shown.has('Dup. Clicks') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Dup. Clicks</th>}
                    {shown.has('Invalid Clicks') && sortableHeader('Invalid Clicks', 'invalid_clicks')}
                    {shown.has('Total CV') && sortableHeader('Total CV', 'total_conversions')}
                    {shown.has('CV') && sortableHeader('CV', 'conversions')}
                    {shown.has('VT CV') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">VT CV</th>}
                    {shown.has('CTR') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CTR</th>}
                    {shown.has('Throttle') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Throttle</th>}
                    {shown.has('Events') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Events</th>}
                    {shown.has('CVR') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CVR</th>}
                    {shown.has('CPC') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CPC</th>}
                    {shown.has('CPA') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CPA</th>}
                    {shown.has('EPC') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">EPC</th>}
                    {shown.has('RPC') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">RPC</th>}
                    {shown.has('RPA') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">RPA</th>}
                    {shown.has('Revenue') && sortableHeader('Revenue', 'revenue')}
                    {shown.has('Payout') && sortableHeader('Payout', 'payout')}
                    {shown.has('Profit') && sortableHeader('Profit', 'margin')}
                    {shown.has('Margin') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Margin</th>}
                    {shown.has('Click to Event Rate') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Click to Event Rate</th>}
                    {shown.has('Invalid Clicks %') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Invalid Clicks %</th>}
                    {shown.has('CC') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CC</th>}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <Fragment key={r.publisherId}>
                      <tr className="hover:bg-accent-subtle/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <button type="button" onClick={() => toggleExpand(r.publisherId)} className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
                            <ChevronRight size={13} className={`transition-transform ${expanded.has(r.publisherId) ? 'rotate-90' : ''}`} />
                            <span className={`h-2 w-2 rounded-full ${r.publisherStatus === 'active' ? 'bg-success' : 'bg-fg-muted'}`} />
                            {r.publisherName}
                          </button>
                        </td>
                        {metricCells(shown, r.derived)}
                        <td className="text-right">
                          <RowActionMenu publisher={{ id: r.publisherId, name: r.publisherName }} />
                        </td>
                      </tr>
                      {expanded.has(r.publisherId) && <ExpandedOfferRows publisherId={r.publisherId} colSpanBefore={1} shown={shown} />}
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
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, country: countryFilter, device: deviceFilter,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeCountry, excludeDevice,
        ignoreFailTraffic: appliedIgnoreFailTraffic ? 'true' : undefined,
      }} />}
    </>
  );
}
