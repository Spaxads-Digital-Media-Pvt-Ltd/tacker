/**
 * Reporting › Partner Postback — verified against the live reference (URL
 * `/reporting/affiliates/postbacks`, columns: Pixel ID | Date | Partner | Offer | Event Name | Type |
 * Payload | Status | Level — empty on their demo account, so verified against real local data
 * instead, 102 rows in this dev DB). Same raw event-log shape as Click/Conversion Report (no
 * Summary/graph). Backed by the existing `GET /api/reports/postback-logs` endpoint
 * (api-backend/src/surfaces/dashboard/reports/detail-reports.ts), extended with a LEFT JOIN to the
 * conversion each attempt fired for (via conversion_id) so Offer and Event Name are real rather than
 * omitted.
 *
 * Column mapping: Pixel ID → the log row's own id (real); Payload → the actual fired postback URL
 * with its substituted macros, which for this app's GET-style postbacks *is* the payload (real,
 * truncated); Level → `attempt` (the retry attempt number, real). The reference's "Type" has no
 * clean backing — postback_logs doesn't record an HTTP method — so it's omitted rather than guessed.
 * A real "Error" column is also added beyond the reference's confirmed set (rejection/failure reason
 * — genuinely useful and already returned by the endpoint).
 *
 * Pagination is "has more" (overfetch by one row), matching Click/Conversion Report.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MoreVertical, ChevronRight, ChevronLeft, Check, X } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { FilterButton, CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH } from '../../components/ReportPageKit';
import type { Offer, Publisher } from '../../types';

interface PbRow {
  id: string; created_at: string; conversion_id: string; publisher_id: string | null;
  url: string | null; attempt: number; status_code: number | null; success: boolean; error: string | null;
  offer_id: string | null; event_name: string | null;
}

const ALL_COLUMNS = ['Partner', 'Offer', 'Event Name', 'Payload', 'Status', 'Level', 'Error'] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

const STATUS_OPTIONS = [
  { value: 'true', label: 'Success' },
  { value: 'false', label: 'Failed' },
];

export default function PartnerPostbackReport() {
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
  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
  ], [offers, publishers]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const successFilter = appliedFilters['status']?.[0];

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const tableQs = qs({
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    offerId: offerIdFilter, publisherId: publisherIdFilter, success: successFilter,
    limit: pageSize + 1, offset: (page - 1) * pageSize,
  });
  const { data, loading, error } = useQuery<PbRow[]>(hasRun ? `/api/reports/postback-logs?${tableQs}` : null);
  const hasNextPage = (data?.length ?? 0) > pageSize;
  const pageRows = (data ?? []).slice(0, pageSize);

  const rows = useMemo(() => pageRows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = r.offer_id ? (offerMap.get(r.offer_id) ?? '') : '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    return [offerName, pubName, r.event_name, r.error, r.url, r.conversion_id]
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
    date: formatDate(r.created_at), logId: r.id,
    partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    offer: r.offer_id ? (offerMap.get(r.offer_id) ?? r.offer_id) : DASH,
    eventName: r.event_name ?? DASH, payload: r.url && r.url !== '(none)' ? r.url : DASH,
    status: r.success ? 'Success' : 'Failed', statusCode: r.status_code ?? DASH, level: r.attempt,
    error: r.error ?? DASH,
  }));

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Partner Postback Report" subtitle="Reporting › Partner Postback" action={
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
                storageKey="partner-postback-report"
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
                        <button onClick={() => { downloadCsv('partner-postback-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('partner-postback-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
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
              <table className="w-full min-w-[1700px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Date</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Log ID</th>
                    {shown.has('Partner') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Partner</th>}
                    {shown.has('Offer') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>}
                    {shown.has('Event Name') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Event Name</th>}
                    {shown.has('Payload') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Payload</th>}
                    {shown.has('Status') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Status</th>}
                    {shown.has('Level') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Level</th>}
                    {shown.has('Error') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Error</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{formatDate(r.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-tiny text-fg-secondary">{r.id.slice(0, 8)}…</td>
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3">{r.offer_id ? <Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link> : DASH}</td>}
                      {shown.has('Event Name') && <td className="px-4 py-3">{r.event_name ?? DASH}</td>}
                      {shown.has('Payload') && <td className="max-w-xs truncate px-4 py-3 font-mono text-tiny" title={r.url ?? ''}>{r.url && r.url !== '(none)' ? r.url : DASH}</td>}
                      {shown.has('Status') && (
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-small ${r.success ? 'text-success-text' : 'text-danger-text'}`}>
                            {r.success ? <Check size={13} /> : <X size={13} />}
                            {r.success ? 'Success' : 'Failed'}{r.status_code != null ? ` (${r.status_code})` : ''}
                          </span>
                        </td>
                      )}
                      {shown.has('Level') && <td className="px-4 py-3 text-right">{r.attempt}</td>}
                      {shown.has('Error') && <td className="max-w-xs truncate px-4 py-3 text-danger-text" title={r.error ?? ''}>{r.error ?? DASH}</td>}
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
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/postback-logs?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, partner: publisherIdFilter, success: successFilter,
      }} />}
    </>
  );
}
