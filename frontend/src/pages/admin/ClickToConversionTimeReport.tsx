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
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { FilterButton, CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ApiRequestModal } from '../../components/TableActionsKit';
import { daysAgo, todayStr, toIso, Pagination, RowKebabMenu } from '../../components/ReportPageKit';
import type { Offer, Publisher } from '../../types';

interface BucketRow { key: string; b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number; total: number }

const BUCKET_LABELS = ['0 To 15 Seconds', '15 To 30 Seconds', '30 To 60 Seconds', '60 To 120 Seconds', '120 To 180 Seconds', '180 To 300 Seconds', 'More than 300 Seconds'];
const bucketVals = (r: BucketRow) => [r.b0, r.b1, r.b2, r.b3, r.b4, r.b5, r.b6];

function RowActionMenu({ offerId }: { offerId: string }) {
  const nav = useNavigate();
  return <RowKebabMenu items={[{ label: 'View Offer', onClick: () => nav(`/app/offers/${offerId}`) }]} />;
}

function ExpandedPartnerRows({ offerId, publishers }: { offerId: string; publishers: Publisher[] }) {
  const { data, loading } = useQuery<BucketRow[]>(`/api/reports/click-to-conversion-time?groupBy=publisher&offerId=${offerId}`);
  const rows = data ?? [];
  if (loading) return <tr><td colSpan={9} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (!rows.length) return <tr><td colSpan={9} className="px-4 py-3 text-small text-fg-muted">No partner activity for this offer in the selected period.</td></tr>;
  return (
    <>
      {rows.map((r) => (
        <tr key={r.key} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{publishers.find((p) => p.id === r.key)?.name ?? r.key.slice(0, 8)}</td>
          {bucketVals(r).map((v, i) => <td key={i} className="px-4 py-2 text-right">{v.toLocaleString()}</td>)}
        </tr>
      ))}
    </>
  );
}

export default function ClickToConversionTimeReport() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [filters, setFilters] = useState<FilterValues>({});
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [copied, setCopied] = useState(false);

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
  const tableQs = qs({ from: toIso(appliedFrom), to: toIso(appliedTo, true), groupBy: 'offer', offerId: offerIdFilter });
  const { data, loading, error } = useQuery<BucketRow[]>(`/api/reports/click-to-conversion-time?${tableQs}`);

  const allRows = data ?? [];
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
    await navigator.clipboard?.writeText(window.location.href);
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
                storageKey="click-to-conversion-time-report"
              />
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
          !data ? <div className="pt-4"><Spinner /></div> : allRows.length === 0 ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
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
        <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[1400px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>
                    {BUCKET_LABELS.map((l) => <th key={l} className="whitespace-nowrap px-4 py-3 text-right font-semibold">{l}</th>)}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <Fragment key={r.key}>
                      <tr className="hover:bg-accent-subtle/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <button type="button" onClick={() => toggleExpand(r.key)} className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
                            <ChevronRight size={13} className={`transition-transform ${expanded.has(r.key) ? 'rotate-90' : ''}`} />
                            {offerMap.get(r.key) ?? r.key}
                          </button>
                        </td>
                        {bucketVals(r).map((v, i) => <td key={i} className="px-4 py-3 text-right">{v.toLocaleString()}</td>)}
                        <td className="text-right"><RowActionMenu offerId={r.key} /></td>
                      </tr>
                      {expanded.has(r.key) && <ExpandedPartnerRows offerId={r.key} publishers={publishers ?? []} />}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {allRows.length > 0 && (
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
