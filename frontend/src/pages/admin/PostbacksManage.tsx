/**
 * Partners › Postbacks › Manage — verified item-by-item against the live reference. Tabs split by
 * Postback Type (Conversion/Event/CPC — the real `level` column already used by SmartSwitch-style
 * entities in this app). The "Level" table column (Global/Specific/Global (Offer)) is derived from
 * which of publisher_id/offer_id are set — see the postbacks-manage-parity migration. Row actions
 * (Edit/Test/Delete/History) and Table Actions (Export/Columns/API Request) are all real.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import type { Postback, Publisher, Offer } from '../../types';

const TABS = [['conversion', 'Conversions'], ['event', 'Events'], ['cpc', 'CPC']] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', disabled: 'Inactive' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', disabled: 'bg-fg-muted' };
const SCOPE_LABEL: Record<string, string> = { specific: 'Specific', global: 'Global', global_offer: 'Global (Offer)' };
const DELIVERY_LABEL: Record<string, string> = { postback: 'Postback', html: 'HTML', meta: 'Meta', tiktok: 'TikTok', snapchat: 'Snapchat', rumble: 'Rumble' };
const SEARCH_FIELDS = [{ value: 'id', label: 'ID' }, { value: 'partner', label: 'Partner' }, { value: 'offer', label: 'Offer' }] as const;
type SearchField = (typeof SEARCH_FIELDS)[number]['value'];

const ALL_COLUMNS = ['ID', 'Partner', 'Offer', 'Level', 'Status', 'Method', 'Delay', 'Postback URL', 'HTML Code'] as const;
const PAGE_SIZE = 15;

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

function SearchFieldSelect({ value, onChange }: { value: SearchField; onChange: (v: SearchField) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const current = SEARCH_FIELDS.find((f) => f.value === value)!;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
        {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {SEARCH_FIELDS.map((f) => (
            <button key={f.value} type="button" onClick={() => { onChange(f.value); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {f.label}{f.value === value && <span className="text-accent-text">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const options = [{ value: '', label: 'All', dot: 'bg-fg-muted' }, { value: 'active', label: 'Active', dot: STATUS_DOT['active']! }, { value: 'disabled', label: 'Inactive', dot: STATUS_DOT['disabled']! }];
  const current = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
        <span className={`h-2 w-2 rounded-full ${current.dot}`} /> {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-36 rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {options.map((o) => (
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

function HtmlCodeModal({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="HTML Code">
      <pre className="max-h-96 overflow-auto rounded-card border border-border bg-page p-3 text-tiny text-fg"><code>{code}</code></pre>
    </Modal>
  );
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null; userAgent: string | null }
function HistoryModal({ postbackId, onClose }: { postbackId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/postbacks/${postbackId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Postback History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

function RowActionMenu({ postback, onDeleted }: { postback: Postback; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const test = useMutation(() => api.post<{ success: boolean; statusCode?: number }>(`/api/postbacks/${postback.id}/test`, {}));
  const del = useMutation(() => api.del(`/api/postbacks/${postback.id}`));

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
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const item = (label: string, onClick: () => void, inert?: string) => (
    <button role="menuitem" title={inert} onClick={onClick} disabled={Boolean(inert)}
      className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-small hover:bg-accent-subtle disabled:cursor-not-allowed ${inert ? 'text-fg-muted' : 'text-fg'}`}>
      {label}
    </button>
  );

  const doTest = async () => {
    setOpen(false);
    const res = await test.run(undefined);
    if (res) setToast(res.success ? `Test fired successfully (HTTP ${res.statusCode ?? '—'}).` : 'Test fired but the endpoint returned an error.');
  };
  const doDelete = async () => {
    setOpen(false);
    if (!confirm('Delete this postback?')) return;
    if (await del.run(undefined)) onDeleted();
  };

  return (
    <>
      <button ref={btnRef} title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-44 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => { setOpen(false); nav(`/app/aff-postbacks/${postback.id}/edit`); })}
          {item(test.busy ? 'Testing…' : 'Test', doTest, postback.url ? undefined : 'This postback has no URL to test')}
          {item('Delete', doDelete)}
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal postbackId={postback.id} onClose={() => setHistoryOpen(false)} />}
      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-card border border-border bg-elevated px-4 py-3 text-small text-fg shadow-elevated">{toast}</div>,
        document.body,
      )}
    </>
  );
}

export default function PostbacksManage() {
  const { data, loading, error, refetch } = useQuery<Postback[]>('/api/postbacks');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');

  const [tab, setTab] = useState<'conversion' | 'event' | 'cpc'>('conversion');
  const [searchField, setSearchField] = useState<SearchField>('id');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [htmlCode, setHtmlCode] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) setTableActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'deliveryMethod', label: 'Delivery Method', options: Object.entries(DELIVERY_LABEL).map(([value, label]) => ({ value, label })) },
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);

  const tabbed = useMemo(() => (data ?? []).filter((p) => p.postbackType === tab), [data, tab]);
  const filtered = useMemo(() => {
    let rows = tabbed;
    if (status) rows = rows.filter((p) => p.status === status);
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      if (searchField === 'id') rows = rows.filter((p) => p.id.toLowerCase().includes(qq));
      else if (searchField === 'partner') rows = rows.filter((p) => (p.publisherName ?? '').toLowerCase().includes(qq));
      else rows = rows.filter((p) => (p.offerName ?? '').toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('deliveryMethod')) rows = rows.filter((p) => filters['deliveryMethod']!.includes(p.deliveryMethod));
    if (has('offer')) rows = rows.filter((p) => p.offerId && filters['offer']!.includes(p.offerId));
    if (has('partner')) rows = rows.filter((p) => p.publisherId && filters['partner']!.includes(p.publisherId));
    return rows;
  }, [tabbed, status, q, searchField, filters]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columnsByHeader: Record<string, Column<Postback>> = {
    ID: { header: 'ID', cell: (p) => <span className="font-mono text-tiny text-fg-secondary">{p.id.slice(0, 8)}</span> },
    Partner: { header: 'Partner', cell: (p) => (p.publisherName ? <Link to={`/app/publishers/${p.publisherId}`} className="text-accent-text hover:underline">{p.publisherName}</Link> : <span className="text-fg-muted">—</span>) },
    Offer: { header: 'Offer', cell: (p) => (p.offerName ? <Link to={`/app/offers/${p.offerId}`} className="text-accent-text hover:underline">{p.offerName}</Link> : <span className="text-fg-muted">—</span>) },
    Level: { header: 'Level', cell: (p) => SCOPE_LABEL[p.scope] },
    Status: {
      header: 'Status', cell: (p) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[p.status]}`} /> {STATUS_LABEL[p.status]}
        </span>
      ),
    },
    Method: { header: 'Method', cell: (p) => DELIVERY_LABEL[p.deliveryMethod] },
    Delay: { header: 'Delay', cell: (p) => p.delay ?? <span className="text-fg-muted">—</span> },
    'Postback URL': { header: 'Postback URL', cell: (p) => (p.url ? <span className="block max-w-[280px] truncate font-mono text-tiny">{p.url}</span> : <span className="text-fg-muted">—</span>) },
    'HTML Code': { header: 'HTML Code', cell: (p) => (p.htmlCode ? <button className="text-accent-text hover:underline" onClick={() => setHtmlCode(p.htmlCode)}>View</button> : <span className="text-fg-muted">—</span>) },
  };
  const actionsCol: Column<Postback> = { header: '', className: 'text-right', cell: (p) => <RowActionMenu postback={p} onDeleted={refetch} /> };
  const checkboxCol: Column<Postback> = { header: '', cell: () => <input type="checkbox" className="chk" /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<Postback> => Boolean(c && shownColumns.has(c.header)));
    return [checkboxCol, ...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, publishers, offers]);

  const exportRows = (format: 'csv' | 'json') => {
    const mapped = filtered.map((p) => ({
      id: p.id, partner: p.publisherName ?? '', offer: p.offerName ?? '', level: SCOPE_LABEL[p.scope],
      status: p.status, method: DELIVERY_LABEL[p.deliveryMethod], url: p.url ?? '', createdAt: p.createdAt,
    }));
    let blob: Blob;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json;charset=utf-8;' });
    } else {
      const headers = Object.keys(mapped[0] ?? {});
      const lines = [headers.join(','), ...mapped.map((row) => headers.map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','))];
      blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `postbacks-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Manage Postbacks" subtitle="Partners › Postbacks › Manage" />

      <div className="mb-4 flex items-center gap-6 border-b border-border">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => { setTab(key); setPage(1); }}
            className={`border-b-2 px-1 pb-3 text-small font-medium transition-colors ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/aff-postbacks/new" className="btn-primary">+ Postback</Link>
        <div className="flex flex-wrap items-center gap-2">
          <SearchFieldSelect value={searchField} onChange={setSearchField} />
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder={`Search by ${searchField}…`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <StatusFilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                onApply={(v) => { setFilters(v); setPage(1); }} onClose={() => setFilterOpen(false)} storageKey="postbacks" />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="relative group">
                  <button className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Export</button>
                  <div className="absolute right-full top-0 mr-1 hidden w-28 rounded-card border border-border bg-elevated py-1 shadow-elevated group-hover:block">
                    <button onClick={() => { setTableActionsOpen(false); exportRows('csv'); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                    <button onClick={() => { setTableActionsOpen(false); exportRows('json'); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">JSON</button>
                  </div>
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
        : !filtered.length ? <StateBlock>No postbacks match these filters.</StateBlock>
        : (
          <>
            <Table columns={displayedColumns} rows={paged} rowKey={(p) => p.id} />
            <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
              <span>{filtered.length} Total</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">‹</button>
                <span className="px-1 tabular-nums">{page} / {pageCount}</span>
                <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">›</button>
              </div>
            </div>
          </>
        )}

      {htmlCode !== null && <HtmlCodeModal code={htmlCode} onClose={() => setHtmlCode(null)} />}
      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
      {showApiRequest && <ApiRequestModal path="/api/postbacks" onClose={() => setShowApiRequest(false)} appliedFilters={{ status, search: q || undefined }} />}
    </>
  );
}
