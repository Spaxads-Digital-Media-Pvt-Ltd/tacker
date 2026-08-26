/**
 * Advertisers › Tiered Commissions › Manage — verified item-by-item against the live reference
 * (Filters: Advertiser/Offer/Partner; Table Actions: Columns Customization + Show API Request only,
 * no Export here — confirmed against the reference, not assumed). Real enforcement, not just CRUD:
 * active commissions are evaluated for every real approved conversion in recordConversion() (see
 * api-backend/src/lib/tiered-commissions/evaluate.ts) — creating one can genuinely raise/lower a
 * real conversion's payout or revenue once a Partner crosses the configured volume threshold.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Table, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import type { TieredCommission, TieredCommissionSummaryRow, Offer, Publisher, Advertiser } from '../../types';

const ALL_COLUMNS = ['ID', 'Name', 'Offers', 'Partners', 'Advertisers', 'Event', 'Rules', 'Payout Setting', 'Revenue Setting', 'Start Date', 'End Date', 'Created', 'Modified'] as const;
const VARIABLE_LABEL: Record<string, string> = { conversion: 'Conversion', total_payout: 'Total Payout', total_revenue: 'Total Revenue' };
const trimNum = (v: string) => String(Number(v));
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

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ commissionId, onClose }: { commissionId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/tiered-commissions/${commissionId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Tiered Commission History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

function RowMenu({ commission, onChanged }: { commission: TieredCommission; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/tiered-commissions/${commission.id}`));
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
    if (!confirm(`Delete tiered commission "${commission.name}"?`)) return;
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
          {item('Edit', () => { setOpen(false); nav(`/app/adv-tiered-commissions/${commission.id}/edit`); })}
          {item('Delete', doDelete)}
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal commissionId={commission.id} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

interface SummaryRowWithCommission extends TieredCommissionSummaryRow { tieredCommissionId: string; tieredCommissionName: string }
const SUMMARY_ALL_COLUMNS = ['Tiered Commission', 'Partner', 'Offer', 'Conversions', 'Revenue', 'Payout'] as const;

function SummaryTab() {
  const { data: commissions, loading: commissionsLoading } = useQuery<TieredCommission[]>('/api/tiered-commissions?status=all');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [rows, setRows] = useState<SummaryRowWithCommission[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...SUMMARY_ALL_COLUMNS]);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) setTableActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  useEffect(() => {
    if (!commissions) return;
    let alive = true;
    setLoadingRows(true);
    Promise.all(commissions.map(async (c) => {
      const res = await api.get<TieredCommissionSummaryRow[]>(`/api/tiered-commissions/${c.id}/summary`).catch(() => []);
      return res.map((r) => ({ ...r, tieredCommissionId: c.id, tieredCommissionName: c.name }));
    })).then((all) => { if (alive) { setRows(all.flat()); setLoadingRows(false); } });
    return () => { alive = false; };
  }, [commissions]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      list = list.filter((r) => r.publisherName.toLowerCase().includes(qq) || r.offerName.toLowerCase().includes(qq) || r.tieredCommissionName.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('offer')) list = list.filter((r) => filters['offer']!.includes(r.offerId));
    if (has('partner')) list = list.filter((r) => filters['partner']!.includes(r.publisherId));
    return list;
  }, [rows, q, filters, offers, publishers]);

  const columnsByHeader: Record<string, Column<SummaryRowWithCommission>> = {
    'Tiered Commission': { header: 'Tiered Commission', cell: (r) => <Link to={`/app/adv-tiered-commissions/${r.tieredCommissionId}/edit`} className="text-accent-text hover:underline">{r.tieredCommissionName}</Link> },
    Partner: { header: 'Partner', cell: (r) => r.publisherName },
    Offer: { header: 'Offer', cell: (r) => r.offerName },
    Conversions: { header: 'Conversions', className: 'text-right', cell: (r) => r.conversions },
    Revenue: { header: 'Revenue', className: 'text-right', cell: (r) => `$${Number(r.revenue).toFixed(2)}` },
    Payout: { header: 'Payout', className: 'text-right', cell: (r) => `$${Number(r.payout).toFixed(2)}` },
  };
  const shownColumns = useMemo<Set<string>>(() => new Set(SUMMARY_ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(
    () => columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<SummaryRowWithCommission> => Boolean(c && shownColumns.has(c.header))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnOrder, shownColumns, filtered],
  );

  const loading = commissionsLoading || loadingRows;

  return (
    <div>
      <p className="mb-3 text-tiny text-fg-secondary">* Showing only combinations with reporting data.</p>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="relative">
          <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
          {filterOpen && (
            <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
              onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="tiered-commissions-summary" />
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
              <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              <button onClick={() => { setTableActionsOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
            </div>
          )}
        </div>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : !filtered.length ? <StateBlock>No Record Found</StateBlock>
        : <Table columns={displayedColumns} rows={filtered} rowKey={(r) => `${r.tieredCommissionId}-${r.publisherId}-${r.offerId}`} />}
      {showColumns && <ColumnsModal allColumns={SUMMARY_ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path="/api/tiered-commissions/:id/summary" appliedFilters={{ search: q || undefined }} />}
    </div>
  );
}

export default function TieredCommissionsManage() {
  const [tab, setTab] = useState('Tiered Commissions');
  const [status, setStatus] = useState('active');
  const { data, loading, error, refetch } = useQuery<TieredCommission[]>(`/api/tiered-commissions?status=${status}`);
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
  const [showApiRequest, setShowApiRequest] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) setTableActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const offerName = (id: string) => offers?.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  const advertiserName = (id: string) => advertisers?.find((a) => a.id === id)?.name ?? id.slice(0, 8);
  const publisherName = (id: string) => publishers?.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [advertisers, offers, publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('advertiser')) rows = rows.filter((c) => c.targetType === 'advertiser' && c.targetIds.some((id) => filters['advertiser']!.includes(id)));
    if (has('offer')) rows = rows.filter((c) => c.targetType === 'offer' && c.targetIds.some((id) => filters['offer']!.includes(id)));
    if (has('partner')) rows = rows.filter((c) => c.partnerIds.some((id) => filters['partner']!.includes(id)));
    return rows;
  }, [data, q, filters]);

  const targetNames = (c: TieredCommission) => (c.targetType === 'offer' ? c.targetIds.map(offerName) : c.targetIds.map(advertiserName));
  const settingCell = (enabled: boolean, action: string | null, value: string | null) => {
    if (!enabled || !action || value == null) return <span className="text-fg-muted">-</span>;
    const sign = action.startsWith('increase') ? '+' : '-';
    const unit = action.endsWith('pct') ? '%' : '';
    const prefix = action.endsWith('flat') ? '$' : '';
    return <span>{sign}{prefix}{trimNum(value)}{unit}</span>;
  };

  const columnsByHeader: Record<string, Column<TieredCommission>> = {
    ID: { header: 'ID', cell: (c) => <span className="tabular-nums text-fg-secondary">{c.ref}</span> },
    Name: { header: 'Name', cell: (c) => <Link to={`/app/adv-tiered-commissions/${c.id}/edit`} className="font-medium text-accent-text hover:underline">{c.name}</Link> },
    Offers: { header: 'Offers', cell: (c) => (c.targetType === 'offer' ? <span title={targetNames(c).join(', ')}>{targetNames(c).length}</span> : <span className="text-fg-muted">-</span>) },
    Partners: { header: 'Partners', cell: (c) => (c.partnerIds.length > 0 ? <span title={c.partnerIds.map(publisherName).join(', ')}>{c.partnerIds.length}</span> : <span className="text-fg-muted">All</span>) },
    Advertisers: { header: 'Advertisers', cell: (c) => (c.targetType === 'advertiser' ? <span title={targetNames(c).join(', ')}>{targetNames(c).length}</span> : <span className="text-fg-muted">-</span>) },
    Event: { header: 'Event', cell: (c) => Array.from(new Set(c.goals.map((g) => VARIABLE_LABEL[g.variable]))).join(', ') || <span className="text-fg-muted">-</span> },
    Rules: {
      header: 'Rules', cell: (c) => (
        <span title={c.goals.map((g) => `${VARIABLE_LABEL[g.variable]} >= ${g.minValue}${g.maxValue != null ? ` and < ${g.maxValue}` : ''}`).join('; ')}>
          {c.goals.length} rule{c.goals.length === 1 ? '' : 's'}
        </span>
      ),
    },
    'Payout Setting': { header: 'Payout Setting', cell: (c) => settingCell(c.payoutEnabled, c.payoutAction, c.payoutValue) },
    'Revenue Setting': { header: 'Revenue Setting', cell: (c) => settingCell(c.revenueEnabled, c.revenueAction, c.revenueValue) },
    'Start Date': { header: 'Start Date', cell: (c) => (c.effectiveStart ? new Date(c.effectiveStart).toLocaleDateString() : <span className="text-fg-muted">-</span>) },
    'End Date': { header: 'End Date', cell: (c) => (c.effectiveEnd ? new Date(c.effectiveEnd).toLocaleDateString() : <span className="text-fg-muted">-</span>) },
    Created: { header: 'Created', cell: (c) => new Date(c.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (c) => new Date(c.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<TieredCommission> = { header: '', className: 'text-right', cell: (c) => <RowMenu commission={c} onChanged={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<TieredCommission> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, filtered, offers, advertisers, publishers]);

  return (
    <>
      <PageHeader title="Manage Tiered Commissions" subtitle="Advertisers › Tiered Commissions › Manage" />
      <Tabs tabs={['Tiered Commissions', 'Summary']} active={tab} onChange={setTab} />

      {tab === 'Summary' ? <SummaryTab /> : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Link to="/app/adv-tiered-commissions/new" className="btn-primary">+ Tiered Commission</Link>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input className="input !w-56 !pl-8" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <StatusSelect value={status} onChange={setStatus} />
              <div className="relative">
                <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
                {filterOpen && (
                  <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                    onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="tiered-commissions" />
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
                <Table columns={displayedColumns} rows={filtered} rowKey={(c) => c.id} />
                <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
              </>
            )}

          {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
          {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/tiered-commissions?status=${status}`} appliedFilters={{ status, search: q || undefined }} />}
        </>
      )}
    </>
  );
}
