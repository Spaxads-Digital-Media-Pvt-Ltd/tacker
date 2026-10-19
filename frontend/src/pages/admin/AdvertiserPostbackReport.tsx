/**
 * Reporting › Advertiser Postback — every conversion request advertisers sent (S2S postback, pixel,
 * iframe, advertiser API) and what happened to it, read from the inbound postback log
 * (`GET /api/reports/inbound-postbacks`): recorded as a conversion (Approved / Pending / Rejected, with
 * its Conversion ID) or not — Duplicate, Click not found, Security failed, Error — with the reason in
 * words. Nothing an advertiser sends is missing here, so a mismatch with their numbers (or another
 * tracker's) can be reconciled line by line; "Recorded: Not recorded" lists exactly what was ignored.
 *
 * Payload = the params as received, with the security code and other secrets masked server-side.
 * CV Method = how it arrived. Rows a request for an unknown tracking domain or a rate-limited one
 * never reach the log (there is no network to file them under / they were never processed).
 *
 * No "Run Report": dates apply on their own once they form a valid range (see useAutoDateRange),
 * filters and chips immediately.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MoreVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, Badge } from '../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { DASH, money, fetchAllPages, useReportExport, ExportStatus, ReportingFiltersFlyout, EMPTY_REPORTING_FILTERS } from '../../shared-components/primitives/ReportPageKit';
import type { Advertiser, Offer, Publisher } from '../../types';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { readUrlDate, readUrlIds } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';
import { formatMdyDateTime } from '../../lib/datetime';
import { useReportZone, type ZoneDays } from '../../lib/useReportZone';
import { INBOUND_OUTCOME_LABELS, reasonLabel } from '../../lib/conversionReport';

interface InboundRow {
  id: string; created_at: string; source: string; method: string | null;
  click_id: string | null; transaction_id: string | null; event_name: string | null;
  offer_id: string | null; publisher_id: string | null; advertiser_id: string | null;
  outcome: string; reason: string | null; conversion_id: string | null;
  payout: string | null; revenue: string | null; currency: string | null; sale_amount: string | null;
  http_status: number | null; ip: string | null; user_agent: string | null;
  params: Record<string, unknown> | null;
}

const ALL_COLUMNS = ['Partner', 'Offer', 'Advertiser', 'Payload', 'Click ID', 'Conversion ID', 'Transaction ID', 'Event', 'Status', 'Reason', 'CV Method', 'Revenue', 'Payout', 'IP', 'HTTP Status'] as const;
/** Shown on demand (Columns Customization). */
const HIDDEN_BY_DEFAULT = ['IP', 'HTTP Status'];

/** A conversion's money in its own currency (USD when the row has none). */
function convMoney(v: string | null, currency: string | null): string {
  return v == null ? DASH : money(Number(v), currency || 'USD');
}
function payloadPreview(p: Record<string, unknown> | null): string {
  if (!p || Object.keys(p).length === 0) return DASH;
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join('&');
}

const METHOD_OPTIONS = [
  { value: 'postback', label: 'Server Postback' },
  { value: 'pixel', label: 'Pixel' },
  { value: 'iframe', label: 'iFrame' },
  { value: 'api', label: 'API' },
];
const STATUS_OPTIONS = Object.entries(INBOUND_OUTCOME_LABELS).map(([value, label]) => ({ value, label }));
const RECORDED_OPTIONS = [
  { value: 'true', label: 'Recorded as a conversion' },
  { value: 'false', label: 'Not recorded (ignored)' },
];
const outcomeLabel = (o: string) => INBOUND_OUTCOME_LABELS[o] ?? o;

/** Filter-drawer category ⇄ URL/API param (accepted `/api/reports/inbound-postbacks` keys). */
const URL_FILTER_PARAMS: [category: string, param: string][] = [
  ['offer', 'offerId'], ['advertiser', 'advertiserId'], ['partner', 'publisherId'], ['method', 'source'],
  ['status', 'outcome'], ['recorded', 'recorded'],
];
/** Categories whose values are a fixed list — anything else in the URL is dropped. */
const FIXED_OPTIONS: Record<string, { value: string }[]> = { method: METHOD_OPTIONS, status: STATUS_OPTIONS, recorded: RECORDED_OPTIONS };

