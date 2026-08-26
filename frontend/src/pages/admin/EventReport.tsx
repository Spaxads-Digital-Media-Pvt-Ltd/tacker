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
 * No true server-side pagination: `/goals` returns every matching (offer, goal) row up to a 500-row
 * cap in one shot (the dataset is bounded by offers × goals, not click/conversion volume), so the
 * "N Total" footer here is a real count of the full result set, paginated client-side for display.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { FilterButton, CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH, Pagination, RowKebabMenu } from '../../components/ReportPageKit';
import type { Offer } from '../../types';

interface GoalRow {
  goal: string; offer_id: string; conversions: number; payout: string; revenue: string; margin: string;
  clicks: number; cvr: number; marginPct: number;
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

  const tableQs = qs({ from: toIso(appliedFrom), to: toIso(appliedTo, true), offerId: offerIdFilter });
  const { data, loading, error } = useQuery<GoalRow[]>(hasRun ? `/api/reports/goals?${tableQs}` : null);

  const filteredRows = useMemo(() => (data ?? []).filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = offerMap.get(r.offer_id) ?? '';
    return [offerName, r.goal].some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [data, q, offerMap]);
  const rows = useMemo(() => filteredRows.slice((page - 1) * pageSize, page * pageSize), [filteredRows, page]);

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
  const exportRows = () => filteredRows.map((r) => ({
    offer: offerMap.get(r.offer_id) ?? r.offer_id, impressions: DASH, clicks: r.clicks, ctr: DASH,
    totalFromVt: DASH, events: r.goal, totalFromClicks: r.conversions, cvr: pct(r.cvr), evr: DASH,
    revenue: money(r.revenue), payout: money(r.payout), profit: money(r.margin), margin: pct(r.marginPct),
    grossSalesClicks: DASH, grossSalesVt: DASH,
  }));

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Event Report" subtitle="Reporting › Event" action={
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
                storageKey="event-report"
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
              <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
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
                      Export <span className="text-fg-muted">›</span>
                    </button>
                    {exportOpen && (
                      <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                        <button onClick={() => { downloadCsv('event-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('event-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
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
              <table className="w-full min-w-[1600px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>
                    {shown.has('Impressions') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Impressions</th>}
                    {shown.has('Clicks') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Clicks</th>}
                    {shown.has('CTR') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CTR</th>}
                    {shown.has('Total (from VT)') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Total (from VT)</th>}
                    {shown.has('Events') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Events</th>}
                    {shown.has('Total (from Clicks)') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Total (from Clicks)</th>}
                    {shown.has('CVR') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">CVR</th>}
                    {shown.has('EVR') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">EVR</th>}
                    {shown.has('Revenue') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Revenue</th>}
                    {shown.has('Payout') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Payout</th>}
                    {shown.has('Profit') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Profit</th>}
                    {shown.has('Margin') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Margin</th>}
                    {shown.has('Gross Sales (from Clicks)') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Gross Sales (from Clicks)</th>}
                    {shown.has('Gross Sales (from VT)') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Gross Sales (from VT)</th>}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={`${r.offer_id}-${r.goal}`} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link></td>
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
        {hasRun && filteredRows.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Pagination total={filteredRows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        )}
      </div>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/goals?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter,
      }} />}
    </>
  );
}
