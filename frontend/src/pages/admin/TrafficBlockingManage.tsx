/**
 * Partners › Traffic Blocking › Manage — verified item-by-item against the live reference. Each
 * rule flags a click for a Partner+Offer pair when a sub-placement (Sub1..Sub10) or Source ID
 * matches a filter (Exact Match/Contains/Begins With/Ends With/Does not match/Does not contain/Is
 * Empty). Sub6-10 exist on the rule but aren't shown as list columns by default, matching the
 * reference (available via Columns Customization).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, MenuPopover, MenuItem, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import type { TrafficBlocking, Publisher, Offer } from '../../types';

const STATUS_DOT: Record<string, string> = { active: 'bg-success', inactive: 'bg-fg-muted' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'active', label: 'Active', dot: STATUS_DOT['active']! },
  { value: 'inactive', label: 'Inactive', dot: STATUS_DOT['inactive']! },
] as const;
const ALL_COLUMNS = ['ID', 'Offer', 'Partner', 'Sub1', 'Sub2', 'Sub3', 'Sub4', 'Sub5', 'Source ID', 'Status', 'Created', 'Modified'] as const;

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

function RowMenu({ rule, onDeleted }: { rule: TrafficBlocking; onDeleted: () => void }) {
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/traffic-blocking/${rule.id}`));
  const doDelete = async () => {
    if (!confirm('Delete this traffic blocking rule?')) return;
    if (await del.run(undefined)) onDeleted();
  };
  return (
    <MenuPopover
      ariaLabel="Traffic blocking actions" align="end" width="w-36"
      triggerClassName="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
    >
      {({ close }) => (
        <>
          <MenuItem onSelect={() => { close(); nav(`/app/aff-traffic-blocking/${rule.id}/edit`); }}>Edit</MenuItem>
          <MenuItem tone="danger" onSelect={() => { close(); void doDelete(); }}>Delete</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

function BlockingTableActions({ rows, onColumns }: { rows: TrafficBlocking[]; onColumns: () => void }) {
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.id.slice(0, 8), Offer: r.offerName, Partner: r.publisherName, Status: r.status,
    Sub1: r.filterSummary.sub1 ?? '', Sub2: r.filterSummary.sub2 ?? '', Sub3: r.filterSummary.sub3 ?? '',
    Sub4: r.filterSummary.sub4 ?? '', Sub5: r.filterSummary.sub5 ?? '', 'Source ID': r.filterSummary.sourceId ?? '',
    Created: r.createdAt, Modified: r.updatedAt,
  }));
  return (
    <MenuPopover
      ariaLabel="Table Actions" align="end" width="w-56"
      triggerClassName="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
      onOpenChange={(o) => { if (!o) setSubOpen(false); }}
    >
      {({ close }) => (
        <>
          <div className="relative">
            <button type="button" onClick={() => setSubOpen((o) => !o)}
              className="flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-page">
              Export <ChevronRight size={13} className="text-fg-muted" />
            </button>
            {subOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <MenuItem onSelect={() => { downloadCsv('traffic-blockings.csv', exportRows()); close(); }}>CSV</MenuItem>
                <MenuItem onSelect={() => { void downloadXlsx('traffic-blockings.xlsx', exportRows()); close(); }}>Excel</MenuItem>
              </div>
            )}
          </div>
          <MenuItem onSelect={() => { close(); onColumns(); }}>Columns Customization</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

export default function TrafficBlockingManage() {
  const [status, setStatus] = useState('active');
  const { data, loading, error, refetch } = useQuery<TrafficBlocking[]>(`/api/traffic-blocking?status=${status}`);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((r) => r.offerName.toLowerCase().includes(qq) || r.publisherName.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('offer')) rows = rows.filter((r) => filters['offer']!.includes(r.offerId));
    if (has('partner')) rows = rows.filter((r) => filters['partner']!.includes(r.publisherId));
    return rows;
  }, [data, q, filters]);

  const sub = (r: TrafficBlocking, key: keyof TrafficBlocking['filterSummary']) => r.filterSummary[key] ?? <span className="text-fg-muted">-</span>;

  const columnsByHeader: Record<string, Column<TrafficBlocking>> = {
    ID: { header: 'ID', cell: (r) => <span className="text-fg-secondary">{r.id.slice(0, 8)}</span> },
    Offer: { header: 'Offer', cell: (r) => <Link to={`/app/offers/${r.offerId}`} className="text-accent-text hover:underline">{r.offerName}{r.offerRef ? ` (${r.offerRef})` : ''}</Link> },
    Partner: { header: 'Partner', cell: (r) => <Link to={`/app/publishers/${r.publisherId}`} className="text-accent-text hover:underline">{r.publisherName}{r.publisherRef ? ` (${r.publisherRef})` : ''}</Link> },
    Sub1: { header: 'Sub1', cell: (r) => sub(r, 'sub1') },
    Sub2: { header: 'Sub2', cell: (r) => sub(r, 'sub2') },
    Sub3: { header: 'Sub3', cell: (r) => sub(r, 'sub3') },
    Sub4: { header: 'Sub4', cell: (r) => sub(r, 'sub4') },
    Sub5: { header: 'Sub5', cell: (r) => sub(r, 'sub5') },
    'Source ID': { header: 'Source ID', cell: (r) => sub(r, 'sourceId') },
    Status: {
      header: 'Status', cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[r.status]}`} /> {r.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    Created: { header: 'Created', cell: (r) => new Date(r.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (r) => new Date(r.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<TrafficBlocking> = { header: '', className: 'text-right', cell: (r) => <RowMenu rule={r} onDeleted={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<TrafficBlocking> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns]);

  return (
    <>
      <PageHeader title="Manage Traffic Blockings" subtitle="Partners › Traffic Blocking › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/aff-traffic-blocking/new" className="btn-primary">+ Block New Source</Link>
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
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="traffic-blocking" />
            )}
          </div>
          <BlockingTableActions rows={filtered} onColumns={() => setShowColumns(true)} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No traffic blockings match these filters.</StateBlock>
        : (
          <>
            <Table columns={displayedColumns} rows={filtered} rowKey={(r) => r.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
          </>
        )}

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}
