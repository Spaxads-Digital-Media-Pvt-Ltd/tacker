/**
 * Reporting › Click To Conversion Time — verified against the live reference (URL `/reporting/mtti`,
 * 3 real offer rows on their demo account): a table grouped by Offer, expandable by Partner, with 7
 * fixed time-since-click buckets (0-15s, 15-30s, 30-60s, 60-120s, 120-180s, 180-300s, >300s) each
 * showing a real conversion count. Backed by a new `GET /api/reports/click-to-conversion-time`
 * endpoint (api-backend/src/surfaces/dashboard/reports/detail-reports.ts) computing the real delta
 * between conversion.created_at and the originating click's created_at (via click_id), bucketed in
 * SQL — the same delta already surfaced per-row on Conversion Report, aggregated here into a
 * distribution. Conversions with no resolvable click (offline/manual) are honestly excluded rather
 * than bucketed as instant, since there's no click to measure a delta from.
 *
 * Summary Graph is a real bar chart of network-wide bucket totals, summed client-side from the same
 * rows already fetched for the table — no separate API call. The reference also has a unit switcher
 * (Seconds/Minutes/Hours/Days) that changes the bucket boundaries; only the Seconds buckets actually
 * seen on the reference are implemented here rather than guessing the other three unit's ranges.
 *
 * Row kebab has one real item (View Offer), matching the reference.
 *
 * No "Run Report": dates apply on their own once they form a valid range (see useAutoDateRange), the
 * Offer filter and its chips immediately.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { type FilterCategory } from '../../shared-components/primitives/CategorizedFilters';
import { ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, Pagination, RowKebabMenu, fetchAllPages, useReportExport, ExportStatus, ReportingFiltersFlyout, EMPTY_REPORTING_FILTERS } from '../../shared-components/primitives/ReportPageKit';
import type { Offer, Publisher } from '../../types';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { readUrlDate, readUrlIds } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';

interface BucketRow { key: string; b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number; total: number }
/** `total` = number of groups matching; `truncated` = more groups exist beyond limit+offset. */
interface BucketResult { rows: BucketRow[]; total: number; truncated: boolean }
/** One request loads up to this many groups (the endpoint's max `limit`); the table pages them client-side. */
const GROUP_LIMIT = 500;

const BUCKET_LABELS = ['0 To 15 Seconds', '15 To 30 Seconds', '30 To 60 Seconds', '60 To 120 Seconds', '120 To 180 Seconds', '180 To 300 Seconds', 'More than 300 Seconds'];
const bucketVals = (r: BucketRow) => [r.b0, r.b1, r.b2, r.b3, r.b4, r.b5, r.b6];

function RowActionMenu({ offerId }: { offerId: string }) {
  const nav = useNavigate();
  return <RowKebabMenu items={[{ label: 'View Offer', onClick: () => nav(`/app/offers/${offerId}`) }]} />;
}

function ExpandedPartnerRows({ offerId, publishers, from, to }: { offerId: string; publishers: Publisher[]; from: string; to: string }) {
  // Same date range as the parent row (it used to be all-time).
  const qs = new URLSearchParams({
    groupBy: 'publisher', offerId, from: toIso(from), to: toIso(to, true), limit: String(GROUP_LIMIT),
  }).toString();
  const { data, loading, error } = useQuery<BucketResult>(`/api/reports/click-to-conversion-time?${qs}`);
  const rows = data?.rows ?? [];
  if (loading) return <tr><td colSpan={9} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (error) return <tr><td colSpan={9} className="px-4 py-3 text-small text-danger-text">{error}</td></tr>;
  if (!rows.length) return <tr><td colSpan={9} className="px-4 py-3 text-small text-fg-muted">No partner activity for this offer in the selected period.</td></tr>;
  return (
    <>
      {rows.map((r) => (
        <tr key={r.key} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{publishers.find((p) => p.id === r.key)?.name ?? r.key.slice(0, 8)}</td>
          {bucketVals(r).map((v, i) => <td key={i} className="px-4 py-2 text-right">{v.toLocaleString()}</td>)}
        </tr>
      ))}
      {data?.truncated && (
        <tr><td colSpan={9} className="py-2 pl-10 pr-4 text-tiny text-fg-muted">
          Showing the first {rows.length.toLocaleString()} of {data.total.toLocaleString()} partners.
        </td></tr>
      )}
    </>
  );
}

/** Filter-drawer category ⇄ URL/API param. */
const URL_FILTER_PARAMS: [category: string, param: string][] = [['offer', 'offerId']];

/** Applied report state from the URL (reload / shared link / deep links): dates + the Offer filter. */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const offerIds = readUrlIds(sp, 'offerId').slice(0, 1); // single-select
  const filters: Record<string, string[]> = offerIds.length ? { offer: offerIds } : {};
  return { from: readUrlDate(sp, 'from', daysAgo(7)), to: readUrlDate(sp, 'to', todayStr()), filters };
}

