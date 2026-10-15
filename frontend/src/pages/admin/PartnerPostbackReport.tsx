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
 * truncated); the reference's "Level" is shown as "Attempt" → `attempt` (the retry attempt number,
 * real — it is not a postback level). Rows the worker logs when the partner has no postback configured
 * (url `(none)`, error `no_postback_configured`) show a neutral "Not configured", not "Failed". The reference's "Type" has no
 * clean backing — postback_logs doesn't record an HTTP method — so it's omitted rather than guessed.
 * A real "Error" column is also added beyond the reference's confirmed set (rejection/failure reason
 * — genuinely useful and already returned by the endpoint).
 *
 * Pagination is "has more" (overfetch by one row), matching Click/Conversion Report.
 *
 * No "Run Report": dates apply on their own once they form a valid range (see useAutoDateRange),
 * filters and chips immediately.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MoreVertical, ChevronRight, ChevronLeft, Check, X, Minus } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { DASH, fetchAllPages, useReportExport, ExportStatus, ReportingFiltersFlyout, EMPTY_REPORTING_FILTERS } from '../../shared-components/primitives/ReportPageKit';
import type { Offer, Publisher } from '../../types';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { readUrlDate, readUrlIds } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';
import { formatMdyDateTime } from '../../lib/datetime';
import { useReportZone, type ZoneDays } from '../../lib/useReportZone';

interface PbRow {
  id: string; created_at: string; conversion_id: string; publisher_id: string | null;
  url: string | null; attempt: number; status_code: number | null; success: boolean; error: string | null;
  offer_id: string | null; event_name: string | null;
}

const ALL_COLUMNS = ['Partner', 'Offer', 'Event Name', 'Payload', 'Status', 'Attempt', 'Error'] as const;

/** Logged by the outbound-postback worker (url `(none)`) when the partner has no postback set up —
 *  nothing was sent, so it isn't a delivery failure. */
const NOT_CONFIGURED_ERROR = 'no_postback_configured';
type PbStatus = 'Success' | 'Failed' | 'Not configured';
function pbStatus(r: PbRow): PbStatus {
  if (r.success) return 'Success';
  return r.error === NOT_CONFIGURED_ERROR ? 'Not configured' : 'Failed';
}


const STATUS_OPTIONS = [
  { value: 'true', label: 'Success' },
  { value: 'false', label: 'Failed' },
];

/** Filter-drawer category ⇄ URL/API param (accepted `/api/reports/postback-logs` keys). */
const URL_FILTER_PARAMS: [category: string, param: string][] = [['offer', 'offerId'], ['partner', 'publisherId'], ['status', 'success']];

/** Applied report state from the URL ("Open … Report" deep links). */
function readInitialState(zone: ZoneDays) {
  const sp = new URLSearchParams(window.location.search);
  const filters: FilterValues = {};
  for (const [cat, param] of URL_FILTER_PARAMS) {
    const ids = readUrlIds(sp, param).slice(0, 1); // single-select per category
    if (cat === 'status' && !STATUS_OPTIONS.some((o) => o.value === ids[0])) continue;
    if (ids.length) filters[cat] = ids;
  }
  return { from: readUrlDate(sp, 'from', zone.daysAgo(7)), to: readUrlDate(sp, 'to', zone.today()), filters };
}

