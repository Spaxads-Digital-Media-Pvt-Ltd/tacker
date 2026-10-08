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
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, Pagination, useReportExport, ExportStatus } from '../../shared-components/primitives/ReportPageKit';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { readUrlDate, readUrlIds, reportLink } from '../../lib/reportFilterState';
import type { Offer } from '../../types';

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

const isCategory = (v: string | null): v is Category => v != null && v in CATEGORY_LABELS;

/** Applied report state from the URL (Copy Link / "Open … Report" deep links with `offerId`). */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const cat = sp.get('category');
  return {
    from: readUrlDate(sp, 'from', daysAgo(7)),
    to: readUrlDate(sp, 'to', todayStr()),
    category: isCategory(cat) ? cat : 'conversion' as Category,
    offerId: readUrlIds(sp, 'offerId')[0] ?? '', // the endpoint takes one offer
  };
}

export default function PacingReport() {
  const [init] = useState(readInitialState);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [appliedFrom, setAppliedFrom] = useState(init.from);
  const [appliedTo, setAppliedTo] = useState(init.to);
  const [category, setCategory] = useState<Category>(init.category);
  const [appliedCategory, setAppliedCategory] = useState<Category>(init.category);
  // Restricts the detail rows to this offer (click/conversion) or the offer groups containing it (payout/revenue).
  const [offerId, setOfferId] = useState(init.offerId);
  const [appliedOfferId, setAppliedOfferId] = useState(init.offerId);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [copied, setCopied] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const offerName = (id: string) => offers?.find((o) => o.id === id)?.name ?? id;

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const tableQs = qs({ from: toIso(appliedFrom), to: toIso(appliedTo, true), category: appliedCategory, offerId: appliedOfferId || undefined });
  const { data, loading, error } = useQuery<PacingResult>(`/api/reports/pacing?${tableQs}`);
  // A failed request keeps the previous `data` in useQuery — never show it (summary or rows) as current.
  const result = error ? null : data;
  const allRows = useMemo(() => result?.rows ?? [], [result]);

  const rows = useMemo(() => allRows.slice((page - 1) * pageSize, page * pageSize), [allRows, page]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedCategory(category); setAppliedOfferId(offerId); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setCategory('conversion'); setOfferId('');
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedCategory('conversion'); setAppliedOfferId('');
    setPage(1);
  };
  const clearOffer = () => { setOfferId(''); setAppliedOfferId(''); setPage(1); };

  // The endpoint returns every detail row (no paging) — export all of them, not the visible page.
  const runExport = (format: 'csv' | 'xlsx') => {
    const entityKey = appliedCategory === 'click' || appliedCategory === 'conversion' ? 'offer' : 'offerGroup';
    void exp.run(format, `pacing-report-${appliedCategory}`, async () => ({
      rows: allRows.map((r) => ({
        date: formatDate(r.date), [entityKey]: r.entity, dailyCapUsed: pctCell(r.usedPct),
        dailyCap: CAP_UNIT[appliedCategory](r.cap), actual: CAP_UNIT[appliedCategory](r.actual),
      })),
    }));
  };

  const copyLink = async () => {
    // The applied report (the address bar never reflects Run Report) — read back on load.
    const link = reportLink({ from: appliedFrom, to: appliedTo, category: appliedCategory, offerId: appliedOfferId });
    await navigator.clipboard?.writeText(link);
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
            <label className="label">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pacing-offer">Offer</label>
            <select id="pacing-offer" className="input" value={offerId} onChange={(e) => setOfferId(e.target.value)}
              title="Click/Conversion: that offer's caps · Payout/Revenue: the offer groups containing it">
              <option value="">All offers</option>
              {/* Keep a deep-linked offer selectable even before/without the offers list. */}
              {offerId && !offers?.some((o) => o.id === offerId) && <option value={offerId}>{offerId}</option>}
              {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="mb-3 text-small font-medium text-fg">Summary</h3>
        {loading ? <div className="pt-2"><Spinner /></div>
          : error ? <p className="text-small text-danger-text">{error}</p>
          : !result ? null : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="premium-table">
              <thead>
                <tr>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Daily Cap Used</th>
                  <th className="px-4 py-3 text-right font-semibold">Global Cap Used</th>
                </tr>
              </thead>
              <tbody>
                {result.summary.map((s) => (
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
        <ActiveFilterChips className="mb-3"
          chips={appliedOfferId ? [{ key: 'offer', value: appliedOfferId, label: 'Offer', valueLabel: offerName(appliedOfferId) }] : []}
          onRemove={clearOffer} onClearAll={clearOffer} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" disabled={exp.busy || loading || !!error} onClick={() => runExport('csv')}>Export CSV</button>
            <button type="button" className="btn-ghost" disabled={exp.busy || loading || !!error} onClick={() => runExport('xlsx')}>Export Excel</button>
          </div>
        </div>
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th >Date</th>
                    <th >{appliedCategory === 'click' || appliedCategory === 'conversion' ? 'Offer' : 'Offer Group'}</th>
                    <th className="text-right font-semibold">% Daily {CATEGORY_LABELS[appliedCategory]} Cap Used</th>
                    <th className="text-right font-semibold">Daily {CATEGORY_LABELS[appliedCategory]} Cap</th>
                    <th className="text-right font-semibold">{appliedCategory === 'click' ? 'Clicks' : appliedCategory === 'conversion' ? 'Conversions' : CATEGORY_LABELS[appliedCategory]}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.date}-${r.entityId}`} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatDate(r.date)}</td>
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
        {!loading && allRows.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Pagination total={allRows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        )}
      </div>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/pacing?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, category: appliedCategory, offer: appliedOfferId || undefined,
      }} />}
    </>
  );
}
