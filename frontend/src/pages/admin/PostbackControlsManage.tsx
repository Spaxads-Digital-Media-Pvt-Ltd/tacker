/**
 * Advertisers › Postback Controls › Manage — verified item-by-item against the live reference.
 * Unlike a typical "Manage" page, this one is REAL enforcement, not just CRUD: active controls are
 * evaluated for every real conversion in recordConversion() (see
 * api-backend/src/lib/postback-controls/evaluate.ts) — creating a control here can actually
 * accept/reject/hold real incoming conversions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal } from '../../components/TableActionsKit';
import type { PostbackControl, Offer, Publisher, Advertiser } from '../../types';

const ALL_COLUMNS = ['ID', 'Name', 'Control Type', 'Target', 'Condition', 'Rules', 'Date Created', 'Date Modified'] as const;
const CONTROL_TYPE_LABEL: Record<string, string> = { accept: 'Accept', reject: 'Reject', hold: 'On Hold' };
const CONTROL_TYPE_DOT: Record<string, string> = { accept: 'bg-success', reject: 'bg-danger-text', hold: 'bg-warning' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'active', label: 'Active', dot: 'bg-success' },
  { value: 'inactive', label: 'Inactive', dot: 'bg-warning' },
] as const;

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

function downloadExport(format: 'csv' | 'json', rows: PostbackControl[]) {
  const mapped = rows.map((c) => ({
    id: c.ref, name: c.name, status: c.status, controlType: c.controlType,
    targetType: c.targetType ?? '', condition: c.conditionLogic, rules: c.rules.length,
    createdAt: c.createdAt, modifiedAt: c.updatedAt,
  }));
  let blob: Blob;
  if (format === 'json') {
    blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json;charset=utf-8;' });
  } else {
    const headers = Object.keys(mapped[0] ?? { id: '', name: '', status: '', controlType: '', targetType: '', condition: '', rules: '', createdAt: '', modifiedAt: '' });
    const lines = [headers.join(',')];
    for (const row of mapped) lines.push(headers.map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
    blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `postback-controls-export-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ controlId, onClose }: { controlId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/postback-controls/${controlId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Postback Control History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

function RowMenu({ control, onChanged }: { control: PostbackControl; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/postback-controls/${control.id}`));
  const [historyOpen, setHistoryOpen] = useState(false);

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
    if (!confirm(`Delete postback control "${control.name}"?`)) return;
    if (await del.run(undefined)) onChanged();
  };

  const item = (label: string, onClick: () => void) => (
    <button role="menuitem" onClick={onClick} className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
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
          className="z-50 w-36 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => { setOpen(false); nav(`/app/adv-postback-controls/${control.id}/edit`); })}
          {item('Delete', doDelete)}
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal controlId={control.id} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

export default function PostbackControlsManage() {
  const [status, setStatus] = useState('active');
  const { data, loading, error, refetch } = useQuery<PostbackControl[]>(`/api/postback-controls?status=${status}`);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) { setTableActionsOpen(false); setExportOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const offerName = (id: string) => offers?.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  const advertiserName = (id: string) => advertisers?.find((a) => a.id === id)?.name ?? id.slice(0, 8);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('offer')) rows = rows.filter((c) => c.targetType === 'offer' && c.targetIds.some((id) => filters['offer']!.includes(id)));
    if (has('partner')) rows = rows.filter((c) => c.partnerIds.some((id) => filters['partner']!.includes(id)));
    return rows;
  }, [data, q, filters]);

  const targetCell = (c: PostbackControl) => {
    if (!c.targetType || c.targetIds.length === 0) return <span className="text-fg-muted">All</span>;
    const names = c.targetType === 'offer' ? c.targetIds.map(offerName) : c.targetIds.map(advertiserName);
    const label = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    return <span title={names.join(', ')}>{c.targetType === 'offer' ? 'Offer: ' : 'Advertiser: '}{label}</span>;
  };

  const columnsByHeader: Record<string, Column<PostbackControl>> = {
    ID: { header: 'ID', cell: (c) => <span className="tabular-nums text-fg-secondary">{c.ref}</span> },
    Name: { header: 'Name', cell: (c) => <Link to={`/app/adv-postback-controls/${c.id}/edit`} className="font-medium text-accent-text hover:underline">{c.name}</Link> },
    'Control Type': { header: 'Control Type', cell: (c) => <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${CONTROL_TYPE_DOT[c.controlType]}`} />{CONTROL_TYPE_LABEL[c.controlType]}</span> },
    Target: { header: 'Target', cell: targetCell },
    Condition: { header: 'Condition', cell: (c) => (c.conditionLogic === 'all' ? 'All Must Apply' : 'One Or More Must Apply') },
    Rules: {
      header: 'Rules', cell: (c) => (
        <span title={c.rules.map((r) => `${r.variable} ${r.operator} ${r.value}`).join('; ') || 'No rules — matches everything'}>
          {c.rules.length} rule{c.rules.length === 1 ? '' : 's'}
          {c.partnerIds.length > 0 && <span className="ml-1 text-fg-muted">· {c.partnerIds.length} partner{c.partnerIds.length === 1 ? '' : 's'}</span>}
        </span>
      ),
    },
    'Date Created': { header: 'Date Created', cell: (c) => new Date(c.createdAt).toLocaleString() },
    'Date Modified': { header: 'Date Modified', cell: (c) => new Date(c.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<PostbackControl> = { header: '', className: 'text-right', cell: (c) => <RowMenu control={c} onChanged={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<PostbackControl> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, filtered, offers, advertisers, publishers]);

  return (
    <>
      <PageHeader title="Manage Postback Controls" subtitle="Advertisers › Postback Controls › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/adv-postback-controls/new" className="btn-primary">+ Postback Control</Link>
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
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="postback-controls" />
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
                      <button onClick={() => { downloadExport('csv', filtered); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                      <button onClick={() => { downloadExport('json', filtered); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">JSON</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
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
            <Table columns={displayedColumns} rows={filtered} rowKey={(c) => c.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
          </>
        )}

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}
