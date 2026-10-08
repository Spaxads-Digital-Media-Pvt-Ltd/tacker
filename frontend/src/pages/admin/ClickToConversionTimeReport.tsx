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
 */
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { CategoryFilterDrawer, type FilterCategory } from '../../shared-components/primitives/CategoryFilterDrawer';
import { SlidersHorizontal } from 'lucide-react';
import { ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, Pagination, RowKebabMenu, fetchAllPages, useReportExport, ExportStatus } from '../../shared-components/primitives/ReportPageKit';
import type { Offer, Publisher } from '../../types';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { readUrlDate, readUrlIds, reportLink } from '../../lib/reportFilterState';

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

/** Applied report state from the URL (Copy Link / deep links): dates + the Offer filter. */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const offerIds = readUrlIds(sp, 'offerId').slice(0, 1); // single-select
  const filters: Record<string, string[]> = offerIds.length ? { offer: offerIds } : {};
  return { from: readUrlDate(sp, 'from', daysAgo(7)), to: readUrlDate(sp, 'to', todayStr()), filters };
}

export default function ClickToConversionTimeReport() {
  const [init] = useState(readInitialState);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [appliedFrom, setAppliedFrom] = useState(init.from);
  const [appliedTo, setAppliedTo] = useState(init.to);
  const [filters, setFilters] = useState<Record<string, string[]>>(init.filters);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string[]>>(init.filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [copied, setCopied] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
  ], [offers]);
  const offerIdFilter = appliedFilters['offer']?.[0];

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

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedFilters(filters); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setFilters({});
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedFilters({});
    setPage(1);
  };
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const copyLink = async () => {
    // The applied report (the address bar never reflects Run Report) — read back on load.
    const link = reportLink({ from: appliedFrom, to: appliedTo, offerId: offerIdFilter });
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Click to Conversion Time Report" subtitle="Reporting › Click To Conversion Time" action={
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
            <label className="label">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
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

      <div className="card">
        <ActiveFilterChips className="mb-3" chips={chipsFromValues(FILTER_CATEGORIES, appliedFilters)}
          onRemove={(c) => { const n = withoutValue(appliedFilters, c.key, c.value); setFilters(n); setAppliedFilters(n); setPage(1); }}
          onClearAll={() => { setFilters({}); setAppliedFilters({}); setPage(1); }} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" disabled={exp.busy} onClick={() => runExport('csv')}>Export CSV</button>
            <button type="button" className="btn-ghost" disabled={exp.busy} onClick={() => runExport('xlsx')}>Export Excel</button>
          </div>
        </div>
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {!loading && truncated && (
          <p role="status" className="mb-3 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-tiny text-fg-secondary">
            Showing the first {allRows.length.toLocaleString()} of {totalGroups.toLocaleString()} offers (the Summary Graph covers these only) — narrow the filters to see the rest.
          </p>
        )}
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
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
        {!loading && allRows.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Pagination total={allRows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        )}
      </div>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/click-to-conversion-time?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter,
      }} />}
    </>
  );
}
