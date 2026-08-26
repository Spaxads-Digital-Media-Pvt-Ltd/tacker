/**
 * Advertisers › Invoices › Manage — the Accounts Receivable counterpart to Partners' Manage
 * Invoices, verified item-by-item against the live reference (a simpler page than Partners':
 * single Notes field, no Payment Method column, no Exports tab, row kebab is Edit/Pay/Delete only
 * in the reference — History added here too, matching this app's own established audit pattern).
 * billedAmount is computed once at creation from the real ledger (see advertiser-invoices/routes.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import type { AdvertiserInvoice, AdvertiserInvoiceSummary, Advertiser, DashboardUser } from '../../types';

const STATUS_DOT: Record<string, string> = { unpaid: 'bg-warning', paid: 'bg-success', deleted: 'bg-danger-text' };
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', paid: 'Paid', deleted: 'Deleted' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'unpaid', label: 'Unpaid', dot: STATUS_DOT['unpaid']! },
  { value: 'paid', label: 'Paid', dot: STATUS_DOT['paid']! },
  { value: 'deleted', label: 'Deleted', dot: STATUS_DOT['deleted']! },
] as const;
const PAYMENT_TERMS_OPTIONS = ['None', 'Net 7', 'Net 15', 'Net 30', 'Net 60'];
const ALL_COLUMNS = ['Invoice ID', 'Advertiser', 'Status', 'Visibility', 'Payment Terms', 'Start Date', 'End Date', 'Billed', 'Paid', 'Balance', 'Notes', 'Created', 'Modified'] as const;

const money = (v: string | number, c = 'USD') => `${c} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return { open, setOpen, ref };
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const current = STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[1];
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
        <span className={`h-2 w-2 rounded-full ${current.dot}`} /> {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-36 rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {STATUS_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              <span className={`h-2 w-2 rounded-full ${o.dot}`} /> {o.label}
              {o.value === value && <span className="ml-auto text-accent-text">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Notes">
      <p className="text-small text-fg">{text}</p>
    </Modal>
  );
}

function downloadInvoiceExport(format: 'csv' | 'json', rows: AdvertiserInvoice[]) {
  const mapped = rows.map((i) => ({
    invoiceId: i.ref, advertiser: i.advertiserName, status: i.status, visibility: i.visibleToAdvertiser ? 'YES' : 'NO',
    paymentTerms: i.paymentTerms ?? '', startDate: i.periodStart, endDate: i.periodEnd,
    billed: i.billedAmount, paid: i.paidAmount, balance: i.balance, currency: i.currency,
    notes: i.notes ?? '', created: i.createdAt, modified: i.updatedAt,
  }));
  let blob: Blob;
  if (format === 'json') {
    blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json;charset=utf-8;' });
  } else {
    const headers = Object.keys(mapped[0] ?? {
      invoiceId: '', advertiser: '', status: '', visibility: '', paymentTerms: '', startDate: '', endDate: '',
      billed: '', paid: '', balance: '', currency: '', notes: '', created: '', modified: '',
    });
    const lines = [headers.join(',')];
    for (const row of mapped) lines.push(headers.map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
    blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `advertiser-invoices-export-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/advertiser-invoices/${invoiceId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Invoice History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

function PayModal({ invoice, onClose, onDone }: { invoice: AdvertiserInvoice; onClose: () => void; onDone: () => void }) {
  const pay = useMutation(() => api.post(`/api/advertiser-invoices/${invoice.id}/pay`, {}));
  const confirmPay = async () => {
    if (await pay.run(undefined)) { onDone(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title="Pay Invoice">
      <div className="space-y-4">
        <p className="text-small text-fg-secondary">Mark Invoice ID: {invoice.ref} ({invoice.advertiserName}) as paid in full for {money(invoice.billedAmount, invoice.currency)}?</p>
        {pay.error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{pay.error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={pay.busy} onClick={confirmPay}>{pay.busy ? 'Processing…' : 'Pay'}</button>
        </div>
      </div>
    </Modal>
  );
}

function RowMenu({ invoice, onChanged }: { invoice: AdvertiserInvoice; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/advertiser-invoices/${invoice.id}`));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const doDelete = async () => {
    setOpen(false);
    if (!confirm(`Delete Invoice ID: ${invoice.ref}?`)) return;
    if (await del.run(undefined)) onChanged();
  };

  const item = (label: string, onClick: () => void, disabled?: boolean) => (
    <button role="menuitem" disabled={disabled} onClick={onClick}
      className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
      {label}
    </button>
  );

  return (
    <>
      <button ref={btnRef} title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-40 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => { setOpen(false); nav(`/app/adv-invoices/${invoice.id}/edit`); }, invoice.status === 'deleted')}
          {item('Pay', () => { setOpen(false); setPayOpen(true); }, invoice.status !== 'unpaid')}
          {item('Delete', doDelete, invoice.status === 'deleted')}
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal invoiceId={invoice.id} onClose={() => setHistoryOpen(false)} />}
      {payOpen && <PayModal invoice={invoice} onClose={() => setPayOpen(false)} onDone={onChanged} />}
    </>
  );
}

export default function AdvertiserInvoicesManage() {
  const [status, setStatus] = useState('unpaid');
  const { data, loading, error, refetch } = useQuery<AdvertiserInvoice[]>(`/api/advertiser-invoices?status=${status}`);
  const { data: summary, refetch: refetchSummary } = useQuery<AdvertiserInvoiceSummary>('/api/advertiser-invoices/summary');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: users } = useQuery<DashboardUser[]>('/api/users');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [notesText, setNotesText] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) { setTableActionsOpen(false); setExportOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'accountManager', label: 'Advertiser Manager', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'paymentTerms', label: 'Payment Terms', options: PAYMENT_TERMS_OPTIONS.map((t) => ({ value: t, label: t })) },
    { key: 'visibility', label: 'Visibility', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  ], [advertisers, users]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((i) => i.advertiserName.toLowerCase().includes(qq) || String(i.ref).includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('advertiser')) rows = rows.filter((i) => filters['advertiser']!.includes(i.advertiserId));
    if (has('accountManager')) {
      rows = rows.filter((i) => {
        const adv = advertisers?.find((a) => a.id === i.advertiserId);
        return adv?.accountManagerId && filters['accountManager']!.includes(adv.accountManagerId);
      });
    }
    if (has('paymentTerms')) rows = rows.filter((i) => i.paymentTerms && filters['paymentTerms']!.includes(i.paymentTerms));
    if (has('visibility')) rows = rows.filter((i) => filters['visibility']!.includes(i.visibleToAdvertiser ? 'yes' : 'no'));
    return rows;
  }, [data, q, filters, advertisers]);

  const afterChange = () => { refetch(); refetchSummary(); };

  const columnsByHeader: Record<string, Column<AdvertiserInvoice>> = {
    'Invoice ID': { header: 'Invoice ID', cell: (i) => <Link to={`/app/adv-invoices/${i.id}`} className="text-accent-text hover:underline">Invoice {i.ref}</Link> },
    Advertiser: { header: 'Advertiser', cell: (i) => <Link to={`/app/advertisers/${i.advertiserId}`} className="text-accent-text hover:underline">{i.advertiserName}{i.advertiserRef ? ` (${i.advertiserRef})` : ''}</Link> },
    Status: { header: 'Status', cell: (i) => <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[i.status]}`} />{STATUS_LABEL[i.status]}</span> },
    Visibility: { header: 'Visibility', cell: (i) => (i.visibleToAdvertiser ? 'YES' : <span className="text-danger-text">NO</span>) },
    'Payment Terms': { header: 'Payment Terms', cell: (i) => i.paymentTerms ?? <span className="text-fg-muted">-</span> },
    'Start Date': { header: 'Start Date', cell: (i) => new Date(i.periodStart).toLocaleDateString() },
    'End Date': { header: 'End Date', cell: (i) => new Date(i.periodEnd).toLocaleDateString() },
    Billed: { header: 'Billed', className: 'text-right', cell: (i) => money(i.billedAmount, i.currency) },
    Paid: { header: 'Paid', className: 'text-right', cell: (i) => money(i.paidAmount, i.currency) },
    Balance: { header: 'Balance', className: 'text-right', cell: (i) => <span className="font-semibold">{money(i.balance, i.currency)}</span> },
    Notes: { header: 'Notes', cell: (i) => (i.notes ? <button className="text-accent-text hover:underline" onClick={() => setNotesText(i.notes)}>View</button> : <span className="text-fg-muted">-</span>) },
    Created: { header: 'Created', cell: (i) => new Date(i.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (i) => new Date(i.updatedAt).toLocaleString() },
  };
  const kebabCol: Column<AdvertiserInvoice> = { header: '', className: 'text-right', cell: (i) => <RowMenu invoice={i} onChanged={afterChange} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<AdvertiserInvoice> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, kebabCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, filtered]);

  return (
    <>
      <PageHeader title="Manage Invoices" subtitle="Advertisers › Invoices › Manage" />

      <div className="mb-4 rounded-card border border-border bg-surface">
        <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-small font-medium text-fg">
          <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
        </button>
        {summaryOpen && (
          <div className="grid grid-cols-3 gap-4 border-t border-border px-4 py-4">
            <div><p className="text-tiny uppercase text-fg-secondary">Billed Amount</p><p className="text-h3 font-semibold text-fg">{summary ? money(summary.billedAmount) : '—'}</p></div>
            <div><p className="text-tiny uppercase text-fg-secondary">Paid Amount</p><p className="text-h3 font-semibold text-fg">{summary ? money(summary.paidAmount) : '—'}</p></div>
            <div><p className="text-tiny uppercase text-fg-secondary">Balance</p><p className="text-h3 font-semibold text-fg">{summary ? money(summary.balance) : '—'}</p></div>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/adv-invoices/new" className="btn-primary">+ Invoices</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <StatusSelect value={status} onChange={setStatus} />
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="advertiser-invoices" />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
                  <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-full top-0 mr-1 w-28 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button onClick={() => { downloadInvoiceExport('csv', filtered); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                      <button onClick={() => { downloadInvoiceExport('json', filtered); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">JSON</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                <button onClick={() => { setTableActionsOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No Record Found</StateBlock>
        : (
          <>
            <Table columns={displayedColumns} rows={filtered} rowKey={(i) => i.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
          </>
        )}

      {notesText !== null && <NotesModal text={notesText} onClose={() => setNotesText(null)} />}
      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/advertiser-invoices?status=${status}`} appliedFilters={{ status, search: q || undefined }} />}
    </>
  );
}
