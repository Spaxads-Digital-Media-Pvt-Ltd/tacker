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
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced,
 * since the native date input reports each typed segment), Category / Offer / chips immediately. The
 * applied report is mirrored to the address bar, so the URL itself is the shareable link.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, Pagination, useReportExport, ExportStatus } from '../../shared-components/primitives/ReportPageKit';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { readUrlDate, readUrlIds } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';
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

/** Applied report state from the URL (reload / shared link / "Open … Report" deep links with `offerId`). */
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
  const [, setSearchParams] = useSearchParams();
  // Dates apply on their own once they form a valid range (see useAutoDateRange); Category / Offer
  // apply immediately and return to page 1.
  const range = useAutoDateRange(init.from, init.to);
  const { from, to, appliedFrom, appliedTo, page, setPage, toFirstPage } = range;

  const [category, setCategory] = useState<Category>(init.category);
  // Restricts the detail rows to this offer (click/conversion) or the offer groups containing it (payout/revenue).
  const [offerId, setOfferId] = useState(init.offerId);
  const pageSize = 25;
  const [showApiRequest, setShowApiRequest] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const offerName = (id: string) => offers?.find((o) => o.id === id)?.name ?? id;

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const tableQs = qs({ from: toIso(appliedFrom), to: toIso(appliedTo, true), category, offerId: offerId || undefined });
  // The applied report lives in the URL (replace, not push) so reload / back keep it and the address
  // bar is the shareable link.
  const urlState = useMemo(() => {
    const next = new URLSearchParams();
    next.set('from', appliedFrom); next.set('to', appliedTo); next.set('category', category);
    if (offerId) next.set('offerId', offerId);
    return next.toString();
  }, [appliedFrom, appliedTo, category, offerId]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);
  const { data, loading, error } = useQuery<PacingResult>(`/api/reports/pacing?${tableQs}`);
  // A failed request keeps the previous `data` in useQuery — never show it (summary or rows) as current.
  const result = error ? null : data;
  const allRows = useMemo(() => result?.rows ?? [], [result]);
  // Label/format the rows by the category they were fetched for — while a new category loads, the
  // previous rows stay (dimmed) and must keep their own headers and units.
  const rowCategory = result?.category ?? category;

  const rows = useMemo(() => allRows.slice((page - 1) * pageSize, page * pageSize), [allRows, page]);

  // Reset dates, category and offer in one render → one request. The debounced range catches up to
  // the same values later and is then a no-op.
  const clearAll = () => { range.reset({ from: daysAgo(7), to: todayStr() }); setCategory('conversion'); setOfferId(''); };
  const changeCategory = (c: Category) => { setCategory(c); toFirstPage(); };
  const changeOffer = (id: string) => { setOfferId(id); toFirstPage(); };
  const clearOffer = () => changeOffer('');

  // The endpoint returns every detail row (no paging) — export all of them, not the visible page.
  const runExport = (format: 'csv' | 'xlsx') => {
    const entityKey = rowCategory === 'click' || rowCategory === 'conversion' ? 'offer' : 'offerGroup';
    void exp.run(format, `pacing-report-${rowCategory}`, async () => ({
      rows: allRows.map((r) => ({
        date: formatDate(r.date), [entityKey]: r.entity, dailyCapUsed: pctCell(r.usedPct),
        dailyCap: CAP_UNIT[rowCategory](r.cap), actual: CAP_UNIT[rowCategory](r.actual),
      })),
    }));
  };

  const entityHref = (r: DetailRow) => (rowCategory === 'click' || rowCategory === 'conversion' ? `/app/offers/${r.entityId}` : '/app/offers-groups');

  return (
    <>
      <PageHeader title="Pacing Report" subtitle="Reporting › Pacing" />

      <ReportCard className="mb-4">
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, category and offer" />
          <button type="button" title="Show API Request" aria-label="Show API Request" onClick={() => setShowApiRequest(true)}
            className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="pacing-report" from={from} to={to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <ControlField label="Category" htmlFor="pacing-report-category">
            <select id="pacing-report-category" className={`input ${CONTROL}`} value={category} onChange={(e) => changeCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </ControlField>
          <ControlField label="Offer" htmlFor="pacing-offer">
            <select id="pacing-offer" className={`input ${CONTROL}`} value={offerId} onChange={(e) => changeOffer(e.target.value)}
              title="Click/Conversion: that offer's caps · Payout/Revenue: the offer groups containing it">
              <option value="">All offers</option>
              {/* Keep a deep-linked offer selectable even before/without the offers list. */}
              {offerId && !offers?.some((o) => o.id === offerId) && <option value={offerId}>{offerId}</option>}
              {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </ControlField>
        </ReportControls>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <h3 className="mb-3 text-small font-medium text-fg">Summary</h3>
          {error ? <p className="text-small text-danger-text">{error}</p>
            : !result ? (loading ? <div className="pt-2"><Spinner /></div> : null) : (
            <div className={`overflow-x-auto rounded-card border border-border transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
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
      </ReportCard>

      <ReportCard>
        <ResultsBar position="top" title="Detailed Report" loading={loading} actions={<>
          <button type="button" className={`btn-ghost ${CONTROL}`} disabled={exp.busy || loading || !!error} onClick={() => runExport('csv')}>Export CSV</button>
          <button type="button" className={`btn-ghost ${CONTROL}`} disabled={exp.busy || loading || !!error} onClick={() => runExport('xlsx')}>Export Excel</button>
        </>}>
          <ActiveFilterChips
            chips={offerId ? [{ key: 'offer', value: offerId, label: 'Offer', valueLabel: offerName(offerId) }] : []}
            onRemove={clearOffer} onClearAll={clearOffer} />
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
                    <th >Date</th>
                    <th >{rowCategory === 'click' || rowCategory === 'conversion' ? 'Offer' : 'Offer Group'}</th>
                    <th className="text-right font-semibold">% Daily {CATEGORY_LABELS[rowCategory]} Cap Used</th>
                    <th className="text-right font-semibold">Daily {CATEGORY_LABELS[rowCategory]} Cap</th>
                    <th className="text-right font-semibold">{rowCategory === 'click' ? 'Clicks' : rowCategory === 'conversion' ? 'Conversions' : CATEGORY_LABELS[rowCategory]}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.date}-${r.entityId}`} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatDate(r.date)}</td>
                      <td className="px-4 py-3"><Link to={entityHref(r)} className="text-accent-text hover:underline">{r.entity}</Link></td>
                      <td className="px-4 py-3 text-right">{pctCell(r.usedPct)}</td>
                      <td className="px-4 py-3 text-right">{CAP_UNIT[rowCategory](r.cap)}</td>
                      <td className="px-4 py-3 text-right">{CAP_UNIT[rowCategory](r.actual)}</td>
                    </tr>
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

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/pacing?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, category, offer: offerId || undefined,
      }} />}
    </>
  );
}
