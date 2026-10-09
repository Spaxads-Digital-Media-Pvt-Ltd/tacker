/**
 * Reporting › Event — verified against the live reference (URL `/reporting/events`, 3 real rows on
 * their demo account, no Summary/graph section — a flat table grouped by Offer + Event/Goal, the
 * finest granularity already, so no expand-by-X). Backed by the existing `GET /api/reports/goals`
 * endpoint (api-backend/src/surfaces/dashboard/reports/detail-reports.ts), extended with each
 * offer's real click count (clicks aren't tied to a specific goal, so they're queried per-offer and
 * merged in) to back a real CVR — mirrors the reference's "Total (from Clicks) / Clicks" pairing.
 *
 * Columns are a reduced, fully-backed subset of the reference's 15 (Offer, Clicks, Events, Total
 * (from Clicks), CVR, Revenue, Payout, Profit, Margin). The reference's Impressions/CTR/Total (from
 * VT)/EVR/Gross Sales (from Clicks & VT) all depend on view-through/impression tracking or a "sale
 * amount" concept this app doesn't have — shown as "—" rather than faked.
 *
 * Server-side pagination: `/goals` returns `{ rows, total, truncated }` for one limit/offset page of
 * (goal × offer) groups, so the "N Total" footer is the real group count of the full result set.
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced,
 * since the native date input reports each typed segment), filters / chips immediately. The applied
 * report is mirrored to the address bar, so the URL itself is the shareable link.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, Pagination, RowKebabMenu, fetchAllPages, useReportExport, ExportStatus, ReportingFiltersFlyout, EMPTY_REPORTING_FILTERS } from '../../shared-components/primitives/ReportPageKit';
import type { Offer, Publisher } from '../../types';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { readUrlDate, readUrlIds } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';

interface GoalRow {
  goal: string; offer_id: string; conversions: number; payout: string; revenue: string; margin: string;
  clicks: number; cvr: number; marginPct: number;
}
interface GoalsResult { rows: GoalRow[]; total: number; truncated: boolean }

/** Filter-drawer category ⇄ URL/API param (accepted `/api/reports/goals` keys). */
const URL_FILTER_PARAMS: [category: string, param: string][] = [['offer', 'offerId'], ['partner', 'publisherId']];

/** Applied report state from the URL (reload / shared link / "Open … Report" deep links). */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const filters: FilterValues = {};
  for (const [cat, param] of URL_FILTER_PARAMS) {
    const ids = readUrlIds(sp, param).slice(0, 1); // single-select per category
    if (ids.length) filters[cat] = ids;
  }
  return { from: readUrlDate(sp, 'from', daysAgo(7)), to: readUrlDate(sp, 'to', todayStr()), filters };
}

const ALL_COLUMNS = [
  'Impressions', 'Clicks', 'CTR', 'Total (from VT)', 'Events', 'Total (from Clicks)', 'CVR', 'EVR',
  'Revenue', 'Payout', 'Profit', 'Margin', 'Gross Sales (from Clicks)', 'Gross Sales (from VT)',
] as const;

function money(v: string | number): string {
  return `$${Number(v).toFixed(2)}`;
}
function pct(v: number): string {
  return `${v.toFixed(2)} %`;
}

function RowActionMenu({ offerId }: { offerId: string }) {
  const nav = useNavigate();
  return (
    <RowKebabMenu items={[
      { label: 'View Offer', onClick: () => nav(`/app/offers/${offerId}`) },
      { label: 'Open Flex Report', onClick: () => nav(`/app/analytics?tab=flex&offerId=${offerId}`) },
    ]} />
  );
}

