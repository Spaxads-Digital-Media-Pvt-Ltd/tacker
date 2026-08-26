/**
 * Customer Value › Conversion Events Report — the reference's own primary debugging tool for
 * this feature, per its real docs: "Enter a specific User ID to see a complete log of their
 * activity, all Data Points received (like geo, deposit, etc.), and which rules were applied."
 *
 * Structured as the same real detailed-report shell already verified live against the reference
 * on Reporting › Conversion (see ConversionReport.tsx): a filter card (date range + User ID +
 * Run Report/Clear) above a Detailed Report card (Search + Table Actions kebab + table +
 * pagination) — the Customer Value module itself is gated on the public demo account (a direct
 * URL is accepted by the router but renders blank), but this report shell is the one real,
 * confirmed convention every other detailed report in this app follows, so this page follows it
 * too instead of a bespoke layout.
 *
 * Real data: reads conversions.raw_params (captured verbatim from postback/pixel/S2S params) and
 * joins against customer_value_rule_firings for the Rule Applied column.
 */
import { useMemo, useState } from 'react';
import { Search, MoreVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { ColumnsModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH } from '../../components/ReportPageKit';
import { useQuery } from '../../lib/useApi';

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
  const [userIdInput, setUserIdInput] = useState('');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [appliedUserId, setAppliedUserId] = useState('');
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [hasRun, setHasRun] = useState(false);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
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
    userId: appliedUserId, from: toIso(appliedFrom), to: toIso(appliedTo, true),
    limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE,
  });
  const { data, loading } = useQuery<Report>(hasRun ? `/api/customer-value/conversion-events?${tableQs}` : null);

  const allEvents = data?.events ?? [];
  const hasNextPage = allEvents.length > PAGE_SIZE;
  const pageEvents = allEvents.slice(0, PAGE_SIZE);
  const rows = useMemo(() => pageEvents.filter((e) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return [e.offerName, e.eventName, e.ruleName, e.conversionId].some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [pageEvents, q]);

  const runReport = () => {
    setAppliedUserId(userIdInput.trim()); setAppliedFrom(from); setAppliedTo(to);
    setHasRun(true); setPage(1);
  };
  const clearAll = () => {
    setUserIdInput(''); setFrom(daysAgo(30)); setTo(todayStr());
    setAppliedUserId(''); setAppliedFrom(daysAgo(30)); setAppliedTo(todayStr());
    setHasRun(false); setPage(1);
  };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const exportRows = () => rows.map((e) => ({
    conversionId: e.conversionId, created: formatDate(e.createdAt), offer: e.offerName, event: e.eventName ?? DASH,
    status: e.status, payout: money(e.payout), revenue: money(e.revenue),
    dataPoints: e.dataPoints.map((dp) => `${dp.name}=${dp.value}`).join('; '), ruleApplied: e.ruleName ?? DASH,
  }));

  return (
    <>
      <PageHeader title="Conversion Events Report" subtitle="Customer Value › Conversion Events Report" />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <label className="label mb-1 block">User ID *</label>
            <input className="input" placeholder="e.g. cust_778" value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" disabled={!userIdInput.trim()} onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                      Export <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                    {exportOpen && (
                      <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                        <button onClick={() => { downloadCsv('conversion-events-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('conversion-events-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {!hasRun ? <StateBlock>Enter a User ID and run the report to see that customer's full activity log.</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[960px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Created</th>
                    {shown.has('Conversion ID') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Conversion ID</th>}
                    {shown.has('Offer') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>}
                    {shown.has('Event') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Event</th>}
                    {shown.has('Status') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Status</th>}
                    {shown.has('Payout') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Payout</th>}
                    {shown.has('Revenue') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Revenue</th>}
                    {shown.has('Data Points') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Data Points</th>}
                    {shown.has('Rule Applied') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Rule Applied</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((e) => (
                    <tr key={e.conversionId} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{formatDate(e.createdAt)}</td>
                      {shown.has('Conversion ID') && <td className="whitespace-nowrap px-4 py-3 font-mono text-tiny text-fg-secondary" title={e.conversionId}>{e.conversionId.slice(0, 12)}…</td>}
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
        {hasRun && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span>Page {page}</span>
            <div className="flex items-center gap-1">
              <button type="button" title="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeft size={14} />
              </button>
              <button type="button" title="Next page" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
    </>
  );
}
