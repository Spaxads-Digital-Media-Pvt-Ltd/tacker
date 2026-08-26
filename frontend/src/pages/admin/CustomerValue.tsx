/**
 * Customer Value › Payout & Revenue Rules — Manage list, matched item-by-item against the live
 * reference's real list page: exact columns (incl. the 3 with a help-icon tooltip), Status filter,
 * Table Filters (categorized flyout, 7 real categories), and Table Actions (Columns Customization).
 * Real CRUD, and real enforcement: active rules are evaluated for every real approved conversion
 * in recordConversion() (see api-backend/src/lib/customer-value/evaluate.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown, HelpCircle, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, StateBlock, Spinner } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal } from '../../components/TableActionsKit';
import type { Offer, Publisher, Advertiser } from '../../types';

const ALL_COLUMNS = [
  'ID', 'Name', 'Conversion Event Grouping', 'Apply Rule To', 'Start Date', 'End Date',
  'Goal Cycle Duration', 'Goal', 'Outcome Frequency', 'Custom Payout', 'Custom Revenue',
] as const;
const PAGE_SIZE = 25;

interface Condition { dataPointId: string; conditionLogic: string; operator: string; value: string }
interface Rule {
  id: string; ref: number; name: string; status: string; conversionEventGrouping: string;
  applyOffersMode: string; applyOfferIds: string[];
  applyAdvertisersMode: string; applyAdvertiserIds: string[];
  applyPartnersMode: string; applyPartnerIds: string[];
  startDate: string | null; endDate: string | null;
  goalCycle: string; recurringDuration: string | null; continuousMode: string | null; continuousDays: number | null;
  setGoalConditions: boolean; conditions: Condition[];
  outcomeFrequency: string; payoutValue: string | null; revenueValue: string | null;
  createdAt: string; updatedAt: string;
}
interface DataPoint { id: string; name: string; dataType: 'text' | 'number'; parameterKey: string }

function HelpIcon({ text }: { text: string }) {
  return <span title={text}><HelpCircle size={13} className="text-fg-muted" /></span>;
}

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
        <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-card border border-border bg-elevated py-1 shadow-elevated">
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

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString() : '—';
}
function cycleDurationLabel(r: Rule): string {
  if (r.goalCycle === 'recurring') return r.recurringDuration ? r.recurringDuration.charAt(0).toUpperCase() + r.recurringDuration.slice(1) : '—';
  return 'Continuous';
}
function goalLabel(r: Rule, dataPoints: DataPoint[]): string {
  if (!r.setGoalConditions || r.conditions.length === 0) return 'No goal set';
  const names = r.conditions.map((c) => dataPoints.find((d) => d.id === c.dataPointId)?.name ?? '—');
  return names.join(', ');
}
function money(v: string | null): string {
  return v != null ? `$${Number(v).toFixed(2)}` : '—';
}

export default function CustomerValue() {
  const { data, loading, refetch } = useQuery<Rule[]>('/api/customer-value/rules?status=all');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: dataPoints } = useQuery<DataPoint[]>('/api/customer-value/data-points');
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/customer-value/rules/${id}`));

  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
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

  const offerName = (id: string) => offers?.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  const advertiserName = (id: string) => advertisers?.find((a) => a.id === id)?.name ?? id.slice(0, 8);
  const partnerName = (id: string) => publishers?.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'advertiser', label: 'Advertisers Rule Applies To', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'grouping', label: 'Conversion Events Grouping', options: [{ value: 'all_together', label: 'All Together' }, { value: 'separately_by', label: 'Separately By' }] },
    { key: 'dataPoint', label: 'Custom Data Points Used in Goal', options: (dataPoints ?? []).map((d) => ({ value: d.id, label: d.name })) },
    { key: 'cycleDuration', label: 'Goal Cycle Duration', options: [
      { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' }, { value: 'continuous', label: 'Continuous' },
    ] },
    { key: 'metricType', label: 'Metrics Used in Goal', options: [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }] },
    { key: 'offer', label: 'Offers Rule Applies To', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'partner', label: 'Partners Rule Applies To', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
  ], [advertisers, offers, publishers, dataPoints]);

  const filtered = useMemo(() => {
    let rows = (data ?? []).filter((r) => status === 'all' || r.status === status);
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('advertiser')) rows = rows.filter((r) => r.applyAdvertisersMode === 'specific' && r.applyAdvertiserIds.some((id) => filters['advertiser']!.includes(id)));
    if (has('offer')) rows = rows.filter((r) => r.applyOffersMode === 'specific' && r.applyOfferIds.some((id) => filters['offer']!.includes(id)));
    if (has('partner')) rows = rows.filter((r) => r.applyPartnersMode === 'specific' && r.applyPartnerIds.some((id) => filters['partner']!.includes(id)));
    if (has('grouping')) rows = rows.filter((r) => filters['grouping']!.includes(r.conversionEventGrouping));
    if (has('dataPoint')) rows = rows.filter((r) => r.conditions.some((c) => filters['dataPoint']!.includes(c.dataPointId)));
    if (has('cycleDuration')) rows = rows.filter((r) => filters['cycleDuration']!.includes(r.goalCycle === 'continuous' ? 'continuous' : (r.recurringDuration ?? '')));
    if (has('metricType')) rows = rows.filter((r) => r.conditions.some((c) => filters['metricType']!.includes(dataPoints?.find((d) => d.id === c.dataPointId)?.dataType ?? '')));
    return rows;
  }, [data, status, q, filters, dataPoints]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const dp = dataPoints ?? [];

  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const orderedShown = useMemo(() => columnOrder.filter((c) => shownColumns.has(c)), [columnOrder, shownColumns]);

  const cellFor = (header: string, r: Rule): React.ReactNode => {
    switch (header) {
      case 'ID': return <span className="tabular-nums text-fg-secondary">{r.ref}</span>;
      case 'Name': return <Link to={`/app/customer-value/${r.id}/edit`} className="font-medium text-accent-text hover:underline">{r.name}</Link>;
      case 'Conversion Event Grouping': return r.conversionEventGrouping === 'all_together' ? 'All Together' : 'Separately By';
      case 'Apply Rule To': {
        const advPart = r.applyAdvertisersMode === 'all' ? 'All Advertisers' : `${r.applyAdvertiserIds.length} Advertiser${r.applyAdvertiserIds.length === 1 ? '' : 's'}`;
        const offPart = r.applyOffersMode === 'all' ? 'All Offers' : `${r.applyOfferIds.length} Offer${r.applyOfferIds.length === 1 ? '' : 's'}`;
        const parPart = r.applyPartnersMode === 'all' ? 'All Partners' : `${r.applyPartnerIds.length} Partner${r.applyPartnerIds.length === 1 ? '' : 's'}`;
        const title = [
          r.applyAdvertisersMode === 'specific' ? r.applyAdvertiserIds.map(advertiserName).join(', ') : null,
          r.applyOffersMode === 'specific' ? r.applyOfferIds.map(offerName).join(', ') : null,
          r.applyPartnersMode === 'specific' ? r.applyPartnerIds.map(partnerName).join(', ') : null,
        ].filter(Boolean).join(' · ');
        return <span title={title || undefined}>{advPart} · {offPart} · {parPart}</span>;
      }
      case 'Start Date': return fmtDate(r.startDate);
      case 'End Date': return fmtDate(r.endDate);
      case 'Goal Cycle Duration': return cycleDurationLabel(r);
      case 'Goal': return goalLabel(r, dp);
      case 'Outcome Frequency': return r.outcomeFrequency === 'once_per_customer' ? 'Once per Customer' : 'Every Cycle';
      case 'Custom Payout': return money(r.payoutValue);
      case 'Custom Revenue': return money(r.revenueValue);
      default: return null;
    }
  };

  return (
    <>
      <PageHeader title="Manage Payout & Revenue Rules" subtitle="Customer Value › Payout & Revenue Rules"
        action={<Link to="/app/customer-value/new" className="btn-primary">+ Rule</Link>} />

      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-56 !pl-8" placeholder="Search by name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <StatusSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <div className="relative">
          <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
          {filterOpen && (
            <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
              onApply={(v) => { setFilters(v); setPage(1); }} onClose={() => setFilterOpen(false)} storageKey="customer-value-rules" />
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
            </div>
          )}
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock> : filtered.length === 0 ? (
        <StateBlock>No Record Found</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny text-fg-secondary">
              <tr>
                {orderedShown.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left">
                    <span className="inline-flex items-center gap-1.5">
                      {h}
                      {(h === 'Conversion Event Grouping' || h === 'Goal Cycle Duration' || h === 'Outcome Frequency') && (
                        <HelpIcon text={
                          h === 'Conversion Event Grouping' ? 'Group matching Conversion Events together, or evaluate them separately.'
                          : h === 'Goal Cycle Duration' ? 'How often the goal resets: a recurring window, or continuously over the customer\'s lifetime.'
                          : 'Whether the outcome fires once per customer, or every time the goal cycle is met.'
                        } />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  {orderedShown.map((h) => <td key={h} className="whitespace-nowrap px-3 py-2 text-fg">{cellFor(h, r)}</td>)}
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Link to={`/app/customer-value/${r.id}/edit`} title="Edit" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Pencil size={14} /></Link>
                      <button title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text"
                        onClick={async () => { if (confirm(`Delete rule "${r.name}"?`) && (await runDelete(r.id))) refetch(); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>

      {showColumns && (
        <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns}
          onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
      )}
    </>
  );
}
