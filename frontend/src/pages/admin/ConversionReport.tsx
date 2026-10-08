/**
 * Reporting › Conversion — verified against the live reference (78 real rows loaded on their demo
 * account, ~60 columns). Same raw event-log shape as Click Report (one row per conversion, no
 * Summary/graph). Backed by the existing `GET /api/reports/conversions` endpoint
 * (api-backend/src/surfaces/dashboard/reports/detail-reports.ts), extended with a LEFT JOIN to the
 * originating click (via click_id) for click-time context — Country/Region/City/ISP/Device/OS/
 * Browser/Sub1-5/Click Date/Delta all come from there, same as the reference's real "Click Date" and
 * "Delta" columns — plus a LEFT JOIN to offer_goals for a real Goal name.
 *
 * Columns are a reduced, fully-backed subset of the reference's ~60 (Date, Status, Reason, Offer,
 * Partner, Advertiser, Event Name, Goal, Source, Revenue, Payout, Currency, Transaction ID, Click
 * Date, Delta, Country, Region, City, ISP, Device, OS, Browser, Fraud, Sub1-5). The reference's
 * Partner/Account Manager, Sale Amount, Order ID/Number/Items, Coupon Code, Email, Language,
 * IDFA/Google Ad ID/Android ID, DMA, Attribution Method, etc. have no real source in this schema and
 * are omitted rather than faked.
 *
 * Pagination is "has more" (overfetch by one row), matching Click Report — the shared API client
 * discards response pagination metadata app-wide.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MoreVertical, ChevronRight, ChevronLeft, SlidersHorizontal } from 'lucide-react';
import { useMutation, useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock, Badge } from '../../shared-components/primitives/ui';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { CategoryFilterDrawer, type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategoryFilterDrawer';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, DEVICE_OPTIONS, fetchAllPages, useReportExport, ExportStatus } from '../../shared-components/primitives/ReportPageKit';
import type { Advertiser, Offer, Publisher } from '../../types';
import { countryName, countryOptions, regionName, useRegions } from '../../data/geo';
import { readUrlDate, readUrlIds, reportLink } from '../../lib/reportFilterState';
import { formatDateTime } from '../../lib/datetime';
import { TimeZoneSelect } from '../../shared-components/primitives/ReportTimeZone';
import { useReportTimeZone } from '../../lib/useReportTimeZone';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';

/**
 * Approve a pending conversion (writes publisher earning + advertiser billing and fires the partner
 * postback) or reject one (offsetting ledger entries — history is never edited). Admin/finance only.
 */
function ConversionActions({ row, onChanged }: { row: ConvRow; onChanged: () => void }) {
  const act = useMutation((action: 'approve' | 'reject') => api.post(`/api/finance/conversions/${row.conversion_id}/${action}`, {}));
  const confirm = useConfirm();
  if (row.status === 'rejected') return <span className="text-tiny text-fg-muted">—</span>;
  const go = async (action: 'approve' | 'reject') => {
    const run = async () => { if (await act.run(action)) onChanged(); };
    if (action !== 'reject') { await run(); return; }
    void confirm({
      title: 'Reject conversion?',
      message: row.status === 'approved'
        ? 'Reject this approved conversion? Its payout and billing will be reversed in the ledger.'
        : 'Reject this pending conversion?',
      confirmLabel: 'Reject', destructive: true, onConfirm: run,
    });
  };
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      {row.status === 'pending' && (
        <button type="button" className="text-tiny font-medium text-success-text hover:underline disabled:opacity-50" disabled={act.busy} onClick={() => go('approve')}>Approve</button>
      )}
      <button type="button" className="text-tiny font-medium text-danger-text hover:underline disabled:opacity-50" disabled={act.busy} onClick={() => go('reject')}>Reject</button>
      {act.error && <span className="max-w-[200px] truncate text-tiny text-danger-text" title={act.error}>{act.error}</span>}
    </div>
  );
}

interface ConvRow {
  conversion_id: string; created_at: string; click_id: string; offer_id: string;
  publisher_id: string | null; advertiser_id: string | null;
  event_name: string | null; goal_id: string | null; goal_name: string | null;
  status: string; reason: string | null; payout: string | null; revenue: string | null;
  currency: string | null; transaction_id: string | null; source: string; fraud_score: number;
  click_created_at: string | null; country: string | null; region: string | null; city: string | null;
  isp: string | null; device: string | null; os: string | null; browser: string | null;
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  delta_seconds: number | null;
}