export default function EventReport() {
  const [init] = useState(readInitialState);
  const [, setSearchParams] = useSearchParams();
  // Dates apply on their own once they form a valid range (see useAutoDateRange); filters apply
  // immediately and return to page 1.
  const range = useAutoDateRange(init.from, init.to);
  const { from, to, appliedFrom, appliedTo, page, setPage, toFirstPage } = range;

  const [filters, setFilters] = useState<Record<string, string[]>>(init.filters);
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

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);
  const offerIdFilter = filters['offer']?.[0];
  const publisherIdFilter = filters['partner']?.[0];

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const baseParams = { from: toIso(appliedFrom), to: toIso(appliedTo, true), offerId: offerIdFilter, publisherId: publisherIdFilter };
  const tableQs = qs({ ...baseParams, limit: pageSize, offset: (page - 1) * pageSize });
  // The applied report lives in the URL (replace, not push) so reload / back keep it and the address
  // bar is the shareable link.
  const urlState = useMemo(() => {
    const next = new URLSearchParams();
    next.set('from', appliedFrom); next.set('to', appliedTo);
    for (const [cat, param] of URL_FILTER_PARAMS) { const v = filters[cat]?.[0]; if (v) next.set(param, v); }
    return next.toString();
  }, [appliedFrom, appliedTo, filters]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);
  const { data, loading, error } = useQuery<GoalsResult>(`/api/reports/goals?${tableQs}`);
  // A failed request keeps the previous `data` in useQuery — never present it as the current result.
  const result = error ? null : data;
  const total = result?.total ?? 0;
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  const rows = useMemo(() => (result?.rows ?? []).filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = offerMap.get(r.offer_id) ?? '';
    return [offerName, r.goal].some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [result, q, offerMap]);

  // Reset dates and filters in one render → one request. The debounced range catches up to the same
  // values later and is then a no-op.
  const clearAll = () => { range.reset({ from: daysAgo(7), to: todayStr() }); setFilters({}); };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const toExportRow = (r: GoalRow) => ({
    offer: offerMap.get(r.offer_id) ?? r.offer_id, impressions: DASH, clicks: r.clicks, ctr: DASH,
    totalFromVt: DASH, events: r.goal, totalFromClicks: r.conversions, cvr: pct(r.cvr), evr: DASH,
    revenue: money(r.revenue), payout: money(r.payout), profit: money(r.margin), margin: pct(r.marginPct),
    grossSalesClicks: DASH, grossSalesVt: DASH,
  });
  // Every (goal × offer) group matching the applied filters, not just the visible page.
  const runExport = (format: 'csv' | 'xlsx') => {
    void exp.run(format, 'event-report', async () => {
      const res = await fetchAllPages<GoalRow>((limit, offset) => `/api/reports/goals?${qs({ ...baseParams, limit, offset })}`, 500);
      return { ...res, rows: res.rows.map(toExportRow) };
    });
  };

  return (
    <>
      <PageHeader title="Event Report" subtitle="Reporting › Event" />

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
          <DateRangeField idPrefix="event-report" from={from} to={to} max={todayStr()} invalid={range.problem !== null}
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
                    Export <span className="text-fg-muted">›</span>
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
                    <th >Offer</th>
                    {shown.has('Impressions') && <th className="text-right font-semibold">Impressions</th>}
                    {shown.has('Clicks') && <th className="text-right font-semibold">Clicks</th>}
                    {shown.has('CTR') && <th className="text-right font-semibold">CTR</th>}
                    {shown.has('Total (from VT)') && <th className="text-right font-semibold">Total (from VT)</th>}
                    {shown.has('Events') && <th >Events</th>}
                    {shown.has('Total (from Clicks)') && <th className="text-right font-semibold">Total (from Clicks)</th>}
                    {shown.has('CVR') && <th className="text-right font-semibold">CVR</th>}
                    {shown.has('EVR') && <th className="text-right font-semibold">EVR</th>}
                    {shown.has('Revenue') && <th className="text-right font-semibold">Revenue</th>}
                    {shown.has('Payout') && <th className="text-right font-semibold">Payout</th>}
                    {shown.has('Profit') && <th className="text-right font-semibold">Profit</th>}
                    {shown.has('Margin') && <th className="text-right font-semibold">Margin</th>}
                    {shown.has('Gross Sales (from Clicks)') && <th className="text-right font-semibold">Gross Sales (from Clicks)</th>}
                    {shown.has('Gross Sales (from VT)') && <th className="text-right font-semibold">Gross Sales (from VT)</th>}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.offer_id}-${r.goal}`} className="hover:bg-accent-subtle/40">
                      <td className="font-medium"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link></td>
                      {shown.has('Impressions') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
                      {shown.has('Clicks') && <td className="px-4 py-3 text-right">{r.clicks.toLocaleString()}</td>}
                      {shown.has('CTR') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
                      {shown.has('Total (from VT)') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
                      {shown.has('Events') && <td className="px-4 py-3">{r.goal}</td>}
                      {shown.has('Total (from Clicks)') && <td className="px-4 py-3 text-right">{r.conversions.toLocaleString()}</td>}
                      {shown.has('CVR') && <td className="px-4 py-3 text-right">{pct(r.cvr)}</td>}
                      {shown.has('EVR') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
                      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(r.revenue)}</td>}
                      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(r.payout)}</td>}
                      {shown.has('Profit') && <td className="px-4 py-3 text-right">{money(r.margin)}</td>}
                      {shown.has('Margin') && <td className="px-4 py-3 text-right">{pct(r.marginPct)}</td>}
                      {shown.has('Gross Sales (from Clicks)') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
                      {shown.has('Gross Sales (from VT)') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
                      <td className="text-right"><RowActionMenu offerId={r.offer_id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {total > 0 && (
          <div className="mt-3 flex justify-end">
            <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        )}
        </ReportBody>
      </ReportCard>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/goals?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, partner: publisherIdFilter,
      }} />}
    </>
  );
}
