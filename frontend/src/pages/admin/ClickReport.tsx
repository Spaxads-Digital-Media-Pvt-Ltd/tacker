/**
 * Reporting › Click — verified against the live reference as far as its flakiness allowed: same
 * raw event-log shape as Impression Report (one row per click, not a grouped aggregate — no
 * Summary/graph section), URL `/reporting/clicks`, and the same ~45-column header set (mostly
 * device/fraud metadata this app's schema doesn't have). Unlike Impression Report, clicks are real
 * and voluminous here, so this is a genuinely populated, working report backed by the existing
 * `GET /api/reports/clicks` row-level endpoint (api-backend/src/surfaces/dashboard/reports/
 * detail-reports.ts) — already real, already filtered/parameterized, no rebuild needed there.
 *
 * Two small honest backend additions: a `converted` flag (EXISTS against conversions.click_id —
 * mirrors the reference's real "Converted" column) and `smart_link_id` in the row payload.
 *
 * Columns shown are a reduced, fully-backed subset of the reference's ~45 (Date, Converted, Offer,
 * Partner, Country, Region, City, ISP, Device, OS, Browser, Unique, Fraud, IP Address, Sub1-5) —
 * the reference's IDFA/Google Ad ID/Android ID/ZIP/Language/Platform/Brand/Proxy/Test Mode/Project
 * ID/etc. have no real source anywhere in this schema, so they're omitted rather than faked.
 *
 * Pagination here is "has more" (overfetch by one row), not a numeric total — the shared API client
 * (lib/api.ts) discards the response envelope's pagination metadata app-wide, and plumbing a real
 * total through it is a bigger, riskier change than this page warrants.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MoreVertical, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { FilterButton, CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH, DEVICES } from '../../components/ReportPageKit';
import type { Advertiser, Offer, Publisher } from '../../types';

interface SmartLink { id: string; name: string }
interface ClickRow {
  click_id: string; created_at: string; offer_id: string; publisher_id: string | null;
  smart_link_id: string | null; ip: string | null; country: string | null; region: string | null;
  city: string | null; isp: string | null; device: string | null; os: string | null; browser: string | null;
  is_unique: boolean; fraud_score: number; fraud_flags: string[];
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  converted: boolean;
}

const ALL_COLUMNS = [
  'Converted', 'Offer', 'Partner', 'Country', 'Region', 'City', 'ISP', 'Device', 'OS', 'Browser',
  'Unique', 'Fraud', 'IP Address', 'Sub1', 'Sub2', 'Sub3', 'Sub4', 'Sub5',
] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

export default function ClickReport() {
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
  const { data: smartLinks } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<{ rows: { dimensions: Record<string, string | null> }[] }>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country'])
    .filter((c): c is string => Boolean(c))
    .sort()
    .map((c) => ({ value: c, label: c })), [countryAgg]);

  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'smartLink', label: 'Smart Link', options: (smartLinks ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICES.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })) },
  ], [offers, advertisers, publishers, smartLinks, countryOptions]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const smartLinkIdFilter = appliedFilters['smartLink']?.[0];
  const countryFilter = appliedFilters['country']?.[0];
  const deviceFilter = appliedFilters['device']?.[0];

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const tableQs = qs({
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    offerId: offerIdFilter, publisherId: publisherIdFilter, smartLinkId: smartLinkIdFilter,
    country: countryFilter, device: deviceFilter,
    limit: pageSize + 1, offset: (page - 1) * pageSize,
  });
  const { data, loading, error } = useQuery<ClickRow[]>(hasRun ? `/api/reports/clicks?${tableQs}` : null);
  const hasNextPage = (data?.length ?? 0) > pageSize;
  const pageRows = (data ?? []).slice(0, pageSize);

  const rows = useMemo(() => pageRows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = offerMap.get(r.offer_id) ?? '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    return [offerName, pubName, r.country, r.city, r.ip, r.sub1, r.sub2, r.sub3, r.sub4, r.sub5]
      .some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [pageRows, q, offerMap, pubMap]);

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
    date: formatDate(r.created_at), converted: r.converted ? 'Yes' : 'No',
    offer: offerMap.get(r.offer_id) ?? r.offer_id, partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    country: r.country ?? DASH, region: r.region ?? DASH, city: r.city ?? DASH, isp: r.isp ?? DASH,
    device: r.device ?? DASH, os: r.os ?? DASH, browser: r.browser ?? DASH, unique: r.is_unique ? 'Y' : 'N',
    fraud: r.fraud_score, ip: r.ip ?? DASH,
    sub1: r.sub1 ?? DASH, sub2: r.sub2 ?? DASH, sub3: r.sub3 ?? DASH, sub4: r.sub4 ?? DASH, sub5: r.sub5 ?? DASH,
  }));

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Click Report" subtitle="Reporting › Click" action={
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
                storageKey="click-report"
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
                        <button onClick={() => { downloadCsv('click-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('click-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
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
              <table className="w-full min-w-[1800px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Date</th>
                    {shown.has('Converted') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Converted</th>}
                    {shown.has('Offer') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>}
                    {shown.has('Partner') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Partner</th>}
                    {shown.has('Country') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Country</th>}
                    {shown.has('Region') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Region</th>}
                    {shown.has('City') && <th className="whitespace-nowrap px-4 py-3 font-semibold">City</th>}
                    {shown.has('ISP') && <th className="whitespace-nowrap px-4 py-3 font-semibold">ISP</th>}
                    {shown.has('Device') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Device</th>}
                    {shown.has('OS') && <th className="whitespace-nowrap px-4 py-3 font-semibold">OS</th>}
                    {shown.has('Browser') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Browser</th>}
                    {shown.has('Unique') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Unique</th>}
                    {shown.has('Fraud') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Fraud</th>}
                    {shown.has('IP Address') && <th className="whitespace-nowrap px-4 py-3 font-semibold">IP Address</th>}
                    {shown.has('Sub1') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub1</th>}
                    {shown.has('Sub2') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub2</th>}
                    {shown.has('Sub3') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub3</th>}
                    {shown.has('Sub4') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub4</th>}
                    {shown.has('Sub5') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Sub5</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.click_id} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{formatDate(r.created_at)}</td>
                      {shown.has('Converted') && <td className="px-4 py-3">{r.converted ? <Check size={15} className="text-success-text" /> : <span className="text-fg-muted">{DASH}</span>}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link></td>}
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Country') && <td className="px-4 py-3">{r.country ?? DASH}</td>}
                      {shown.has('Region') && <td className="px-4 py-3">{r.region ?? DASH}</td>}
                      {shown.has('City') && <td className="px-4 py-3">{r.city ?? DASH}</td>}
                      {shown.has('ISP') && <td className="px-4 py-3">{r.isp ?? DASH}</td>}
                      {shown.has('Device') && <td className="px-4 py-3 capitalize">{r.device ?? DASH}</td>}
                      {shown.has('OS') && <td className="px-4 py-3">{r.os ?? DASH}</td>}
                      {shown.has('Browser') && <td className="px-4 py-3">{r.browser ?? DASH}</td>}
                      {shown.has('Unique') && <td className="px-4 py-3">{r.is_unique ? 'Y' : 'N'}</td>}
                      {shown.has('Fraud') && <td className={`px-4 py-3 text-right ${r.fraud_score >= 40 ? 'text-danger-text' : r.fraud_score > 0 ? 'text-warning-text' : ''}`}>{r.fraud_score}</td>}
                      {shown.has('IP Address') && <td className="whitespace-nowrap px-4 py-3 font-mono text-tiny">{r.ip ?? DASH}</td>}
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
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/clicks?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, partner: publisherIdFilter, smartLink: smartLinkIdFilter, country: countryFilter, device: deviceFilter,
      }} />}
    </>
  );
}
