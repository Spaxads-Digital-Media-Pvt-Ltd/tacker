/**
 * Offers › Groups — matches the reference's real "Manage Offer Groups" (verified live at
 * /offers/groups): ID/Name/Advertiser/Offers/Today's Clicks/Today's Payout/Today's Revenue/Daily
 * Payout Cap/Daily Revenue Cap/Daily Click Cap/Daily Conversion Cap columns, a real search + Active
 * status filter + Table Actions (Export) toolbar, a per-row kebab (Edit), and — matching the
 * reference exactly — "+ Offer Group" and a group's Name navigate to real dedicated pages rather
 * than a modal.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, Filter } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, TableScroll } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { fmtMoney, type OfferGroup } from '../../data/offerGroups';
import type { Advertiser } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'paused', 'deleted'] as const;

function capCell(v: number | null | undefined, money: boolean) {
  if (v == null) return <span className="text-fg-muted">N/A</span>;
  return money ? fmtMoney(v) : v.toLocaleString();
}

function TableActionsMenu({ rows, advName }: { rows: OfferGroup[]; advName: (id: string | null) => string }) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.ref, Name: r.name, Advertiser: advName(r.advertiserId), Offers: r.offerIds.length,
    "Today's Clicks": r.today?.clicks ?? 0, "Today's Payout": fmtMoney(r.today?.payout), "Today's Revenue": fmtMoney(r.today?.revenue),
    'Daily Payout Cap': r.caps.payout?.daily ?? 'N/A', 'Daily Revenue Cap': r.caps.revenue?.daily ?? 'N/A',
    'Daily Click Cap': r.caps.clicks?.daily ?? 'N/A', 'Daily Conversion Cap': r.caps.conversions?.daily ?? 'N/A',
  }));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSubOpen(false); }} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-card border border-border bg-elevated p-1 shadow-elevated">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <div className="relative">
              <button type="button" onClick={() => setSubOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
                Export <ChevronRight size={13} />
              </button>
              {subOpen && (
                <div className="absolute left-full top-0 z-30 ml-1 w-36 rounded-card border border-border bg-elevated p-1 shadow-elevated">
                  <button type="button" onClick={() => { downloadCsv('offer-groups.csv', exportRows()); setOpen(false); setSubOpen(false); }}
                    className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">CSV</button>
                  <button type="button" onClick={() => { downloadXlsx('offer-groups.xlsx', exportRows()); setOpen(false); setSubOpen(false); }}
                    className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Excel</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RowMenu({ onEdit }: { onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={openMenu} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-40 rounded-card border border-border bg-elevated py-1 shadow-elevated">
            <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Edit</button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

export default function OfferGroups() {
  const { data, loading, error } = useQuery<OfferGroup[]>('/api/offer-groups');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);

  const advName = (id: string | null) => (id ? advertisers?.find((a) => a.id === id)?.name ?? id.slice(0, 8) + '…' : '—');

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    return out;
  }, [data, status, q]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Manage Offer Groups" subtitle="Offers › Groups › Manage" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <button className="btn-primary max-sm:w-full" onClick={() => nav('/app/offers-groups/add')}><Plus size={15} /> Offer Group</button>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <div className="relative max-sm:w-full">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-full sm:!w-56 !pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="input !w-auto">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button type="button" title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Filter size={15} /></button>
          <TableActionsMenu rows={rows} advName={advName} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No offer groups yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No offer groups match your filters.</StateBlock>
        : (
          <>
            <TableScroll>
              <table className="w-full min-w-[1300px] text-left text-body">
                <thead className="sticky top-0 z-20 border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Advertiser</th>
                    <th className="px-4 py-3 font-semibold">Offers</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Clicks</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Payout</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Revenue</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Payout Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Revenue Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Click Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Conversion Cap</th>
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                      <td className="px-4 py-3"><button className="font-medium text-accent-text hover:underline" onClick={() => nav(`/app/offers-groups/${r.id}`)}>{r.name}</button></td>
                      <td className="px-4 py-3 text-accent-text">{advName(r.advertiserId)}</td>
                      <td className="px-4 py-3 text-fg-secondary">{r.offerIds.length}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{(r.today?.clicks ?? 0).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{fmtMoney(r.today?.payout)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{fmtMoney(r.today?.revenue)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{r.capsEnabled ? capCell(r.caps.payout?.daily, true) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{r.capsEnabled ? capCell(r.caps.revenue?.daily, true) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{r.capsEnabled ? capCell(r.caps.clicks?.daily, false) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small">{r.capsEnabled ? capCell(r.caps.conversions?.daily, false) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowMenu onEdit={() => nav(`/app/offers-groups/${r.id}/edit`)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <div className="mt-3 flex justify-end">
              <Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          </>
        )}
    </>
  );
}