export default function PartnerPostbackReport() {
  // D7: the report's time zone — the network's unless one is picked beside the dates: its days,
  // "today" and the presets; requests send plain dates + tz.
  const zone = useReportZone();
  const [init] = useState(() => readInitialState(zone));
  // Dates apply on their own once they form a valid range; filters apply immediately and return to
  // page 1.
  const range = useAutoDateRange(init.from, init.to);
  const { from, to, appliedFrom, appliedTo, page, setPage, toFirstPage } = range;
  const [filters, setFilters] = useState<Record<string, string[]>>(init.filters);
  // The applied report lives in the URL (replace, not push), so reload and a shared address-bar
  // link keep it — this replaces the old "Copy Link".
  const [, setSearchParams] = useSearchParams();
  const urlState = useMemo(() => {
    const next = new URLSearchParams();
    next.set('from', range.appliedFrom); next.set('to', range.appliedTo);
    for (const [cat, param] of URL_FILTER_PARAMS) { const v = filters[cat]?.[0]; if (v) next.set(param, v); }
    return next.toString();
  }, [range.appliedFrom, range.appliedTo, filters]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [q, setQ] = useState('');
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
  ], [offers, publishers]);

  const offerIdFilter = filters['offer']?.[0];
  const publisherIdFilter = filters['partner']?.[0];
  const successFilter = filters['status']?.[0];
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const baseParams = {
    ...zone.range(appliedFrom, appliedTo),
    offerId: offerIdFilter, publisherId: publisherIdFilter, success: successFilter,
  };
  const tableQs = qs({ ...baseParams, limit: pageSize + 1, offset: (page - 1) * pageSize });
  const { data, loading, error } = useQuery<PbRow[]>(`/api/reports/postback-logs?${tableQs}`);
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

  // Reset dates and filters in one render → one request.
  const clearAll = () => { range.reset({ from: zone.daysAgo(7), to: zone.today() }); setFilters({}); };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const toExportRow = (r: PbRow) => ({
    date: formatMdyDateTime(r.created_at, zone.tz), logId: r.id,
    partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    offer: r.offer_id ? (offerMap.get(r.offer_id) ?? r.offer_id) : DASH,
    eventName: r.event_name ?? DASH, payload: r.url && r.url !== '(none)' ? r.url : DASH,
    status: pbStatus(r), statusCode: r.status_code ?? DASH, attempt: r.attempt,
    error: r.error ?? DASH,
  });
  // Every log row matching the applied filters, not just the visible page.
  const runExport = (format: 'csv' | 'xlsx') => {
    void exp.run(format, 'partner-postback-report', async () => {
      const res = await fetchAllPages<PbRow>((limit, offset) => `/api/reports/postback-logs?${qs({ ...baseParams, limit, offset })}`, 500);
      return { ...res, rows: res.rows.map(toExportRow) };
    });
  };

  return (
    <>
      <PageHeader title="Partner Postback Report" subtitle="Reporting › Partner Postback" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} />
          <FiltersButton count={activeFilterCount} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout sections={['filters']} singleSelect dimCategories={FILTER_CATEGORIES}
                value={{ ...EMPTY_REPORTING_FILTERS, filters }}
                onApply={(v) => { setFilters(v.filters); toFirstPage(); }} onClose={() => setFilterOpen(false)} />
            )}
          </FiltersButton>
        </>}>
          <DateRangeField idPrefix="partner-postback-report" from={from} to={to} max={zone.today()} zone={zone} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <ResultsBar title="Detailed Report" loading={loading} actions={<>
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
                <button onClick={() => { setTableActionsOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
        </>}>
          <ActiveFilterChips
            chips={chipsFromValues(FILTER_CATEGORIES, filters)}
            onRemove={(c) => { setFilters(withoutValue(filters, c.key, c.value)); toFirstPage(); }}
            onClearAll={() => { setFilters({}); toFirstPage(); }} />
        </ResultsBar>

        <ReportBody>
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {error ? <StateBlock>{error}</StateBlock>
          // While a new request runs, the previous rows stay (dimmed) instead of the table collapsing
          // to a spinner and back.
          : !rows.length ? (loading ? <StateBlock><Spinner /></StateBlock> : <StateBlock>No Record Found</StateBlock>)
          : (
            <div className={`overflow-x-auto rounded-card border border-border transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th title={zone.tz}>Date <span className="font-normal normal-case opacity-80">({zone.label})</span></th>
                    <th >Log ID</th>
                    {shown.has('Partner') && <th >Partner</th>}
                    {shown.has('Offer') && <th >Offer</th>}
                    {shown.has('Event Name') && <th >Event Name</th>}
                    {shown.has('Payload') && <th >Payload</th>}
                    {shown.has('Status') && <th >Status</th>}
                    {shown.has('Attempt') && <th className="text-right font-semibold">Attempt</th>}
                    {shown.has('Error') && <th >Error</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => { const status = pbStatus(r); return (
                    <tr key={r.id} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatMdyDateTime(r.created_at, zone.tz)}</td>
                      <td className="font-mono text-tiny text-fg-secondary">{r.id.slice(0, 8)}…</td>
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3">{r.offer_id ? <Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link> : DASH}</td>}
                      {shown.has('Event Name') && <td className="px-4 py-3">{r.event_name ?? DASH}</td>}
                      {shown.has('Payload') && <td className="max-w-xs truncate px-4 py-3 font-mono text-tiny" title={r.url ?? ''}>{r.url && r.url !== '(none)' ? r.url : DASH}</td>}
                      {shown.has('Status') && (
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-small ${status === 'Success' ? 'text-success-text' : status === 'Failed' ? 'text-danger-text' : 'text-fg-secondary'}`}>
                            {status === 'Success' ? <Check size={13} /> : status === 'Failed' ? <X size={13} /> : <Minus size={13} />}
                            {status}{r.status_code != null ? ` (${r.status_code})` : ''}
                          </span>
                        </td>
                      )}
                      {shown.has('Attempt') && <td className="px-4 py-3 text-right">{r.attempt}</td>}
                      {shown.has('Error') && <td className={`max-w-xs truncate px-4 py-3 ${status === 'Not configured' ? 'text-fg-secondary' : 'text-danger-text'}`} title={r.error ?? ''}>{r.error ?? DASH}</td>}
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          )}
        {/* Paging follows the loaded page, not "Search this page" (which can hide every row) — and stays
           reachable on an emptied later page so Previous still works. */}
        {!error && (pageRows.length > 0 || page > 1) && (
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span>Page {page}</span>
            <div className="flex items-center gap-1">
              <button type="button" title="Previous page" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeft size={14} />
              </button>
              <button type="button" title="Next page" disabled={!hasNextPage || loading} onClick={() => setPage(page + 1)}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
        </ReportBody>
      </ReportCard>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} reorderable={false} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/postback-logs?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, partner: publisherIdFilter, success: successFilter,
      }} />}
    </>
  );
}
