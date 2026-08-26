/**
 * Manage Advertisers — verified against the live reference: Existing/Pending/Unverified tabs,
 * search + status filter + Filters flyout (Account Manager/Sales Manager/Billing Frequency/Label),
 * Table Actions (Bulk Edit/Export/Columns Customization/Show API Request — see
 * AdvertisersTableActions.tsx), and a row menu (Edit/Impersonate/History/Delete). Impersonate mints
 * a real Supabase magic-link for the advertiser's OWN linked portal account, mirroring the same
 * pattern already shipped for Partners.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { TableActionsMenu } from './AdvertisersTableActions';
import type { Advertiser, DashboardUser } from '../../types';

interface Tag { id: string; name: string; color: string | null; createdAt: string }
interface TagAssignment { tagId: string; entityId: string }
interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }

const STATUS_OPTS = ['active', 'pending', 'inactive'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', pending: 'Pending', inactive: 'Inactive' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', inactive: 'bg-fg-muted' };
const BILLING_FREQUENCIES = ['Weekly', 'Bimonthly', 'Monthly'];
const PAGE_SIZE = 12;

const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

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

function StatusFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const options = [{ value: '', label: 'All', dot: 'bg-fg-muted' }, ...STATUS_OPTS.map((s) => ({ value: s, label: STATUS_LABEL[s], dot: STATUS_DOT[s] }))];
  const current = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
        <span className={`h-2 w-2 rounded-full ${current.dot}`} /> {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-40 rounded-card border border-border bg-elevated py-1 shadow-elevated">
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

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ advertiserId, onClose }: { advertiserId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/advertisers/${advertiserId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Advertiser History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

function RowActionMenu({ advertiser, onChanged }: { advertiser: Advertiser; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const impersonate = useMutation(() => api.post<{ link: string }>(`/api/advertisers/${advertiser.id}/impersonate`, {}));
  const del = useMutation(() => api.del(`/api/advertisers/${advertiser.id}`));
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

  const go = (to: string) => { setOpen(false); nav(to); };
  const doImpersonate = async () => {
    setOpen(false);
    const res = await impersonate.run(undefined);
    if (res) window.open(res.link, '_blank', 'noopener');
  };
  const doDelete = async () => {
    setOpen(false);
    if (!confirm(`Delete advertiser "${advertiser.name}"?`)) return;
    if (await del.run(undefined)) onChanged();
  };

  const item = (label: string, onClick: () => void, inert?: string) => (
    <button role="menuitem" title={inert} onClick={onClick} disabled={Boolean(inert)}
      className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-small hover:bg-accent-subtle disabled:cursor-not-allowed ${inert ? 'text-fg-muted' : 'text-fg'}`}>
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
          className="z-50 w-52 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => go(`/app/advertisers/${advertiser.id}/edit`))}
          {item(impersonate.busy ? 'Impersonating…' : 'Impersonate', doImpersonate,
            advertiser.hasPortalAccount ? undefined : 'This advertiser has no linked portal account yet')}
          {item('View Advertiser Report', () => go(`/app/reports/advertiser?advertiserId=${advertiser.id}`))}
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
          {item('Delete', doDelete)}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal advertiserId={advertiser.id} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

type Tab = 'existing' | 'pending' | 'unverified';

export default function Advertisers() {
  const { data, loading, error, refetch } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const { data: tags } = useQuery<Tag[]>('/api/tags');
  const { data: tagAssignments } = useQuery<TagAssignment[]>('/api/tags/assignments?entityType=advertiser');
  const today = useQuery<AggResult>(`/api/reports?groupBy=advertiser&metrics=revenue&from=${encodeURIComponent(todayStartIso())}&to=${encodeURIComponent(new Date().toISOString())}`);

  const todayRevenueByAdv = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of today.data?.rows ?? []) {
      const id = r.dimensions['advertiser'];
      if (id) m.set(id, Number(r.metrics['revenue'] ?? 0));
    }
    return m;
  }, [today.data]);
  const tagIdsByAdv = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of tagAssignments ?? []) m.set(a.entityId, [...(m.get(a.entityId) ?? []), a.tagId]);
    return m;
  }, [tagAssignments]);
  const userName = (id: string | null | undefined) => users?.find((u) => u.id === id)?.name;

  const [tab, setTab] = useState<Tab>('existing');
  const [status, setStatus] = useState('');
  const [nameQ, setNameQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const tabbed = useMemo(() => {
    const rows = data ?? [];
    if (tab === 'pending') return rows.filter((a) => a.status === 'pending');
    if (tab === 'unverified') return rows.filter((a) => a.status !== 'pending' && !a.hasPortalAccount);
    return rows.filter((a) => a.status !== 'pending' && a.hasPortalAccount);
  }, [data, tab]);
  const pendingCount = useMemo(() => (data ?? []).filter((a) => a.status === 'pending').length, [data]);
  const unverifiedCount = useMemo(() => (data ?? []).filter((a) => a.status !== 'pending' && !a.hasPortalAccount).length, [data]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'accountManager', label: 'Account Manager', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'salesManager', label: 'Sales Manager', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'billingFrequency', label: 'Billing Frequency', options: BILLING_FREQUENCIES.map((v) => ({ value: v, label: v })) },
    { key: 'label', label: 'Label', options: (tags ?? []).map((t) => ({ value: t.id, label: t.name })) },
  ], [users, tags]);

  const filtered = useMemo(() => {
    let rows = tabbed;
    if (status) rows = rows.filter((a) => a.status === status);
    if (nameQ.trim()) {
      const q = nameQ.trim().toLowerCase();
      rows = rows.filter((a) => a.name.toLowerCase().includes(q));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('accountManager')) rows = rows.filter((a) => a.accountManagerId && filters['accountManager']!.includes(a.accountManagerId));
    if (has('salesManager')) rows = rows.filter((a) => a.salesManagerId && filters['salesManager']!.includes(a.salesManagerId));
    if (has('billingFrequency')) rows = rows.filter((a) => a.billingFrequency && filters['billingFrequency']!.includes(a.billingFrequency));
    if (has('label')) rows = rows.filter((a) => (tagIdsByAdv.get(a.id) ?? []).some((t) => filters['label']!.includes(t)));
    return rows;
  }, [tabbed, status, nameQ, filters, tagIdsByAdv]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allOnPageSelected = paged.length > 0 && paged.every((a) => selected.has(a.id));
  const toggleAllOnPage = () => setSelected((s) => {
    const next = new Set(s);
    if (allOnPageSelected) paged.forEach((a) => next.delete(a.id));
    else paged.forEach((a) => next.add(a.id));
    return next;
  });
  const toggleRow = (id: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const dash = <span className="text-fg-muted">—</span>;
  const nameCell = (a: Advertiser) => (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[a.status] ?? 'bg-fg-muted'}`} />
      <Link to={`/app/advertisers/${a.id}`} className="font-medium text-accent-text hover:underline">{a.name}{a.ref ? ` (${a.ref})` : ''}</Link>
    </span>
  );

  const checkboxCol: Column<Advertiser> = { header: '', cell: (a) => <input type="checkbox" className="chk" checked={selected.has(a.id)} onChange={() => toggleRow(a.id)} /> };
  const actionsCol: Column<Advertiser> = { header: '', className: 'text-right', cell: (a) => <RowActionMenu advertiser={a} onChanged={refetch} /> };

  const ALL_COLUMNS = ['ID', 'Name', 'Account Manager', 'Sales Manager', 'Labels', 'Verification Token', "Today's Revenue", 'Contact', 'Billing Terms', 'Currency', 'Created', 'Modified'] as const;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['Contact', 'Billing Terms', 'Currency']));
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);

  const columnsByHeader: Record<string, Column<Advertiser>> = {
    ID: { header: 'ID', cell: (a) => <span className="tabular-nums text-fg-secondary">{a.ref ?? '—'}</span> },
    Name: { header: 'Name', cell: nameCell },
    'Account Manager': { header: 'Account Manager', cell: (a) => userName(a.accountManagerId) ?? dash },
    'Sales Manager': { header: 'Sales Manager', cell: (a) => userName(a.salesManagerId) ?? dash },
    Labels: {
      header: 'Labels', cell: (a) => {
        const ids = tagIdsByAdv.get(a.id) ?? [];
        const names = ids.map((tid) => tags?.find((t) => t.id === tid)?.name).filter(Boolean);
        return names.length ? names.join(', ') : dash;
      },
    },
    'Verification Token': { header: 'Verification Token', cell: (a) => a.verificationToken ?? dash },
    "Today's Revenue": { header: "Today's Revenue", className: 'text-right', cell: (a) => money(todayRevenueByAdv.get(a.id)) },
    Contact: { header: 'Contact', cell: (a) => a.contactEmail ?? dash },
    'Billing Terms': { header: 'Billing Terms', cell: (a) => a.billingTerms ?? dash },
    Currency: { header: 'Currency', cell: (a) => a.defaultCurrency },
    Created: { header: 'Created', cell: (a) => new Date(a.createdAt).toLocaleDateString() },
    Modified: { header: 'Modified', cell: (a) => (a.updatedAt ? new Date(a.updatedAt).toLocaleDateString() : '—') },
  };

  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<Advertiser> => Boolean(c && shownColumns.has(c.header)));
    return [checkboxCol, ...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, selected, tagIdsByAdv, todayRevenueByAdv, users]);

  const exportRows = (format: 'csv' | 'json') => {
    const rows = selected.size > 0 ? filtered.filter((a) => selected.has(a.id)) : filtered;
    const mapped = rows.map((a) => ({
      id: a.ref ?? a.id, name: a.name, status: a.status, accountManager: userName(a.accountManagerId) ?? '',
      salesManager: userName(a.salesManagerId) ?? '', billingFrequency: a.billingFrequency ?? '',
      currency: a.defaultCurrency, contactEmail: a.contactEmail ?? '', createdAt: a.createdAt, modifiedAt: a.updatedAt ?? '',
    }));
    let blob: Blob;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json;charset=utf-8;' });
    } else {
      const headers = Object.keys(mapped[0] ?? {});
      const lines = [headers.join(',')];
      for (const row of mapped) lines.push(headers.map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
      blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `advertisers-export-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Manage Advertisers" subtitle="Advertisers › Manage" />

      <div className="mb-4 flex items-center gap-6 border-b border-border">
        {([['existing', 'Existing', 0], ['pending', 'Pending', pendingCount], ['unverified', 'Unverified', unverifiedCount]] as const).map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => { setTab(key); setPage(1); setSelected(new Set()); }}
            className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-small font-medium transition-colors ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {label}
            {count > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1.5 text-tiny font-bold text-surface">{count}</span>}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/advertisers/new" className="btn-primary">+ Advertiser</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={nameQ} onChange={(e) => { setNameQ(e.target.value); setPage(1); }} />
          </div>
          <StatusFilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                onApply={(v) => { setFilters(v); setPage(1); }} onClose={() => setFilterOpen(false)} storageKey="advertisers" />
            )}
          </div>
          <TableActionsMenu
            selectedIds={[...selected]}
            allColumns={ALL_COLUMNS}
            columnOrder={columnOrder}
            hiddenColumns={hiddenColumns}
            onApplyColumns={(order, hidden) => { setColumnOrder(order); setHiddenColumns(hidden); }}
            onExport={exportRows}
            appliedFilters={{ status: status || undefined, search: nameQ || undefined }}
          />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No advertisers match these filters.</StateBlock>
        : (
          <>
            <div className="mb-2 flex items-center gap-2 text-tiny text-fg-secondary">
              <input type="checkbox" className="chk" checked={allOnPageSelected} onChange={toggleAllOnPage} />
              {selected.size > 0 ? `${selected.size} selected` : 'Select all on page'}
            </div>
            <Table columns={displayedColumns} rows={paged} rowKey={(a) => a.id} />
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
    </>
  );
}
