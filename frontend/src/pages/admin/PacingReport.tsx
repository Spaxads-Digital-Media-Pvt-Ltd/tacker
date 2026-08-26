/**
 * Reporting › Pacing — verified against the live reference (URL `/reporting/pacing`): a Summary
 * matrix of Category × cap-period "% used", then a Detailed Report of real per-day, per-entity cap
 * usage. Backed by a new `GET /api/reports/pacing` endpoint (api-backend/src/surfaces/dashboard/
 * reports/detail-reports.ts) built on the three real cap surfaces this app actually has — the
 * reference's nav description literally says "Cap fulfillment (Custom, Offer-Level, Offer Group)",
 * which maps cleanly:
 *   - Click:      offers.daily_click_cap        (offer-level, daily only)
 *   - Conversion: offers.daily_conversion_cap / total_conversion_cap (offer-level, daily + global)
 *   - Payout:     offer_groups.daily_payout_cap  (offer-group, daily only)
 *   - Revenue:    offer_groups.daily_revenue_cap (offer-group, daily only)
 *
 * The reference's Summary has four periods (Daily/Weekly/Monthly/Global); this schema only tracks
 * daily caps plus one all-time ("global") conversion cap — no weekly/monthly cap concept exists
 * anywhere in this app, so those two columns are omitted rather than faked, and Global is shown as
 * "—" for Click/Payout/Revenue (no all-time cap tracked for those).
 *
 * No Performance Graph section — the reference's graph would need a cap-usage-over-time metric this
 * report doesn't have a ready-made time series for beyond the Detailed Report rows themselves, so
 * it's left out rather than bolted on as a re-skinned chart of something else.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { ApiRequestModal } from '../../components/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, Pagination } from '../../components/ReportPageKit';

type Category = 'click' | 'conversion' | 'payout' | 'revenue';
interface SummaryRow { category: Category; dailyUsedPct: number | null; globalUsedPct: number | null }
interface DetailRow { date: string; entity: string; entityId: string; cap: number; actual: number; usedPct: number }
interface PacingResult { summary: SummaryRow[]; category: Category; rows: DetailRow[] }

const CATEGORY_LABELS: Record<Category, string> = {
  click: 'Click', conversion: 'Conversion', payout: 'Payout', revenue: 'Revenue',
};
const CAP_UNIT: Record<Category, (n: number) => string> = {
  click: (n) => n.toLocaleString(), conversion: (n) => n.toLocaleString(),
  payout: (n) => `$${n.toFixed(2)}`, revenue: (n) => `$${n.toFixed(2)}`,
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
function pctCell(v: number | null): string {
  return v == null ? DASH : `${v.toFixed(2)}%`;
}

export default function PacingReport() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [category, setCategory] = useState<Category>('conversion');
  const [appliedCategory, setAppliedCategory] = useState<Category>('conversion');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [copied, setCopied] = useState(false);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const tableQs = qs({ from: toIso(appliedFrom), to: toIso(appliedTo, true), category: appliedCategory });
  const { data, loading, error } = useQuery<PacingResult>(`/api/reports/pacing?${tableQs}`);

  const rows = useMemo(() => (data?.rows ?? []).slice((page - 1) * pageSize, page * pageSize), [data, page]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedCategory(category); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setCategory('conversion');
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedCategory('conversion');
    setPage(1);
  };

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const entityHref = (r: DetailRow) => (appliedCategory === 'click' || appliedCategory === 'conversion' ? `/app/offers/${r.entityId}` : '/app/offers-groups');

  return (
    <>
      <PageHeader title="Pacing Report" subtitle="Reporting › Pacing" action={
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
          <div>
            <label className="label mb-1 block">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="mb-3 text-small font-medium text-fg">Summary</h3>
        {!data ? <div className="pt-2"><Spinner /></div> : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left text-body">
              <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Daily Cap Used</th>
                  <th className="px-4 py-3 text-right font-semibold">Global Cap Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.summary.map((s) => (
                  <tr key={s.category}>
                    <td className="px-4 py-3 font-medium text-fg">{CATEGORY_LABELS[s.category]}</td>
                    <td className="px-4 py-3 text-right">{pctCell(s.dailyUsedPct)}</td>
                    <td className="px-4 py-3 text-right">{pctCell(s.globalUsedPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Date</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">{appliedCategory === 'click' || appliedCategory === 'conversion' ? 'Offer' : 'Offer Group'}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">% Daily {CATEGORY_LABELS[appliedCategory]} Cap Used</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Daily {CATEGORY_LABELS[appliedCategory]} Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">{appliedCategory === 'click' ? 'Clicks' : appliedCategory === 'conversion' ? 'Conversions' : CATEGORY_LABELS[appliedCategory]}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={`${r.date}-${r.entityId}`} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{formatDate(r.date)}</td>
                      <td className="px-4 py-3"><Link to={entityHref(r)} className="text-accent-text hover:underline">{r.entity}</Link></td>
                      <td className="px-4 py-3 text-right">{pctCell(r.usedPct)}</td>
                      <td className="px-4 py-3 text-right">{CAP_UNIT[appliedCategory](r.cap)}</td>
                      <td className="px-4 py-3 text-right">{CAP_UNIT[appliedCategory](r.actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {data && data.rows.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Pagination total={data.rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        )}
      </div>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/pacing?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, category: appliedCategory,
      }} />}
    </>
  );
}
