/**
 * Partners › Coupon Codes › Manage — verified item-by-item against the live reference. Coupons
 * live in the same offer_coupons table the per-offer Coupons tab manages, so History here shows a
 * shared trail across both surfaces. The reference's "Paused" status maps onto this table's
 * existing 'disabled' value (no new DB status needed — see the backend route's comment). The link
 * icon copies a real tracking link for the coupon's offer+partner (reusing the same trackBase
 * pattern as the Dashboard's Tracking Link Generator) — disabled when no partner is set, since a
 * tracking link needs one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, Link2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal } from '../../components/TableActionsKit';
import type { CouponCode, Publisher, Offer, TrackingDomain } from '../../types';

const STATUS_DOT: Record<string, string> = { active: 'bg-success', expired: 'bg-fg-muted', disabled: 'bg-warning' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', expired: 'Expired', disabled: 'Paused' };
const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'active', label: 'Active', dot: STATUS_DOT['active']! },
  { value: 'paused', label: 'Paused', dot: STATUS_DOT['disabled']! },
] as const;
const ALL_COLUMNS = ['ID', 'Coupon Code', 'Partner', 'Offer', 'Start Date', 'End Date', 'Description', 'Created', 'Modified'] as const;

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
        <span className={`h-2 w-2 rounded-full ${current.dot}`} /> {current.label}
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

function DescriptionModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Description">
      <p className="text-small text-fg">{text}</p>
    </Modal>
  );
}

function RowMenu({ coupon, onDeleted }: { coupon: CouponCode; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/coupon-codes/${coupon.id}`));
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
    if (!confirm(`Delete coupon code "${coupon.code}"?`)) return;
    if (await del.run(undefined)) onDeleted();
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
          {item('Edit', () => { setOpen(false); nav(`/app/aff-coupons/${coupon.id}/edit`); })}
          {item('Delete', doDelete)}
          {item('History', () => { setOpen(false); setHistoryOpen(true); })}
        </div>,
        document.body,
      )}
      {historyOpen && <HistoryModal couponId={coupon.id} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ couponId, onClose }: { couponId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/coupon-codes/${couponId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Coupon Code History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

export default function CouponCodesManage() {
  const [status, setStatus] = useState('active');
  const { data, loading, error, refetch } = useQuery<CouponCode[]>(`/api/coupon-codes?status=${status}`);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [descText, setDescText] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) setTableActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((c) => c.code.toLowerCase().includes(qq) || c.offerName.toLowerCase().includes(qq) || (c.publisherName ?? '').toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('offer')) rows = rows.filter((c) => filters['offer']!.includes(c.offerId));
    if (has('partner')) rows = rows.filter((c) => c.publisherId && filters['partner']!.includes(c.publisherId));
    return rows;
  }, [data, q, filters]);

  const activeDomains = (domains ?? []).filter((d) => d.status === 'active');
  const primaryDomain = activeDomains.find((d) => d.isPrimary) ?? activeDomains[0];
  const copyTrackingLink = async (c: CouponCode) => {
    if (!c.publisherId) return;
    const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    const trackBase = isLocal ? 'http://localhost:4002' : `https://${primaryDomain?.host ?? 'your-tracking-domain.com'}`;
    const url = `${trackBase}/click?${new URLSearchParams({ offer_id: c.offerId, pub_id: c.publisherId, coupon: c.code }).toString()}`;
    await navigator.clipboard.writeText(url).catch(() => {});
  };

  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelected((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id))));

  const bulkUpdateStatus = async (nextStatus: 'active' | 'expired' | 'disabled') => {
    setTableActionsOpen(false);
    setBulkBusy(true);
    try {
      const token = JSON.parse(localStorage.getItem('tracker.session.v2') ?? '{}').token;
      await fetch('/api/coupon-codes/bulk', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: Array.from(selected), status: nextStatus }),
      });
      setSelected(new Set());
      refetch();
    } finally {
      setBulkBusy(false);
    }
  };

  const columnsByHeader: Record<string, Column<CouponCode>> = {
    ID: { header: 'ID', cell: (c) => <span className="text-fg-secondary">{c.id.slice(0, 8)}</span> },
    'Coupon Code': {
      header: 'Coupon Code', cell: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <span title={STATUS_LABEL[c.status]} className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`} />
          <Link to={`/app/aff-coupons/${c.id}/edit`} className="text-accent-text hover:underline">{c.code}</Link>
        </span>
      ),
    },
    Partner: { header: 'Partner', cell: (c) => (c.publisherId ? <Link to={`/app/publishers/${c.publisherId}`} className="text-accent-text hover:underline">{c.publisherName}{c.publisherRef ? ` (${c.publisherRef})` : ''}</Link> : <span className="text-fg-muted">-</span>) },
    Offer: { header: 'Offer', cell: (c) => <Link to={`/app/offers/${c.offerId}`} className="text-accent-text hover:underline">{c.offerName}{c.offerRef ? ` (${c.offerRef})` : ''}</Link> },
    'Start Date': { header: 'Start Date', cell: (c) => (c.startsAt ? new Date(c.startsAt).toLocaleDateString() : <span className="text-fg-muted">-</span>) },
    'End Date': { header: 'End Date', cell: (c) => (c.endsAt ? new Date(c.endsAt).toLocaleDateString() : <span className="text-fg-muted">-</span>) },
    Description: { header: 'Description', cell: (c) => (c.description ? <button className="text-accent-text hover:underline" onClick={() => setDescText(c.description)}>View</button> : <span className="text-fg-muted">-</span>) },
    Created: { header: 'Created', cell: (c) => new Date(c.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (c) => new Date(c.updatedAt).toLocaleString() },
  };
  const checkboxCol: Column<CouponCode> = {
    header: '',
    cell: (c) => <input type="checkbox" className="chk" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />,
  };
  const linkCol: Column<CouponCode> = {
    header: '', cell: (c) => (
      <button type="button" title={c.publisherId ? 'Copy Tracking Link' : 'Set a Partner to copy a tracking link'} disabled={!c.publisherId}
        onClick={() => copyTrackingLink(c)}
        className="grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-30">
        <Link2 size={14} />
      </button>
    ),
  };
  const actionsCol: Column<CouponCode> = { header: '', className: 'text-right', cell: (c) => <RowMenu coupon={c} onDeleted={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<CouponCode> => Boolean(c && shownColumns.has(c.header)));
    return [checkboxCol, ...ordered, linkCol, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, selected, filtered]);

  return (
    <>
      <PageHeader title="Manage Coupon Codes" subtitle="Partners › Coupon Codes › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to="/app/aff-coupons/new" className="btn-primary">+ Coupon Code</Link>
          <Link to="/app/aff-coupons/import" className="btn-ghost">Bulk Add</Link>
        </div>
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
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="coupon-codes" />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <button disabled={selected.size === 0 || bulkBusy} onClick={() => bulkUpdateStatus('active')}
                  className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
                  Bulk Update Coupon Codes → Active {selected.size > 0 ? `(${selected.size})` : ''}
                </button>
                <button disabled={selected.size === 0 || bulkBusy} onClick={() => bulkUpdateStatus('disabled')}
                  className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
                  Bulk Update Coupon Codes → Paused {selected.size > 0 ? `(${selected.size})` : ''}
                </button>
                <div className="my-1 border-t border-border" />
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
            <div className="mt-3 flex items-center justify-between text-tiny text-fg-secondary">
              <button type="button" onClick={toggleSelectAll} className="text-accent-text hover:underline">
                {selected.size === filtered.length ? 'Deselect all' : `Select all ${filtered.length}`}
              </button>
              <span>{selected.size > 0 ? `${selected.size} selected · ` : ''}{filtered.length} Total</span>
            </div>
          </>
        )}

      {descText !== null && <DescriptionModal text={descText} onClose={() => setDescText(null)} />}
      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}