const ALL_COLUMNS = [
  'Status', 'Reason', 'Offer', 'Partner', 'Advertiser', 'Event Name', 'Goal', 'Source',
  'Revenue', 'Payout', 'Currency', 'Transaction ID', 'Click Date', 'Delta',
  'Country', 'Region', 'City', 'ISP', 'Device', 'OS', 'Browser', 'Fraud',
  'Sub1', 'Sub2', 'Sub3', 'Sub4', 'Sub5',
] as const;

function formatDelta(seconds: number | null): string {
  if (seconds == null) return DASH;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
function money(v: string | null): string {
  if (v == null) return DASH;
  return `$${Number(v).toFixed(2)}`;
}

const STATUS_OPTIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
];

interface SmartLink { id: string; name: string }

/**
 * Filter-drawer category ⇄ URL/API param. Every param here is an accepted `/api/reports/conversions`
 * key (Smart Link / Country / Device are matched on the originating click server-side).
 */
const URL_FILTER_PARAMS: [category: string, param: string][] = [
  ['offer', 'offerId'], ['advertiser', 'advertiserId'], ['partner', 'publisherId'], ['status', 'status'],
  ['smartLink', 'smartLinkId'], ['country', 'country'], ['device', 'device'],
];

/** Applied report state from the URL (Copy Link / legacy deep links). */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const filters: FilterValues = {};
  for (const [cat, param] of URL_FILTER_PARAMS) {
    const ids = readUrlIds(sp, param).slice(0, 1); // single-select per category
    if (cat === 'status' && !STATUS_OPTIONS.some((o) => o.value === ids[0])) continue;
    if (ids.length) filters[cat] = ids;
  }
  return { from: readUrlDate(sp, 'from', daysAgo(7)), to: readUrlDate(sp, 'to', todayStr()), filters };
}

