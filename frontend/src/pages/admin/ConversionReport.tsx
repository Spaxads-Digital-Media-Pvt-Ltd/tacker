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
import { Search, MoreVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, Badge } from '../../components/ui';
import { FilterButton, CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH } from '../../components/ReportPageKit';
import type { Advertiser, Offer, Publisher } from '../../types';

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

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return `${date} ${time}`;
}
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

export default function ConversionReport() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [filters, setFilters] = useState<FilterValues>({});
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>({});
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

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');

  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);
  const advMap = useMemo(() => new Map((advertisers ?? []).map((a) => [a.id, a.name])), [advertisers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
  ], [offers, advertisers, publishers]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const advertiserIdFilter = appliedFilters['advertiser']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const statusFilter = appliedFilters['status']?.[0];

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const tableQs = qs({
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    offerId: offerIdFilter, publisherId: publisherIdFilter, advertiserId: advertiserIdFilter, status: statusFilter,
    limit: pageSize + 1, offset: (page - 1) * pageSize,
  });
  const { data, loading, error } = useQuery<ConvRow[]>(hasRun ? `/api/reports/conversions?${tableQs}` : null);
  const hasNextPage = (data?.length ?? 0) > pageSize;
  const pageRows = (data ?? []).slice(0, pageSize);

  const rows = useMemo(() => pageRows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = offerMap.get(r.offer_id) ?? '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    const advName = r.advertiser_id ? (advMap.get(r.advertiser_id) ?? '') : '';
    return [offerName, pubName, advName, r.transaction_id, r.country, r.city, r.sub1, r.sub2, r.sub3, r.sub4, r.sub5]
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
  const exportRows = () => rows.map((r) => ({
    date: formatDate(r.created_at), status: r.status, reason: r.reason ?? DASH,
    offer: offerMap.get(r.offer_id) ?? r.offer_id, partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    advertiser: r.advertiser_id ? (advMap.get(r.advertiser_id) ?? r.advertiser_id) : DASH,
    eventName: r.event_name ?? DASH, goal: r.goal_name ?? DASH, source: r.source,
    revenue: money(r.revenue), payout: money(r.payout), currency: r.currency ?? DASH,
    transactionId: r.transaction_id ?? DASH,
    clickDate: r.click_created_at ? formatDate(r.click_created_at) : DASH, delta: formatDelta(r.delta_seconds),
    country: r.country ?? DASH, region: r.region ?? DASH, city: r.city ?? DASH, isp: r.isp ?? DASH,
    device: r.device ?? DASH, os: r.os ?? DASH, browser: r.browser ?? DASH, fraud: r.fraud_score,
    sub1: r.sub1 ?? DASH, sub2: r.sub2 ?? DASH, sub3: r.sub3 ?? DASH, sub4: r.sub4 ?? DASH, sub5: r.sub5 ?? DASH,
  }));

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
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
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="relative">
            <FilterButton count={appliedFilterCount(appliedFilters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout
                categories={FILTER_CATEGORIES}
                values={filters}
                onApply={setFilters}
                onClose={() => setFilterOpen(false)}
                storageKey="conversion-report"
              />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
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
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated"
                  onMouseLeave={() => { setTableActionsOpen(false); setExportOpen(false); }}>
                  <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                  <div className="relative" onMouseEnter={() => setExportOpen(true)}>
                    <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                      Export <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                    {exportOpen && (
                      <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                        <button onClick={() => { downloadCsv('conversion-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('conversion-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {!hasRun ? <StateBlock>Set parameters and run report</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[2400px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Date</th>
                    {shown.has('Status') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Status</th>}
                    {shown.has('Reason') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Reason</th>}
                    {shown.has('Offer') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>}
                    {shown.has('Partner') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Partner</th>}
                    {shown.has('Advertiser') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Advertiser</th>}
                    {shown.has('Event Name') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Event Name</th>}
                    {shown.has('Goal') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Goal</th>}
                    {shown.has('Source') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Source</th>}
                    {shown.has('Revenue') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Revenue</th>}
                    {shown.has('Payout') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Payout</th>}
                    {shown.has('Currency') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Currency</th>}
                    {shown.has('Transaction ID') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Transaction ID</th>}
                    {shown.has('Click Date') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Click Date</th>}
                    {shown.has('Delta') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Delta</th>}
                    {shown.has('Country') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Country</th>}
                    {shown.has('Region') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Region</th>}
                    {shown.has('City') && <th className="whitespace-nowrap px-4 py-3 font-semibold">City</th>}
                    {shown.has('ISP') && <th className="whitespace-nowrap px-4 py-3 font-semibold">ISP</th>}
                    {shown.has('Device') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Device</th>}
                    {shown.has('OS') && <th className="whitespace-nowrap px-4 py-3 font-semibold">OS</th>}
                    {shown.has('Browser') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Browser</th>}
                    {shown.has('Fraud') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Fraud</th>}
                    {shown.has('Sub1') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub1</th>}
                    {shown.has('Sub2') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub2</th>}
                    {shown.has('Sub3') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub3</th>}
                    {shown.has('Sub4') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub4</th>}
                    {shown.has('Sub5') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub5</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.conversion_id} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{formatDate(r.created_at)}</td>
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
                      {shown.has('Transaction ID') && <td className="whitespace-nowrap px-4 py-3 font-mono text-tiny">{r.transaction_id ?? DASH}</td>}
                      {shown.has('Click Date') && <td className="whitespace-nowrap px-4 py-3">{r.click_created_at ? formatDate(r.click_created_at) : DASH}</td>}
                      {shown.has('Delta') && <td className="whitespace-nowrap px-4 py-3">{formatDelta(r.delta_seconds)}</td>}
                      {shown.has('Country') && <td className="px-4 py-3">{r.country ?? DASH}</td>}
                      {shown.has('Region') && <td className="px-4 py-3">{r.region ?? DASH}</td>}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {hasRun && rows.length > 0 && (
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
      }} />}
    </>
  );
}
