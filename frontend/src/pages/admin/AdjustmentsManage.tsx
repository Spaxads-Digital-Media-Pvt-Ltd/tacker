/**
 * Partners › Adjustments › Manage — verified item-by-item against the live reference. Each row is
 * one manual override session on a Partner+Offer's real reported numbers for a date range;
 * metrics that were actually overridden render as struck-through original → adjusted, matching
 * the reference exactly. "Original" is a real aggregate of this app's clicks/conversions tables
 * (not fabricated) — see the backend route. Date range here follows this app's own established
 * From/To input convention (Reports.tsx) rather than the reference's calendar-preset widget.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal } from '../../components/TableActionsKit';
import type { ReportingAdjustment, Publisher, Offer, AdjustmentMetrics } from '../../types';

const ALL_COLUMNS = ['Partner', 'Offer', 'Advertiser', 'Total Clicks', 'Conversions', 'Payout', 'Revenue', 'Gross Sales', 'Impressions', 'Created', 'Modified', 'Last Modified By'] as const;

const money = (n: number) => `$${n.toFixed(2)}`;
const int = (n: number) => String(Math.round(n));

function MetricCell({ original, adjusted, format }: { original: number; adjusted: number; format: (n: number) => string }) {
  if (Math.abs(original - adjusted) < 0.0001) return <span>{format(original)}</span>;
  return (
    <span className="whitespace-nowrap">
      <s className="text-fg-muted">{format(original)}</s> <span className="text-accent-text">›</span> {format(adjusted)}
    </span>
  );
}

function RowMenu({ adj, onDeleted }: { adj: ReportingAdjustment; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/reporting-adjustments/${adj.id}`));

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
    if (!confirm('Delete this reporting adjustment?')) return;
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
          {item('Edit', () => { setOpen(false); nav(`/app/aff-adjustments/${adj.id}/edit`); })}
          {item('Delete', doDelete)}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function AdjustmentsManage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const path = dateFrom && dateTo ? `/api/reporting-adjustments?dateFrom=${dateFrom}&dateTo=${dateTo}` : '/api/reporting-adjustments';
  const { data, loading, error, refetch } = useQuery<ReportingAdjustment[]>(path);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
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
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [offers, publishers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((a) => a.publisherName.toLowerCase().includes(qq) || a.offerName.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('offer')) rows = rows.filter((a) => filters['offer']!.includes(a.offerId));
    if (has('partner')) rows = rows.filter((a) => filters['partner']!.includes(a.publisherId));
    return rows;
  }, [data, q, filters]);

  const metricCol = (label: string, key: keyof AdjustmentMetrics, format: (n: number) => string): Column<ReportingAdjustment> => ({
    header: label, cell: (a) => <MetricCell original={a.original[key]} adjusted={a.adjusted[key]} format={format} />,
  });

  const columnsByHeader: Record<string, Column<ReportingAdjustment>> = {
    Partner: { header: 'Partner', cell: (a) => <Link to={`/app/publishers/${a.publisherId}`} className="text-accent-text hover:underline">{a.publisherName}{a.publisherRef ? ` (${a.publisherRef})` : ''}</Link> },
    Offer: { header: 'Offer', cell: (a) => <Link to={`/app/offers/${a.offerId}`} className="text-accent-text hover:underline">{a.offerName}{a.offerRef ? ` (${a.offerRef})` : ''}</Link> },
    Advertiser: { header: 'Advertiser', cell: (a) => a.advertiserName ?? <span className="text-fg-muted">—</span> },
    'Total Clicks': metricCol('Total Clicks', 'totalClicks', int),
    Conversions: metricCol('Conversions', 'conversions', int),
    Payout: metricCol('Payout', 'payout', money),
    Revenue: metricCol('Revenue', 'revenue', money),
    'Gross Sales': metricCol('Gross Sales', 'grossSales', money),
    Impressions: metricCol('Impressions', 'impressions', int),
    Created: { header: 'Created', cell: (a) => new Date(a.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (a) => new Date(a.updatedAt).toLocaleString() },
    'Last Modified By': { header: 'Last Modified By', cell: (a) => a.lastModifiedByName ?? <span className="text-fg-muted">System</span> },
  };
  const actionsCol: Column<ReportingAdjustment> = { header: '', className: 'text-right', cell: (a) => <RowMenu adj={a} onDeleted={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<ReportingAdjustment> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns]);

  return (
    <>
      <PageHeader title="Manage Reporting Adjustments" subtitle="Partners › Adjustments › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/app/aff-adjustments/new" className="btn-primary">+ Adjustment</Link>
          <input type="date" className="input !w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="text-small text-fg-secondary">to</span>
          <input type="date" className="input !w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="reporting-adjustments" />
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
            <Table columns={displayedColumns} rows={filtered} rowKey={(a) => a.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
          </>
        )}

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}