export default function ConversionReport() {
  const [init] = useState(readInitialState);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [appliedFrom, setAppliedFrom] = useState(init.from);
  const [appliedTo, setAppliedTo] = useState(init.to);
  const [filters, setFilters] = useState<FilterValues>(init.filters);
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(init.filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hasRun, setHasRun] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [copied, setCopied] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: smartLinks } = useQuery<SmartLink[]>('/api/smart-links');
  const allCountryOptions = useMemo(() => countryOptions(), []);

  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);
  const advMap = useMemo(() => new Map((advertisers ?? []).map((a) => [a.id, a.name])), [advertisers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
    // Click-side filters — applied server-side via the conversion's originating click.
    { key: 'smartLink', label: 'Smart Link', options: (smartLinks ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: allCountryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
  ], [offers, advertisers, publishers, smartLinks, allCountryOptions]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const advertiserIdFilter = appliedFilters['advertiser']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const statusFilter = appliedFilters['status']?.[0];
  const smartLinkIdFilter = appliedFilters['smartLink']?.[0];
  const countryFilter = appliedFilters['country']?.[0];
  const deviceFilter = appliedFilters['device']?.[0];
  // Timestamps follow the filtered country's zone (else network/browser) — re-formatting only.
  const zone = useReportTimeZone(countryFilter);
  const regions = useRegions();
  const formatDate = (iso: string) => formatDateTime(iso, zone.tz);
  const regionLabel = (r: ConvRow) => (r.region ? (regionName(regions, r.region, r.country) ?? r.region) : DASH);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  // Only accepted /api/reports/conversions keys (the endpoint rejects anything else with 422).
  const baseParams = {
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    offerId: offerIdFilter, publisherId: publisherIdFilter, advertiserId: advertiserIdFilter, status: statusFilter,
    smartLinkId: smartLinkIdFilter, country: countryFilter, device: deviceFilter,
  };
  const tableQs = qs({ ...baseParams, limit: pageSize + 1, offset: (page - 1) * pageSize });
  const { data, loading, error, refetch } = useQuery<ConvRow[]>(hasRun ? `/api/reports/conversions?${tableQs}` : null);
  const hasNextPage = (data?.length ?? 0) > pageSize;
  const pageRows = (data ?? []).slice(0, pageSize);

  const rows = useMemo(() => pageRows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = offerMap.get(r.offer_id) ?? '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    const advName = r.advertiser_id ? (advMap.get(r.advertiser_id) ?? '') : '';
    return [offerName, pubName, advName, r.transaction_id, r.country, r.country ? countryName(r.country) : null, r.city, r.sub1, r.sub2, r.sub3, r.sub4, r.sub5]
      .some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [pageRows, q, offerMap, pubMap, advMap]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedFilters(filters);
    setHasRun(true); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setFilters({});
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedFilters({});
    setPage(1);
  };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const toExportRow = (r: ConvRow) => ({
    date: formatDate(r.created_at), status: r.status, reason: r.reason ?? DASH,
    offer: offerMap.get(r.offer_id) ?? r.offer_id, partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    advertiser: r.advertiser_id ? (advMap.get(r.advertiser_id) ?? r.advertiser_id) : DASH,
    eventName: r.event_name ?? DASH, goal: r.goal_name ?? DASH, source: r.source,
    revenue: money(r.revenue), payout: money(r.payout), currency: r.currency ?? DASH,
    transactionId: r.transaction_id ?? DASH,
    clickDate: r.click_created_at ? formatDate(r.click_created_at) : DASH, delta: formatDelta(r.delta_seconds),
    timezone: zone.tz,
    country: r.country ? countryName(r.country) : DASH, region: regionLabel(r), city: r.city ?? DASH, isp: r.isp ?? DASH,
    device: r.device ?? DASH, os: r.os ?? DASH, browser: r.browser ?? DASH, fraud: r.fraud_score,
    sub1: r.sub1 ?? DASH, sub2: r.sub2 ?? DASH, sub3: r.sub3 ?? DASH, sub4: r.sub4 ?? DASH, sub5: r.sub5 ?? DASH,
  });
  // Every conversion matching the applied filters, not just the visible page.
  const runExport = (format: 'csv' | 'xlsx') => {
    void exp.run(format, 'conversion-report', async () => {
      const res = await fetchAllPages<ConvRow>((limit, offset) => `/api/reports/conversions?${qs({ ...baseParams, limit, offset })}`, 500);
      return { ...res, rows: res.rows.map(toExportRow) };
    });
  };

  const copyLink = async () => {
    // The applied report (not the address bar, which never reflects Run Report) — read back on load.
    const link = reportLink({
      from: appliedFrom, to: appliedTo,
      ...Object.fromEntries(URL_FILTER_PARAMS.map(([cat, param]) => [param, appliedFilters[cat]?.[0]])),
    });
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Conversion Report" subtitle="Reporting › Conversion" action={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { copyLink(); }} className="text-small font-medium text-accent-text hover:underline">{copied ? 'Copied!' : 'Copy Link'}</button>
          <button type="button" title="Show API Request" onClick={() => setShowApiRequest(true)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </div>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From (UTC)</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To (UTC)</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg relative">
              <SlidersHorizontal size={15} />
              {Object.values(appliedFilters).reduce((n, arr) => n + (arr?.length ?? 0), 0) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {Object.values(appliedFilters).reduce((n, arr) => n + (arr?.length ?? 0), 0)}
                </span>
              )}
            </button>
            {filterOpen && (
              <CategoryFilterDrawer categories={FILTER_CATEGORIES} values={filters} singleSelectKeys={FILTER_CATEGORIES.map((c) => c.key)}
                onApply={setFilters} onClose={() => setFilterOpen(false)} />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <ActiveFilterChips className="mb-3"
          chips={chipsFromValues(FILTER_CATEGORIES, appliedFilters)}
          onRemove={(c) => { const n = withoutValue(appliedFilters, c.key, c.value); setFilters(n); setAppliedFilters(n); setPage(1); }}
          onClearAll={() => { setFilters({}); setAppliedFilters({}); setPage(1); }} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex flex-wrap items-center gap-2">
            <TimeZoneSelect zone={zone} />
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search this page…" title="Filters only the rows on the current page"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="relative">
              <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
                className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                <MoreVertical size={15} />
              </button>
              {tableActionsOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated"
                  onMouseLeave={() => { setTableActionsOpen(false); setExportOpen(false); }}>
                  <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                  <div className="relative" onMouseEnter={() => setExportOpen(true)}>
                    <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                      Export <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                    {exportOpen && (
                      <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                        <button disabled={exp.busy} onClick={() => { runExport('csv'); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">CSV</button>
                        <button disabled={exp.busy} onClick={() => { runExport('xlsx'); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">Excel</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {!hasRun ? <StateBlock>Set parameters and run report</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th title={zone.tz}>Date <span className="font-normal normal-case opacity-80">({zone.label})</span></th>
                    {shown.has('Status') && <th >Status</th>}
                    {shown.has('Reason') && <th >Reason</th>}
                    {shown.has('Offer') && <th >Offer</th>}
                    {shown.has('Partner') && <th >Partner</th>}
                    {shown.has('Advertiser') && <th >Advertiser</th>}
                    {shown.has('Event Name') && <th >Event Name</th>}
                    {shown.has('Goal') && <th >Goal</th>}
                    {shown.has('Source') && <th >Source</th>}
                    {shown.has('Revenue') && <th className="text-right font-semibold">Revenue</th>}
                    {shown.has('Payout') && <th className="text-right font-semibold">Payout</th>}
                    {shown.has('Currency') && <th >Currency</th>}
                    {shown.has('Transaction ID') && <th >Transaction ID</th>}
                    {shown.has('Click Date') && <th >Click Date</th>}
                    {shown.has('Delta') && <th >Delta</th>}
                    {shown.has('Country') && <th >Country</th>}
                    {shown.has('Region') && <th >Region</th>}
                    {shown.has('City') && <th >City</th>}
                    {shown.has('ISP') && <th >ISP</th>}
                    {shown.has('Device') && <th >Device</th>}
                    {shown.has('OS') && <th >OS</th>}
                    {shown.has('Browser') && <th >Browser</th>}
                    {shown.has('Fraud') && <th className="text-right font-semibold">Fraud</th>}
                    {shown.has('Sub1') && <th >Sub1</th>}
                    {shown.has('Sub2') && <th >Sub2</th>}
                    {shown.has('Sub3') && <th >Sub3</th>}
                    {shown.has('Sub4') && <th >Sub4</th>}
                    {shown.has('Sub5') && <th >Sub5</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.conversion_id} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatDate(r.created_at)}</td>
                      {shown.has('Status') && <td className="px-4 py-3"><Badge value={r.status} /></td>}
                      {shown.has('Reason') && <td className="px-4 py-3">{r.reason ?? DASH}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link></td>}
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Advertiser') && <td className="px-4 py-3">{r.advertiser_id ? <Link to={`/app/advertisers/${r.advertiser_id}`} className="text-accent-text hover:underline">{advMap.get(r.advertiser_id) ?? r.advertiser_id}</Link> : DASH}</td>}
                      {shown.has('Event Name') && <td className="px-4 py-3">{r.event_name ?? DASH}</td>}
                      {shown.has('Goal') && <td className="px-4 py-3">{r.goal_name ?? DASH}</td>}
                      {shown.has('Source') && <td className="px-4 py-3 capitalize">{r.source}</td>}
                      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(r.revenue)}</td>}
                      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(r.payout)}</td>}
                      {shown.has('Currency') && <td className="px-4 py-3">{r.currency ?? DASH}</td>}
                      {shown.has('Transaction ID') && <td className="font-mono text-tiny">{r.transaction_id ?? DASH}</td>}
                      {shown.has('Click Date') && <td >{r.click_created_at ? formatDate(r.click_created_at) : DASH}</td>}
                      {shown.has('Delta') && <td >{formatDelta(r.delta_seconds)}</td>}
                      {shown.has('Country') && <td className="px-4 py-3" title={r.country ?? undefined}>{r.country ? countryName(r.country) : DASH}</td>}
                      {shown.has('Region') && <td className="px-4 py-3" title={r.region ?? undefined}>{regionLabel(r)}</td>}
                      {shown.has('City') && <td className="px-4 py-3">{r.city ?? DASH}</td>}
                      {shown.has('ISP') && <td className="px-4 py-3">{r.isp ?? DASH}</td>}
                      {shown.has('Device') && <td className="px-4 py-3 capitalize">{r.device ?? DASH}</td>}
                      {shown.has('OS') && <td className="px-4 py-3">{r.os ?? DASH}</td>}
                      {shown.has('Browser') && <td className="px-4 py-3">{r.browser ?? DASH}</td>}
                      {shown.has('Fraud') && <td className={`px-4 py-3 text-right ${r.fraud_score >= 40 ? 'text-danger-text' : r.fraud_score > 0 ? 'text-warning-text' : ''}`}>{r.fraud_score}</td>}
                      {shown.has('Sub1') && <td className="px-4 py-3">{r.sub1 ?? DASH}</td>}
                      {shown.has('Sub2') && <td className="px-4 py-3">{r.sub2 ?? DASH}</td>}
                      {shown.has('Sub3') && <td className="px-4 py-3">{r.sub3 ?? DASH}</td>}
                      {shown.has('Sub4') && <td className="px-4 py-3">{r.sub4 ?? DASH}</td>}
                      {shown.has('Sub5') && <td className="px-4 py-3">{r.sub5 ?? DASH}</td>}
                      <td className="px-4 py-3"><ConversionActions row={r} onChanged={refetch} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {hasRun && !error && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span>Page {page}</span>
            <div className="flex items-center gap-1">
              <button type="button" title="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeft size={14} />
              </button>
              <button type="button" title="Next page" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/conversions?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, status: statusFilter,
        smartLink: smartLinkIdFilter, country: countryFilter, device: deviceFilter,
      }} />}
    </>
  );
}
