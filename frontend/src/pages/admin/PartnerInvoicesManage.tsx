/**
 * Partners › Invoices › Manage — verified item-by-item against the live reference. Billed amounts
 * are computed once at creation time from the real ledger (see partner-invoices/routes.ts) and
 * locked in as a snapshot, matching how a real invoice works. "Approve & Pay" marks an invoice paid
 * in full — a defensible simplification of the reference's per-row partial-payment flow, since this
 * app has no separate payments ledger to record partial amounts against.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Tabs, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal, useDropdown } from '../../components/TableActionsKit';
import type { PartnerInvoice, PartnerInvoiceSummary, Publisher } from '../../types';

/** Real client-side CSV/JSON export (same pattern as Offers/Publishers Table Actions) — no export
 * job queue exists server-side, so the "Exports" tab below is a browser-local history of what this
 * browser has generated, not a synced/server-tracked list. */
function downloadInvoiceExport(format: 'csv' | 'json', rows: PartnerInvoice[]) {
  const mapped = rows.map((i) => ({
    invoiceId: i.ref, partner: i.publisherName, status: i.status, visibility: i.visibleToPartner ? 'YES' : 'NO',
    paymentTerms: i.paymentTerms ?? '', paymentMethod: i.paymentMethod ?? '',
    startDate: i.periodStart, endDate: i.periodEnd, billed: i.billedAmount, payments: i.paymentsAmount,
    paidDate: i.paidAt ?? '', balance: i.balance, currency: i.currency,
    publicNotes: i.publicNotes ?? '', internalNotes: i.internalNotes ?? '',
    created: i.createdAt, modified: i.updatedAt,
  }));
  let blob: Blob;
  if (format === 'json') {
    blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json;charset=utf-8;' });
  } else {
    const headers = Object.keys(mapped[0] ?? {
      invoiceId: '', partner: '', status: '', visibility: '', paymentTerms: '', paymentMethod: '',
      startDate: '', endDate: '', billed: '', payments: '', paidDate: '', balance: '', currency: '',
      publicNotes: '', internalNotes: '', created: '', modified: '',
    });
    const lines = [headers.join(',')];
    for (const row of mapped) {
      lines.push(headers.map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
    }
    blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoices-export-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const EXPORT_HISTORY_KEY = 'tracker.exportHistory.partner-invoices';
interface ExportHistoryEntry { at: string; format: 'csv' | 'json'; rowCount: number }
function loadExportHistory(): ExportHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(EXPORT_HISTORY_KEY) ?? '[]'); } catch { return []; }
}
function recordExport(entry: ExportHistoryEntry) {
  try { localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify([entry, ...loadExportHistory()].slice(0, 50))); } catch { /* best-effort */ }
}
function runExport(format: 'csv' | 'json', rows: PartnerInvoice[], onDone: () => void) {
  downloadInvoiceExport(format, rows);
  recordExport({ at: new Date().toISOString(), format, rowCount: rows.length });
  onDone();
}

const STATUS_DOT: Record<string, string> = { unpaid: 'bg-warning', paid: 'bg-success', deleted: 'bg-danger-text' };
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', paid: 'Paid', deleted: 'Deleted' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'unpaid', label: 'Unpaid', dot: STATUS_DOT['unpaid']! },
  { value: 'paid', label: 'Paid', dot: STATUS_DOT['paid']! },
  { value: 'deleted', label: 'Deleted', dot: STATUS_DOT['deleted']! },
] as const;
const PAYMENT_TERMS_OPTIONS = ['None', 'Net 7', 'Net 15', 'Net 30', 'Net 60'];
const ALL_COLUMNS = ['Invoice ID', 'Partner', 'Status', 'Visibility', 'Payment Terms', 'Payment Method', 'Start Date', 'End Date', 'Billed', 'Payments', 'Paid Date', 'Balance', 'Public Notes', 'Internal Notes', 'Created', 'Modified'] as const;

