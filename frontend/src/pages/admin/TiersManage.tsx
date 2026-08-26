/**
 * Partners › Tiers › Manage — verified item-by-item against the live reference. A tier groups
 * Partners under a shared payout margin and offer visibility. The "Default" column marks the
 * network's single default tier (set-default is exclusive — see the backend route). Status is
 * shown as a colored dot inline with the Name (the reference has no separate Status column).
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
import type { PartnerTier, PartnerTierMember, Publisher } from '../../types';

const STATUS_DOT: Record<string, string> = { active: 'bg-success', paused: 'bg-warning', deleted: 'bg-danger' };
const SEARCH_FIELDS = [{ value: 'name', label: 'Name' }, { value: 'partners', label: 'Partners' }] as const;
type SearchField = (typeof SEARCH_FIELDS)[number]['value'];
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'active', label: 'Active', dot: STATUS_DOT['active']! },
  { value: 'deleted', label: 'Deleted', dot: STATUS_DOT['deleted']! },
  { value: 'paused', label: 'Paused', dot: STATUS_DOT['paused']! },
] as const;

const ALL_COLUMNS = ['Default', 'ID', 'Name', 'Partners', 'Margin', 'Labels', 'Description', 'Created', 'Modified'] as const;

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

function AllPartnersModal({ tier, onClose }: { tier: PartnerTier; onClose: () => void }) {
  const { data, loading } = useQuery<PartnerTierMember[]>(`/api/partner-tiers/${tier.id}/members?status=all`);
  return (
    <Modal open onClose={onClose} title="Partners">
      {loading ? <StateBlock><Spinner /></StateBlock> : (
        <div className="max-h-96 space-y-1 overflow-auto">
          {!data || data.length === 0
            ? <p className="text-small text-fg-secondary">No partners in this tier.</p>
            : data.map((p) => (
              <div key={p.id} className="text-small">
                - <Link to={`/app/publishers/${p.id}`} className="text-accent-text hover:underline">{p.name}{p.ref ? ` (${p.ref})` : ''}</Link>
              </div>
            ))}
        </div>
      )}
    </Modal>
  );
}

function RowActionMenu({ tier, onChanged }: { tier: PartnerTier; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const setDefault = useMutation(() => api.post<{ id: string }>(`/api/partner-tiers/${tier.id}/set-default`, {}));

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

  const item = (label: string, onClick: () => void) => (
    <button role="menuitem" onClick={onClick} className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
      {label}
    </button>
  );

  const doSetDefault = async () => {
    setOpen(false);
    if (await setDefault.run(undefined)) onChanged();
  };

  return (
    <>
      <button ref={btnRef} title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-40 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => { setOpen(false); nav(`/app/aff-tiers/${tier.id}/edit`); })}
          {!tier.isDefault && item('Set Default', doSetDefault)}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function TiersManage() {
  const [status, setStatus] = useState('active');
  const { data, loading, error, refetch } = useQuery<PartnerTier[]>(`/api/partner-tiers?status=${status}`);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [searchField, setSearchField] = useState<SearchField>('name');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewAllTier, setViewAllTier] = useState<PartnerTier | null>(null);
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

  const allLabels = useMemo(() => Array.from(new Set((data ?? []).flatMap((t) => t.labels))), [data]);
  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'label', label: 'Label', options: allLabels.map((l) => ({ value: l, label: l })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [allLabels, publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      if (searchField === 'name') rows = rows.filter((t) => t.name.toLowerCase().includes(qq));
      else rows = rows.filter((t) => t.partners.some((p) => p.name.toLowerCase().includes(qq)));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('label')) rows = rows.filter((t) => t.labels.some((l) => filters['label']!.includes(l)));
    if (has('partner')) rows = rows.filter((t) => t.partners.some((p) => filters['partner']!.includes(p.id)));
    return rows;
  }, [data, q, searchField, filters]);

  const columnsByHeader: Record<string, Column<PartnerTier>> = {
    Default: { header: 'Default', cell: (t) => (t.isDefault ? <span className="grid h-5 w-5 place-items-center rounded-full bg-success text-white">✓</span> : null) },
    ID: { header: 'ID', cell: (t) => <span className="text-fg-secondary">{t.id.slice(0, 8)}</span> },
    Name: {
      header: 'Name', cell: (t) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[t.status]}`} />
          <Link to={`/app/aff-tiers/${t.id}`} className="text-accent-text hover:underline">{t.name}</Link>
        </span>
      ),
    },
    Partners: {
      header: 'Partners', cell: (t) => (
        t.partnersTotal === 0 ? <span className="text-fg-muted">-</span> : (
          <div className="space-y-0.5 text-tiny">
            {t.partners.map((p) => (
              <div key={p.id}>- <Link to={`/app/publishers/${p.id}`} className="text-accent-text hover:underline">{p.name}{p.ref ? ` (${p.ref})` : ''}</Link></div>
            ))}
            {t.partnersTotal > t.partners.length && (
              <button className="text-accent-text hover:underline" onClick={() => setViewAllTier(t)}>View all ({t.partnersTotal})</button>
            )}
          </div>
        )
      ),
    },
    Margin: { header: 'Margin', cell: (t) => `${t.marginPct}%` },
    Labels: {
      header: 'Labels', cell: (t) => (
        t.labels.length === 0 ? <span className="text-fg-muted">-</span> : <div className="text-tiny">{t.labels.map((l) => <div key={l}>- {l}</div>)}</div>
      ),
    },
    Description: { header: 'Description', cell: (t) => t.description ?? <span className="text-fg-muted">-</span> },
    Created: { header: 'Created', cell: (t) => new Date(t.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (t) => new Date(t.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<PartnerTier> = { header: '', className: 'text-right', cell: (t) => <RowActionMenu tier={t} onChanged={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<PartnerTier> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns]);

  return (
    <>
      <PageHeader title="Manage Tiers" subtitle="Partners › Tiers › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/aff-tiers/new" className="btn-primary">+ Tiers</Link>
        <div className="flex flex-wrap items-center gap-2">
          <SearchFieldSelect value={searchField} onChange={setSearchField} />
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder={`Search by ${searchField}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <StatusFilterSelect value={status} onChange={setStatus} />
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="tiers" />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                <button onClick={() => { setTableActionsOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No tiers match these filters.</StateBlock>
        : (
          <>
            <Table columns={displayedColumns} rows={filtered} rowKey={(t) => t.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary">
              <span>{filtered.length} Total</span>
            </div>
          </>
        )}

      {viewAllTier && <AllPartnersModal tier={viewAllTier} onClose={() => setViewAllTier(null)} />}
      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
      {showApiRequest && <ApiRequestModal path={`/api/partner-tiers?status=${status}`} onClose={() => setShowApiRequest(false)} appliedFilters={{ status, search: q || undefined }} />}
    </>
  );
}
