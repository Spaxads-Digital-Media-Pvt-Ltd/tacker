/**
 * Offers › Traffic Controls — matches the reference's real "Manage Traffic Controls" (verified live
 * at /offers/trafficcontrols): ID/Name/Offers/Advertisers/Partners/Control Type/Created/Modified
 * columns (each association column showing "- All" when unscoped, real names + "View all (N)"
 * otherwise), a real search + Active status filter + Table Actions (Columns Customization/Show API
 * Request) toolbar, a per-row kebab (Edit/Set as Deleted/History — History opens a modal, not a
 * page), and — matching the reference exactly — "+ Traffic Control" navigates to a real dedicated
 * page rather than a modal.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, Filter, X } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, type Column, Table } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { fmtDateTime, type TrafficControl } from '../../data/trafficControls';
import type { Advertiser, Offer, Publisher } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive', 'deleted'] as const;
const ALL_COLUMNS = ['Name', 'Offers', 'Advertisers', 'Partners', 'Control Type', 'Created', 'Modified'] as const;

function DateTimeCell({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return <><div>{date}</div><div className="text-tiny text-fg-secondary">{time}</div></>;
}

/** `showAll` renders "- All" (this association is unscoped, matching the reference's own "- All"
 * cell); otherwise a plain "—" when there's nothing to show for this column on this row. */
function AssocCell({ ids, names, showAll }: { ids: string[]; names: (id: string) => string; showAll: boolean }) {
  if (showAll) return <span className="text-fg-secondary">- All</span>;
  if (ids.length === 0) return <span className="text-fg-muted">—</span>;
  return (
    <div className="space-y-0.5">
      {ids.slice(0, 2).map((id) => <p key={id} className="text-tiny text-fg">- {names(id)}</p>)}
      {ids.length > 2 && <p className="text-tiny text-fg-secondary">View all ({ids.length})</p>}
    </div>
  );
}

function TableActionsMenu({ order, hidden, onApply }: { order: string[]; hidden: Set<string>; onApply: (o: string[], h: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-card border border-border bg-surface p-1 shadow-lg">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <button type="button" onClick={() => { setOpen(false); setColumnsOpen(true); }} className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Columns Customization <ChevronRight size={13} /></button>
            <button type="button" onClick={() => { setOpen(false); setApiOpen(true); }} className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Show API Request</button>
          </div>
        </>
      )}
      {columnsOpen && <ColumnsModal allColumns={ALL_COLUMNS} order={order} hidden={hidden} onClose={() => setColumnsOpen(false)} onApply={onApply} />}
      {apiOpen && <ApiRequestModal onClose={() => setApiOpen(false)} path="/api/traffic-controls" appliedFilters={{}} />}
    </div>
  );
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }

function HistoryModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/traffic-controls/${id}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-4xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">History</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg"><X size={18} /></button>
        </div>
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
          : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
      </div>
    </div>
  );
}

function RowMenu({ onEdit, onSetDeleted, onHistory }: { onEdit: () => void; onSetDeleted: () => void; onHistory: () => void }) {
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
          <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-40 rounded-card border border-border bg-surface py-1 shadow-lg">
            <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Edit</button>
            <button type="button" onClick={() => { setOpen(false); onSetDeleted(); }} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-danger-bg">Set as Deleted</button>
            <button type="button" onClick={() => { setOpen(false); onHistory(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">History</button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

export default function OfferTrafficControls() {
  const { data, loading, error, refetch } = useQuery<TrafficControl[]>('/api/traffic-controls');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [historyId, setHistoryId] = useState<string | null>(null);
  const setStatusMutation = useMutation(({ id, status: s }: { id: string; status: string }) => api.patch(`/api/traffic-controls/${id}`, { status: s }));

  const offerName = (id: string) => { const o = offers?.find((x) => x.id === id); return o ? (o.ref != null ? `${o.name} (${o.ref})` : o.name) : id.slice(0, 8) + '…'; };
  const advertiserName = (id: string) => { const a = advertisers?.find((x) => x.id === id); return a ? (a.ref != null ? `${a.name} (${a.ref})` : a.name) : id.slice(0, 8) + '…'; };
  const partnerName = (id: string) => { const p = publishers?.find((x) => x.id === id); return p ? (p.ref != null ? `${p.name} (${p.ref})` : p.name) : id.slice(0, 8) + '…'; };

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    return out;
  }, [data, status, q]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showCol = (c: string) => !hiddenColumns.has(c);

  const cellFor = (c: string, r: TrafficControl) => {
    switch (c) {
      case 'Name': return r.name;
      case 'Offers': return <AssocCell showAll={r.offerScope === 'all'} ids={r.offerScope === 'offers' ? r.offerIds : []} names={offerName} />;
      case 'Advertisers': return <AssocCell showAll={false} ids={r.offerScope === 'advertisers' ? r.advertiserIds : []} names={advertiserName} />;
      case 'Partners': return <AssocCell showAll={r.partnerScope === 'all'} ids={r.partnerIds} names={partnerName} />;
      case 'Control Type': return <span className="capitalize">{r.controlType}</span>;
      case 'Created': return <DateTimeCell iso={r.createdAt} />;
      case 'Modified': return <DateTimeCell iso={r.updatedAt} />;
      default: return null;
    }
  };

  return (
    <>
      <PageHeader title="Manage Traffic Controls" subtitle="Offers › Traffic Controls › Manage" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-primary" onClick={() => nav('/app/offers-traffic-controls/add')}><Plus size={15} /> Traffic Control</button>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-56 !pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="input !w-auto">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button type="button" title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Filter size={15} /></button>
          <TableActionsMenu order={columnOrder} hidden={hiddenColumns} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No traffic controls yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No traffic controls match your filters.</StateBlock>
        : (
          <>
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[1100px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">ID</th>
                    {columnOrder.filter(showCol).map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                      {columnOrder.filter(showCol).map((c) => (
                        <td key={c} className={`px-4 py-3 ${c === 'Created' || c === 'Modified' ? 'whitespace-nowrap' : ''} text-small`}>
                          {c === 'Name' ? (
                            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${r.status === 'active' ? 'bg-success' : r.status === 'inactive' ? 'bg-warning' : 'bg-danger'}`} />{r.name}</span>
                          ) : cellFor(c, r)}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowMenu onEdit={() => nav(`/app/offers-traffic-controls/${r.id}/edit`)}
                            onSetDeleted={async () => { await setStatusMutation.run({ id: r.id, status: 'deleted' }); refetch(); }}
                            onHistory={() => setHistoryId(r.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          </>
        )}

      {historyId && <HistoryModal id={historyId} onClose={() => setHistoryId(null)} />}
    </>
  );
}