const money = (v: string | number, c = 'USD') => `${c} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, ref, setOpen]);
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

function NotesModal({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title}>
      <p className="text-small text-fg">{text}</p>
    </Modal>
  );
}

function ApprovePayModal({ invoices, onClose, onDone }: { invoices: PartnerInvoice[]; onClose: () => void; onDone: () => void }) {
  const total = invoices.reduce((sum, inv) => sum + Number(inv.billedAmount), 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (invoices.length === 1) {
        await api.post(`/api/partner-invoices/${invoices[0]!.id}/approve-pay`, {});
      } else {
        await api.post('/api/partner-invoices/bulk-approve-pay', { ids: invoices.map((i) => i.id) });
      }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve & pay');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Approve & Pay" size="xl">
      <div className="space-y-4">
        <div className="rounded-card border border-border bg-page p-4 text-center">
          <p className="text-tiny uppercase text-fg-secondary">Total {invoices[0]?.currency ?? 'USD'}</p>
          <p className="text-h2 font-semibold text-fg">{money(total, invoices[0]?.currency)}</p>
        </div>
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left text-small">
            <thead className="bg-page text-tiny uppercase text-fg-secondary">
              <tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Partner</th><th className="px-3 py-2">Payment Method</th><th className="px-3 py-2 text-right">Payment Amount</th></tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-3 py-2 text-fg">{inv.ref}</td>
                  <td className="px-3 py-2 text-fg">{inv.publisherName}</td>
                  <td className="px-3 py-2 text-fg">{inv.paymentMethod ?? '-'}</td>
                  <td className="px-3 py-2 text-right font-medium text-fg">{money(inv.billedAmount, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>{busy ? 'Processing…' : 'Approve & Pay'}</button>
        </div>
      </div>
    </Modal>
  );
}

function RowMenu({ invoice, onChanged }: { invoice: PartnerInvoice; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/partner-invoices/${invoice.id}`));
  const toggleVisible = useMutation((body: Record<string, unknown>) => api.patch(`/api/partner-invoices/${invoice.id}`, body));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

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
      setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const doDelete = async () => {
    setOpen(false);
    if (!confirm(`Delete Invoice ID: ${invoice.ref}?`)) return;
    if (await del.run(undefined)) onChanged();
  };
  const doToggleVisible = async () => {
    setOpen(false);
    if (await toggleVisible.run({ visibleToPartner: !invoice.visibleToPartner })) onChanged();
  };

  const item = (label: string, onClick: () => void, opts?: { disabled?: boolean; hasSubmenu?: boolean }) => (
    <button role="menuitem" disabled={opts?.disabled} onClick={onClick}
      className="flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
      {label}
      {opts?.hasSubmenu && <ChevronRight size={13} className="text-fg-muted" />}
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
          className="z-50 w-44 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => { setOpen(false); nav(`/app/aff-invoices/${invoice.id}/edit`); }, { disabled: invoice.status === 'deleted' })}
          {item(invoice.visibleToPartner ? 'Hide from Partner' : 'Show to Partner', doToggleVisible, { disabled: invoice.status === 'deleted' })}
          {item('Mark Invoice as Paid', async () => { setOpen(false); await api.post(`/api/partner-invoices/${invoice.id}/approve-pay`, {}); onChanged(); }, { disabled: invoice.status !== 'unpaid' })}
          {item('Delete', doDelete, { disabled: invoice.status === 'deleted' })}
          <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
            {item('Export', () => setExportOpen((s) => !s), { hasSubmenu: true })}
            {exportOpen && (
              <div className="absolute right-full top-0 mr-1 w-28 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                {item('CSV', () => runExport('csv', [invoice], () => { setOpen(false); setExportOpen(false); }))}
                {item('JSON', () => runExport('json', [invoice], () => { setOpen(false); setExportOpen(false); }))}
              </div>
            )}
          </div>
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal invoiceId={invoice.id} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/partner-invoices/${invoiceId}/history`);
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

function ExportsTab() {
  const [history, setHistory] = useState<ExportHistoryEntry[]>(() => loadExportHistory());
  useEffect(() => { setHistory(loadExportHistory()); }, []);
  const columns: Column<ExportHistoryEntry & { idx: number }>[] = [
    { header: 'Generated', cell: (e) => new Date(e.at).toLocaleString() },
    { header: 'Format', cell: (e) => e.format.toUpperCase() },
    { header: 'Rows', className: 'text-right', cell: (e) => String(e.rowCount) },
  ];
  return (
    <>
      <p className="mb-3 text-tiny text-fg-secondary">Exports are generated instantly in your browser (no server-side export queue) — this is a local history of files this browser has downloaded, not a synced record.</p>
      {history.length === 0 ? <StateBlock>No exports generated yet.</StateBlock>
        : <Table columns={columns} rows={history.map((e, idx) => ({ ...e, idx }))} rowKey={(e) => String(e.idx)} />}
    </>
  );
}

export default function PartnerInvoicesManage() {
  const [page, setPage] = useState('Invoices');
  const [status, setStatus] = useState('unpaid');
  const { data, loading, error, refetch } = useQuery<PartnerInvoice[]>(`/api/partner-invoices?status=${status}`);
  const { data: summary, refetch: refetchSummary } = useQuery<PartnerInvoiceSummary>('/api/partner-invoices/summary');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [notesModal, setNotesModal] = useState<{ title: string; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [approvePayFor, setApprovePayFor] = useState<PartnerInvoice[] | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) { setTableActionsOpen(false); setExportSubmenuOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'paymentTerms', label: 'Payment Terms', options: PAYMENT_TERMS_OPTIONS.map((t) => ({ value: t, label: t })) },
  ], [publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((i) => i.publisherName.toLowerCase().includes(qq) || String(i.ref).includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('partner')) rows = rows.filter((i) => filters['partner']!.includes(i.publisherId));
    if (has('paymentTerms')) rows = rows.filter((i) => i.paymentTerms && filters['paymentTerms']!.includes(i.paymentTerms));
    return rows;
  }, [data, q, filters]);

  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelected((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((i) => i.id))));
  const afterChange = () => { refetch(); refetchSummary(); setSelected(new Set()); };

  const columnsByHeader: Record<string, Column<PartnerInvoice>> = {
    'Invoice ID': { header: 'Invoice ID', cell: (i) => <Link to={`/app/aff-invoices/${i.id}`} className="text-accent-text hover:underline">Invoice ID: {i.ref}</Link> },
    Partner: { header: 'Partner', cell: (i) => <Link to={`/app/publishers/${i.publisherId}`} className="text-accent-text hover:underline">{i.publisherName}{i.publisherRef ? ` (ID: ${i.publisherRef})` : ''}</Link> },
    Status: { header: 'Status', cell: (i) => <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[i.status]}`} />{STATUS_LABEL[i.status]}</span> },
    Visibility: { header: 'Visibility', cell: (i) => (i.visibleToPartner ? 'YES' : <span className="text-danger-text">NO</span>) },
    'Payment Terms': { header: 'Payment Terms', cell: (i) => i.paymentTerms ?? <span className="text-fg-muted">-</span> },
    'Payment Method': { header: 'Payment Method', cell: (i) => i.paymentMethod ?? <span className="text-fg-muted">-</span> },
    'Start Date': { header: 'Start Date', cell: (i) => new Date(i.periodStart).toLocaleDateString() },
    'End Date': { header: 'End Date', cell: (i) => new Date(i.periodEnd).toLocaleDateString() },
    Billed: { header: 'Billed', className: 'text-right', cell: (i) => money(i.billedAmount, i.currency) },
    Payments: { header: 'Payments', className: 'text-right', cell: (i) => money(i.paymentsAmount, i.currency) },
    'Paid Date': { header: 'Paid Date', cell: (i) => (i.paidAt ? new Date(i.paidAt).toLocaleDateString() : <span className="text-fg-muted">-</span>) },
    Balance: { header: 'Balance', className: 'text-right', cell: (i) => <span className="font-semibold">{money(i.balance, i.currency)}</span> },
    'Public Notes': { header: 'Public Notes', cell: (i) => (i.publicNotes ? <button className="text-accent-text hover:underline" onClick={() => setNotesModal({ title: 'Public Notes', text: i.publicNotes! })}>View</button> : <span className="text-fg-muted">-</span>) },
    'Internal Notes': { header: 'Internal Notes', cell: (i) => (i.internalNotes ? <button className="text-accent-text hover:underline" onClick={() => setNotesModal({ title: 'Internal Notes', text: i.internalNotes! })}>View</button> : <span className="text-fg-muted">-</span>) },
    Created: { header: 'Created', cell: (i) => new Date(i.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (i) => new Date(i.updatedAt).toLocaleString() },
  };
  const checkboxCol: Column<PartnerInvoice> = {
    header: '', cell: (i) => <input type="checkbox" className="chk" checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} />,
  };
  const actionCol: Column<PartnerInvoice> = {
    header: '', cell: (i) => (i.status === 'unpaid' ? (
      <button type="button" className="btn-ghost !py-1 !text-tiny" onClick={() => setApprovePayFor([i])}>Approve &amp; Pay</button>
    ) : null),
  };
  const kebabCol: Column<PartnerInvoice> = { header: '', className: 'text-right', cell: (i) => <RowMenu invoice={i} onChanged={afterChange} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<PartnerInvoice> => Boolean(c && shownColumns.has(c.header)));
    return [checkboxCol, ...ordered, actionCol, kebabCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, selected, filtered]);

  const selectedInvoices = filtered.filter((i) => selected.has(i.id) && i.status === 'unpaid');

  return (
    <>
      <PageHeader title="Manage Invoices" subtitle="Partners › Invoices › Manage" />
      <Tabs tabs={['Invoices', 'Exports']} active={page} onChange={setPage} />
      {page === 'Exports' ? <ExportsTab /> : (
      <>
      <div className="mb-4 rounded-card border border-border bg-surface">
        <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-small font-medium text-fg">
          <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
        </button>
        {summaryOpen && (
          <div className="grid grid-cols-3 gap-4 border-t border-border px-4 py-4">
            <div><p className="text-tiny uppercase text-fg-secondary">Billed Amount</p><p className="text-h3 font-semibold text-fg">{summary ? money(summary.billedAmount) : '—'}</p></div>
            <div><p className="text-tiny uppercase text-fg-secondary">Payments Amount(s)</p><p className="text-h3 font-semibold text-fg">{summary ? money(summary.paymentsAmount) : '—'}</p></div>
            <div><p className="text-tiny uppercase text-fg-secondary">Balance</p><p className="text-h3 font-semibold text-fg">{summary ? money(summary.balance) : '—'}</p></div>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/aff-invoices/new" className="btn-primary">+ Invoices</Link>
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
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="partner-invoices" />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <button disabled={selectedInvoices.length === 0} onClick={() => { setTableActionsOpen(false); setApprovePayFor(selectedInvoices); }}
                  className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
                  Bulk Approve &amp; Pay {selectedInvoices.length > 0 ? `(${selectedInvoices.length})` : ''}
                </button>
                <div className="relative" onMouseEnter={() => setExportSubmenuOpen(true)} onMouseLeave={() => setExportSubmenuOpen(false)}>
                  <button onClick={() => setExportSubmenuOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export {selected.size > 0 ? `(${selected.size})` : `All (${filtered.length})`} <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportSubmenuOpen && (
                    <div className="absolute right-full top-0 mr-1 w-28 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button onClick={() => runExport('csv', selected.size > 0 ? filtered.filter((i) => selected.has(i.id)) : filtered, () => { setTableActionsOpen(false); setExportSubmenuOpen(false); })}
                        className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                      <button onClick={() => runExport('json', selected.size > 0 ? filtered.filter((i) => selected.has(i.id)) : filtered, () => { setTableActionsOpen(false); setExportSubmenuOpen(false); })}
                        className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">JSON</button>
                    </div>
                  )}
                </div>
                <div className="my-1 border-t border-border" />
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
            <div className="mt-3 flex items-center justify-between text-tiny text-fg-secondary">
              <button type="button" onClick={toggleSelectAll} className="text-accent-text hover:underline">
                {selected.size === filtered.length ? 'Deselect all' : `Select all ${filtered.length}`}
              </button>
              <span>{selected.size > 0 ? `${selected.size} selected · ` : ''}{filtered.length} Total</span>
            </div>
          </>
        )}

      {notesModal && <NotesModal title={notesModal.title} text={notesModal.text} onClose={() => setNotesModal(null)} />}
      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/partner-invoices?status=${status}`} appliedFilters={{ status, search: q || undefined }} />}
      {approvePayFor && <ApprovePayModal invoices={approvePayFor} onClose={() => setApprovePayFor(null)} onDone={afterChange} />}
      </>
      )}
    </>
  );
}
