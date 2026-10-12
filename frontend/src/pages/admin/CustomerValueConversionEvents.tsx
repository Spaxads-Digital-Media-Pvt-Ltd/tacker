/**
 * Customer Value › Conversion Events Report — the reference's own primary debugging tool for
 * this feature, per its real docs: "Enter a specific User ID to see a complete log of their
 * activity, all Data Points received (like geo, deposit, etc.), and which rules were applied."
 *
 * Structured as the same real detailed-report shell already verified live against the reference
 * on Reporting › Conversion (see ConversionReport.tsx): one report card — controls (User ID + date
 * range + Clear; no Run Report, each applies on its own) over a results bar (Search + Table Actions
 * kebab) and the table + pagination — the Customer Value module itself is gated on the public demo account (a direct
 * URL is accepted by the router but renders blank), but this report shell is the one real,
 * confirmed convention every other detailed report in this app follows, so this page follows it
 * too instead of a bespoke layout.
 *
 * Real data: reads conversions.raw_params (captured verbatim from postback/pixel/S2S params) and
 * joins against customer_value_rule_firings for the Rule Applied column.
 */
import { useMemo, useState } from 'react';
import { Search, MoreVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { ColumnsModal } from '../../shared-components/primitives/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH } from '../../shared-components/primitives/ReportPageKit';
import { useQuery } from '../../lib/useApi';
import { useDebounced } from './pagedList';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';

interface EventRow {
  conversionId: string; createdAt: string; offerId: string; offerName: string;
  eventName: string | null; status: string; payout: string | null; revenue: string | null;
  dataPoints: { name: string; parameterKey: string; value: string }[];
  ruleName: string | null;
}
interface Report { userId: string; events: EventRow[] }

const ALL_COLUMNS = ['Conversion ID', 'Offer', 'Event', 'Status', 'Payout', 'Revenue', 'Data Points', 'Rule Applied'] as const;
const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return `${date} ${time}`;
}
function money(v: string | null): string {
  return v != null ? `$${Number(v).toFixed(2)}` : DASH;
}

export default function CustomerValueConversionEvents() {
  // No Run Report: the date range commits on its own once valid (useAutoDateRange) and the User ID
  // once typing settles; there is nothing to fetch until a User ID is entered.
  const range = useAutoDateRange(daysAgo(30), todayStr());
  const { appliedFrom, appliedTo, page, setPage, toFirstPage } = range;
  const [userIdInput, setUserIdInput] = useState('');
  const userId = useDebounced(userIdInput.trim(), 500);

  const [q, setQ] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const tableQs = qs({
    userId, from: toIso(appliedFrom), to: toIso(appliedTo, true),
    limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE,
  });
  const { data, loading } = useQuery<Report>(userId ? `/api/customer-value/conversion-events?${tableQs}` : null);

  const allEvents = data?.events ?? [];
  const hasNextPage = allEvents.length > PAGE_SIZE;
  const pageEvents = allEvents.slice(0, PAGE_SIZE);
  const rows = useMemo(() => pageEvents.filter((e) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return [e.offerName, e.eventName, e.ruleName, e.conversionId].some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [pageEvents, q]);

  const clearAll = () => { setUserIdInput(''); range.reset({ from: daysAgo(30), to: todayStr() }); setQ(''); };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const exportRows = () => rows.map((e) => ({
    conversionId: e.conversionId, created: formatDate(e.createdAt), offer: e.offerName, event: e.eventName ?? DASH,
    status: e.status, payout: money(e.payout), revenue: money(e.revenue),
    dataPoints: e.dataPoints.map((dp) => `${dp.name}=${dp.value}`).join('; '), ruleApplied: e.ruleName ?? DASH,
  }));

  return (
    <>
      <PageHeader title="Conversion Events Report" subtitle="Customer Value › Conversion Events Report" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<ClearButton onClick={clearAll} title="Reset User ID and dates" />}>
          <ControlField label="User ID *" htmlFor="cv-events-user-id">
            <input id="cv-events-user-id" className={`input ${CONTROL}`} placeholder="e.g. cust_778" value={userIdInput}
              onChange={(e) => { setUserIdInput(e.target.value); toFirstPage(); }} />
          </ControlField>
          <DateRangeField idPrefix="cv-events-report" label="Date range" from={range.from} to={range.to} max={todayStr()}
            invalid={range.problem !== null} onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <ResultsBar title="Detailed Report" loading={loading} actions={<>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className={`input ${CONTROL} !pl-8 sm:!w-56`} placeholder="Search this page…" aria-label="Search this page" title="Filters only the events on the current page" value={q} onChange={(e) => setQ(e.target.value)} />
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
                    <div className="absolute right-full top-0 mr-1 w-44 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <p className="px-3 py-1 text-tiny text-fg-muted">Current page only</p>
                      <button onClick={() => { downloadCsv('conversion-events-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV (current page)</button>
                      <button onClick={() => { downloadXlsx('conversion-events-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel (current page)</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </>} />

        <ReportBody>
        {!userId ? <StateBlock>Enter a User ID to see that customer's full activity log.</StateBlock>
          : loading && !rows.length ? <StateBlock><Spinner /></StateBlock>
          : !rows.length ? <StateBlock>{q.trim() && pageEvents.length > 0 ? 'No events on this page match your search.' : 'No Record Found'}</StateBlock>
          : (
            <div className={`overflow-x-auto rounded-card border border-border transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th >Created</th>
                    {shown.has('Conversion ID') && <th >Conversion ID</th>}
                    {shown.has('Offer') && <th >Offer</th>}
                    {shown.has('Event') && <th >Event</th>}
                    {shown.has('Status') && <th >Status</th>}
                    {shown.has('Payout') && <th className="text-right font-semibold">Payout</th>}
                    {shown.has('Revenue') && <th className="text-right font-semibold">Revenue</th>}
                    {shown.has('Data Points') && <th >Data Points</th>}
                    {shown.has('Rule Applied') && <th >Rule Applied</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.conversionId} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatDate(e.createdAt)}</td>
                      {shown.has('Conversion ID') && <td className="font-mono text-tiny text-fg-secondary" title={e.conversionId}>{e.conversionId.slice(0, 12)}…</td>}
                      {shown.has('Offer') && <td className="px-4 py-3">{e.offerName}</td>}
                      {shown.has('Event') && <td className="px-4 py-3">{e.eventName ?? DASH}</td>}
                      {shown.has('Status') && <td className="px-4 py-3 capitalize">{e.status}</td>}
                      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(e.payout)}</td>}
                      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(e.revenue)}</td>}
                      {shown.has('Data Points') && (
                        <td className="px-4 py-3">
                          {e.dataPoints.length === 0 ? DASH : (
                            <div className="flex flex-wrap gap-1">
                              {e.dataPoints.map((dp) => <span key={dp.parameterKey} className="rounded-full bg-page px-2 py-0.5 text-tiny">{dp.name}={dp.value}</span>)}
                            </div>
                          )}
                        </td>
                      )}
                      {shown.has('Rule Applied') && (
                        <td className="px-4 py-3">
                          {e.ruleName ? <span className="rounded-full bg-success-bg px-2 py-0.5 text-tiny text-success-text">{e.ruleName}</span> : <span className="text-fg-muted">{DASH}</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {userId && (rows.length > 0 || hasNextPage || page > 1) && (
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

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
    </>
  );
}