export default function ClickToConversionTimeReport() {
  const [init] = useState(readInitialState);
  // Dates apply on their own once they form a valid range; the filter applies immediately and
  // returns to page 1.
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
  const [graphOpen, setGraphOpen] = useState(false);
  const pageSize = 25;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showApiRequest, setShowApiRequest] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
  ], [offers]);
  const offerIdFilter = filters['offer']?.[0];
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const baseParams = { from: toIso(appliedFrom), to: toIso(appliedTo, true), groupBy: 'offer', offerId: offerIdFilter };
  const tableQs = qs({ ...baseParams, limit: GROUP_LIMIT });
  // Every offer group matching the applied filters (pages past the 500 the table loads).
  const runExport = (format: 'csv' | 'xlsx') => {
    void exp.run(format, 'click-to-conversion-time-report', async () => {
      const res = await fetchAllPages<BucketRow>((limit, offset) => `/api/reports/click-to-conversion-time?${qs({ ...baseParams, limit, offset })}`, GROUP_LIMIT);
      return {
        ...res,
        rows: res.rows.map((r) => ({
          offer: offerMap.get(r.key) ?? r.key,
          ...Object.fromEntries(BUCKET_LABELS.map((l, i) => [l, bucketVals(r)[i]])),
          total: r.total,
        })),
      };
    });
  };
  const { data, loading, error } = useQuery<BucketResult>(`/api/reports/click-to-conversion-time?${tableQs}`);

  // A failed request keeps the previous `data` in useQuery — never show it (table or graph) as current.
  const result = error ? null : data;
  const allRows = useMemo(() => result?.rows ?? [], [result]);
  const truncated = result?.truncated ?? false;
  const totalGroups = result?.total ?? allRows.length;
  const rows = useMemo(() => allRows.slice((page - 1) * pageSize, page * pageSize), [allRows, page]);
  const graphTotals = useMemo(() => allRows.reduce<number[]>((acc, r) => bucketVals(r).map((v, i) => (acc[i] ?? 0) + v), [0, 0, 0, 0, 0, 0, 0]), [allRows]);
  const graphMax = Math.max(1, ...graphTotals);

  // Reset dates and the filter in one render → one request.
  const clearAll = () => { range.reset({ from: daysAgo(7), to: todayStr() }); setFilters({}); };
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <PageHeader title="Click to Conversion Time Report" subtitle="Reporting › Click To Conversion Time" />

      <ReportCard className="mb-4">
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} />
          <FiltersButton count={activeFilterCount} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout sections={['filters']} singleSelect dimCategories={FILTER_CATEGORIES}
                value={{ ...EMPTY_REPORTING_FILTERS, filters }}
                onApply={(v) => { setFilters(v.filters); toFirstPage(); }} onClose={() => setFilterOpen(false)} />
            )}
          </FiltersButton>
          <button type="button" title="Show API Request" aria-label="Show API Request" onClick={() => setShowApiRequest(true)}
            className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="click-to-conversion-time-report" from={from} to={to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>
      </ReportCard>

      <div className="card mb-4">
        <button type="button" onClick={() => setGraphOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronRight size={14} className={`transition-transform ${graphOpen ? 'rotate-90' : ''}`} /> Summary Graph
        </button>
        {graphOpen && (
          loading ? <div className="pt-4"><Spinner /></div>
          : error ? <p className="pt-3 text-small text-danger-text">{error}</p>
          : allRows.length === 0 ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <div className="mt-4 flex items-end gap-3" style={{ height: 160 }}>
              {graphTotals.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-tiny text-fg-secondary">{v.toLocaleString()}</span>
                  <div className="w-full rounded-t bg-accent" style={{ height: `${Math.max(2, (v / graphMax) * 120)}px` }} />
                  <span className="text-center text-[10px] leading-tight text-fg-muted">{BUCKET_LABELS[i]}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <ReportCard>
        <ResultsBar position="top" title="Detailed Report" loading={loading} actions={<>
          <button type="button" className={`btn-ghost ${CONTROL}`} disabled={exp.busy} onClick={() => runExport('csv')}>Export CSV</button>
          <button type="button" className={`btn-ghost ${CONTROL}`} disabled={exp.busy} onClick={() => runExport('xlsx')}>Export Excel</button>
        </>}>
          <ActiveFilterChips chips={chipsFromValues(FILTER_CATEGORIES, filters)}
            onRemove={(c) => { setFilters(withoutValue(filters, c.key, c.value)); toFirstPage(); }}
            onClearAll={() => { setFilters({}); toFirstPage(); }} />
        </ResultsBar>

        <ReportBody>
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {!loading && truncated && (
          <p role="status" className="mb-3 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-tiny text-fg-secondary">
            Showing the first {allRows.length.toLocaleString()} of {totalGroups.toLocaleString()} offers (the Summary Graph covers these only) — narrow the filters to see the rest.
          </p>
        )}
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
                    {BUCKET_LABELS.map((l) => <th key={l} className="text-right font-semibold">{l}</th>)}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.key}>
                      <tr>
                        <td >
                          <button type="button" onClick={() => toggleExpand(r.key)} className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
                            <ChevronRight size={13} className={`transition-transform ${expanded.has(r.key) ? 'rotate-90' : ''}`} />
                            {offerMap.get(r.key) ?? r.key}
                          </button>
                        </td>
                        {bucketVals(r).map((v, i) => <td key={i} className="px-4 py-3 text-right">{v.toLocaleString()}</td>)}
                        <td className="text-right"><RowActionMenu offerId={r.key} /></td>
                      </tr>
                      {expanded.has(r.key) && <ExpandedPartnerRows offerId={r.key} publishers={publishers ?? []} from={appliedFrom} to={appliedTo} />}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {!error && allRows.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Pagination total={allRows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        )}
        </ReportBody>
      </ReportCard>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/click-to-conversion-time?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter,
      }} />}
    </>
  );
}