/** Applied report state from the URL (deep links). */
function readInitialState(zone: ZoneDays) {
  const sp = new URLSearchParams(window.location.search);
  const filters: FilterValues = {};
  for (const [cat, param] of URL_FILTER_PARAMS) {
    const ids = readUrlIds(sp, param).slice(0, 1); // single-select per category
    const fixed = FIXED_OPTIONS[cat];
    if (fixed && !fixed.some((o) => o.value === ids[0])) continue;
    if (ids.length) filters[cat] = ids;
  }
  return { from: readUrlDate(sp, 'from', zone.daysAgo(7)), to: readUrlDate(sp, 'to', zone.today()), filters };
}

export default function AdvertiserPostbackReport() {
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
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(HIDDEN_BY_DEFAULT));
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const exp = useReportExport();

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
    { key: 'method', label: 'CV Method', options: METHOD_OPTIONS },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
    { key: 'recorded', label: 'Recorded', options: RECORDED_OPTIONS },
  ], [offers, advertisers, publishers]);

  const offerIdFilter = filters['offer']?.[0];
  const advertiserIdFilter = filters['advertiser']?.[0];
  const publisherIdFilter = filters['partner']?.[0];
  const methodFilter = filters['method']?.[0];
  const statusFilter = filters['status']?.[0];
  const recordedFilter = filters['recorded']?.[0];
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  // Only accepted /api/reports/inbound-postbacks keys (the endpoint rejects anything else with 422).
  const baseParams = {
    ...zone.range(appliedFrom, appliedTo),
    offerId: offerIdFilter, publisherId: publisherIdFilter, advertiserId: advertiserIdFilter,
    source: methodFilter, outcome: statusFilter, recorded: recordedFilter,
  };
  const tableQs = qs({ ...baseParams, limit: pageSize + 1, offset: (page - 1) * pageSize });
  const { data, loading, error } = useQuery<InboundRow[]>(`/api/reports/inbound-postbacks?${tableQs}`);
  const hasNextPage = (data?.length ?? 0) > pageSize;
  const pageRows = useMemo(() => (data ?? []).slice(0, pageSize), [data]);

  const rows = useMemo(() => pageRows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = r.offer_id ? (offerMap.get(r.offer_id) ?? '') : '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    const advName = r.advertiser_id ? (advMap.get(r.advertiser_id) ?? '') : '';
    return [offerName, pubName, advName, r.transaction_id, r.conversion_id, r.click_id, r.event_name, reasonLabel(r.reason)]
      .some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [pageRows, q, offerMap, pubMap, advMap]);

  // Reset dates and filters in one render → one request.
  const clearAll = () => { range.reset({ from: zone.daysAgo(7), to: zone.today() }); setFilters({}); };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const toExportRow = (r: InboundRow) => ({
    date: formatMdyDateTime(r.created_at, zone.tz),
    partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    offer: r.offer_id ? (offerMap.get(r.offer_id) ?? r.offer_id) : DASH,
    advertiser: r.advertiser_id ? (advMap.get(r.advertiser_id) ?? r.advertiser_id) : DASH,
    payload: payloadPreview(r.params), clickId: r.click_id ?? DASH, conversionId: r.conversion_id ?? DASH,
    transactionId: r.transaction_id ?? DASH, event: r.event_name ?? DASH,
    status: outcomeLabel(r.outcome), reason: reasonLabel(r.reason) ?? DASH,
    cvMethod: METHOD_OPTIONS.find((m) => m.value === r.source)?.label ?? r.source,
    // Exact decimal text (spreadsheet-numeric); `currency` is the one the table formats them in.
    revenue: r.revenue ?? DASH, payout: r.payout ?? DASH, currency: r.currency || 'USD',
    ip: r.ip ?? DASH, httpStatus: r.http_status ?? DASH,
  });
  // Every row matching the applied filters, not just the visible page.
  const runExport = (format: 'csv' | 'xlsx') => {
    void exp.run(format, 'advertiser-postback-report', async () => {
      const res = await fetchAllPages<InboundRow>((limit, offset) => `/api/reports/inbound-postbacks?${qs({ ...baseParams, limit, offset })}`, 500);
      return { ...res, rows: res.rows.map(toExportRow) };
    });
  };

  return (
    <>
      <PageHeader title="Advertiser Postback Report" subtitle="Reporting › Advertiser Postback" />

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
          <DateRangeField idPrefix="advertiser-postback-report" from={from} to={to} max={zone.today()} zone={zone} invalid={range.problem !== null}
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
                    {shown.has('Partner') && <th >Partner</th>}
                    {shown.has('Offer') && <th >Offer</th>}
                    {shown.has('Advertiser') && <th >Advertiser</th>}
                    {shown.has('Payload') && <th >Payload</th>}
                    {shown.has('Click ID') && <th >Click ID</th>}
                    {shown.has('Conversion ID') && <th >Conversion ID</th>}
                    {shown.has('Transaction ID') && <th >Transaction ID</th>}
                    {shown.has('Event') && <th >Event</th>}
                    {shown.has('Status') && <th >Status</th>}
                    {shown.has('Reason') && <th >Reason</th>}
                    {shown.has('CV Method') && <th >CV Method</th>}
                    {shown.has('Revenue') && <th className="text-right font-semibold">Revenue</th>}
                    {shown.has('Payout') && <th className="text-right font-semibold">Payout</th>}
                    {shown.has('IP') && <th >IP</th>}
                    {shown.has('HTTP Status') && <th >HTTP Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatMdyDateTime(r.created_at, zone.tz)}</td>
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3">{r.offer_id ? <Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link> : DASH}</td>}
                      {shown.has('Advertiser') && <td className="px-4 py-3">{r.advertiser_id ? <Link to={`/app/advertisers/${r.advertiser_id}`} className="text-accent-text hover:underline">{advMap.get(r.advertiser_id) ?? r.advertiser_id}</Link> : DASH}</td>}
                      {shown.has('Payload') && <td className="max-w-xs truncate px-4 py-3 font-mono text-tiny" title={payloadPreview(r.params)}>{payloadPreview(r.params)}</td>}
                      {shown.has('Click ID') && <td className="font-mono text-tiny" title={r.click_id ?? undefined}>{r.click_id ? `${r.click_id.slice(0, 12)}…` : DASH}</td>}
                      {shown.has('Conversion ID') && <td className="font-mono text-tiny" title={r.conversion_id ?? undefined}>{r.conversion_id ? `${r.conversion_id.slice(0, 12)}…` : DASH}</td>}
                      {shown.has('Transaction ID') && <td className="font-mono text-tiny">{r.transaction_id ?? DASH}</td>}
                      {shown.has('Event') && <td className="font-mono text-tiny">{r.event_name ?? DASH}</td>}
                      {shown.has('Status') && <td className="px-4 py-3"><Badge value={r.outcome} label={outcomeLabel(r.outcome)} /></td>}
                      {shown.has('Reason') && <td className="px-4 py-3" title={r.reason ?? undefined}>{reasonLabel(r.reason) ?? DASH}</td>}
                      {shown.has('CV Method') && <td className="px-4 py-3">{METHOD_OPTIONS.find((m) => m.value === r.source)?.label ?? r.source}</td>}
                      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{convMoney(r.revenue, r.currency)}</td>}
                      {shown.has('Payout') && <td className="px-4 py-3 text-right">{convMoney(r.payout, r.currency)}</td>}
                      {shown.has('IP') && <td className="font-mono text-tiny" title={r.user_agent ?? undefined}>{r.ip ?? DASH}</td>}
                      {shown.has('HTTP Status') && <td className="px-4 py-3">{r.http_status ?? DASH}</td>}
                    </tr>
                  ))}
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
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/inbound-postbacks?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, method: methodFilter,
        status: statusFilter, recorded: recordedFilter,
      }} />}
    </>
  );
}
