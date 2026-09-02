/**
 * Offers › Traffic Controls — matches the reference's real "Manage Traffic Controls" (verified live
 * at /offers/trafficcontrols): ID/Name/Offers/Advertisers/Partners/Control Type/Created/Modified
 * columns (each association column showing "- All" when unscoped, real names + "View all (N)"
 * otherwise), a real search + Active status filter + a Filter drawer (Control Type / Action / Offer
 * Scope / Partner Scope / Variable — client-side over the fetched list) + Table Actions (Export /
 * Columns Customization / Show API Request) toolbar, a per-row kebab (Edit/Set as Deleted/History —
 * History opens a modal, not a page), and — matching the reference exactly — "+ Traffic Control"
 * navigates to a real dedicated page rather than a modal.
 *
 * These rules are genuinely enforced at /click by the tracking surface (traffic-controls-eval.ts);
 * the CRUD routes bust the cached OfferConfig on write so a new rule takes effect immediately.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, TableScroll, MenuPopover, MenuItem, type Column, Table } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { SearchFilterDrawer, FieldBlock } from '../../components/SearchFilterDrawer';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { api } from '../../lib/api';
import { fmtDateTime, type TrafficControl } from '../../data/trafficControls';
import type { Advertiser, Offer, Publisher } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive', 'deleted'] as const;
const ALL_COLUMNS = ['Name', 'Offers', 'Advertisers', 'Partners', 'Control Type', 'Created', 'Modified'] as const;
const SCOPE_LABEL: Record<string, string> = { all: 'All', offers: 'Specific offers', advertisers: 'Specific advertisers', specific: 'Specific partners' };
const ACTION_LABEL: Record<string, string> = { block: 'Block', fail_traffic: 'Fail Traffic' };

function DateTimeCell({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return <><div>{date}</div><div className="text-tiny text-fg-secondary">{time}</div></>;
}

/** `showAll` renders "- All" (this association is unscoped, matching the reference's own "- All"
 * cell); otherwise a plain "—" when there's nothing to show for this column on this row. */
function AssocCell({ ids, names, showAll }: { ids: string[]; names: (id: string) => string; showAll: boolean }) {
  if (showAll) return <span className="text-fg-secondary">- All</span>;
  if (ids.length === 0) return <span className="text-fg-muted">—</span>;
  return (
    <div className="space-y-0.5">
      {ids.slice(0, 2).map((id) => <p key={id} className="text-tiny text-fg">- {names(id)}</p>)}
      {ids.length > 2 && <p className="text-tiny text-fg-secondary">View all ({ids.length})</p>}
    </div>
  );
}

function TableActionsMenu({
  rows, order, hidden, onApply, appliedFilters,
}: {
  rows: TrafficControl[]; order: string[]; hidden: Set<string>;
  onApply: (o: string[], h: Set<string>) => void; appliedFilters: Record<string, string | undefined>;
}) {
  const [subOpen, setSubOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.ref, Name: r.name, 'Control Type': r.controlType, Action: ACTION_LABEL[r.action] ?? r.action, Status: r.status,
    'Offer Scope': r.offerScope, 'Partner Scope': r.partnerScope,
    Variables: r.variables.join(' | '), 'Comparison Method': r.comparisonMethod ?? '', Values: r.values.join(' | '),
    Created: r.createdAt, Modified: r.updatedAt,
  }));
  return (
    <>
      <MenuPopover
        ariaLabel="Table Actions" align="end" width="w-52"
        triggerClassName="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"
        button={<MoreVertical size={15} />}
        onOpenChange={(o) => { if (!o) setSubOpen(false); }}
      >
        {({ close }) => (
          <>
            <p className="px-3 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <div className="relative">
              <button type="button" onClick={() => setSubOpen((o) => !o)}
                className="flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-page">
                Export <ChevronRight size={13} className="text-fg-muted" />
              </button>
              {subOpen && (
                <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                  <MenuItem onSelect={() => { downloadCsv('traffic-controls.csv', exportRows()); close(); }}>CSV</MenuItem>
                  <MenuItem onSelect={() => { void downloadXlsx('traffic-controls.xlsx', exportRows()); close(); }}>Excel</MenuItem>
                </div>
              )}
            </div>
            <MenuItem onSelect={() => { close(); setColumnsOpen(true); }}>Columns Customization</MenuItem>
            <MenuItem onSelect={() => { close(); setApiOpen(true); }}>Show API Request</MenuItem>
          </>
        )}
      </MenuPopover>
      {columnsOpen && <ColumnsModal allColumns={ALL_COLUMNS} order={order} hidden={hidden} onClose={() => setColumnsOpen(false)} onApply={onApply} />}
      {apiOpen && <ApiRequestModal onClose={() => setApiOpen(false)} path="/api/traffic-controls" appliedFilters={appliedFilters} />}
    </>
  );
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }

function HistoryModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/traffic-controls/${id}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-4xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">History</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
          : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
      </div>
    </div>
  );
}

function RowMenu({ onEdit, onSetDeleted, onHistory }: { onEdit: () => void; onSetDeleted: () => void; onHistory: () => void }) {
  return (
    <MenuPopover
      ariaLabel="Traffic control actions" align="end" width="w-40"
      triggerClassName="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
    >
      {({ close }) => (
        <>
          <MenuItem onSelect={() => { close(); onEdit(); }}>Edit</MenuItem>
          <MenuItem tone="danger" onSelect={() => { close(); onSetDeleted(); }}>Set as Deleted</MenuItem>
          <MenuItem onSelect={() => { close(); onHistory(); }}>History</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

export default function OfferTrafficControls() {
  const { data, loading, error, refetch } = useQuery<TrafficControl[]>('/api/traffic-controls');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [historyId, setHistoryId] = useState<string | null>(null);
  const setStatusMutation = useMutation(({ id, status: s }: { id: string; status: string }) => api.patch(`/api/traffic-controls/${id}`, { status: s }));

  const offerName = (id: string) => { const o = offers?.find((x) => x.id === id); return o ? (o.ref != null ? `${o.name} (${o.ref})` : o.name) : id.slice(0, 8) + '…'; };
  const advertiserName = (id: string) => { const a = advertisers?.find((x) => x.id === id); return a ? (a.ref != null ? `${a.name} (${a.ref})` : a.name) : id.slice(0, 8) + '…'; };
  const partnerName = (id: string) => { const p = publishers?.find((x) => x.id === id); return p ? (p.ref != null ? `${p.name} (${p.ref})` : p.name) : id.slice(0, 8) + '…'; };

  // ── Filter drawer (client-side over the fetched list — same pattern as Manage Offers / Smart
  //    Links / Offer Groups / Creatives). Status + Search stay as toolbar quick-filters. ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fType, setFType] = useState('');
  const [fAction, setFAction] = useState('');
  const [fOfferScope, setFOfferScope] = useState('');
  const [fPartnerScope, setFPartnerScope] = useState('');
  const [fVariable, setFVariable] = useState('');
  const [dType, setDType] = useState('');
  const [dAction, setDAction] = useState('');
  const [dOfferScope, setDOfferScope] = useState('');
  const [dPartnerScope, setDPartnerScope] = useState('');
  const [dVariable, setDVariable] = useState('');

  const variableOptions = useMemo(
    () => Array.from(new Set((data ?? []).flatMap((r) => r.variables))).sort(),
    [data],
  );

  const openDrawer = () => {
    setDType(fType); setDAction(fAction); setDOfferScope(fOfferScope); setDPartnerScope(fPartnerScope); setDVariable(fVariable);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setFType(dType); setFAction(dAction); setFOfferScope(dOfferScope); setFPartnerScope(dPartnerScope); setFVariable(dVariable);
    setDrawerOpen(false); setPage(1);
  };
  const clearDraft = () => { setDType(''); setDAction(''); setDOfferScope(''); setDPartnerScope(''); setDVariable(''); };

  const appliedFilterCount = [fType, fAction, fOfferScope, fPartnerScope, fVariable].filter(Boolean).length;
  const draftFilterCount = [dType, dAction, dOfferScope, dPartnerScope, dVariable].filter(Boolean).length;

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (fType) out = out.filter((r) => r.controlType === fType);
    if (fAction) out = out.filter((r) => r.action === fAction);
    if (fOfferScope) out = out.filter((r) => r.offerScope === fOfferScope);
    if (fPartnerScope) out = out.filter((r) => r.partnerScope === fPartnerScope);
    if (fVariable) out = out.filter((r) => r.variables.includes(fVariable));
    return out;
  }, [data, status, q, fType, fAction, fOfferScope, fPartnerScope, fVariable]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showCol = (c: string) => !hiddenColumns.has(c);

  const appliedFilters: Record<string, string | undefined> = {
    Status: status !== 'all' ? status : undefined,
    Search: q.trim() || undefined,
    'Control Type': fType || undefined,
    Action: fAction ? (ACTION_LABEL[fAction] ?? fAction) : undefined,
    'Offer Scope': fOfferScope ? (SCOPE_LABEL[fOfferScope] ?? fOfferScope) : undefined,
    'Partner Scope': fPartnerScope ? (SCOPE_LABEL[fPartnerScope] ?? fPartnerScope) : undefined,
    Variable: fVariable || undefined,
  };

  const cellFor = (c: string, r: TrafficControl) => {
    switch (c) {
      case 'Name': return r.name;
      case 'Offers': return <AssocCell showAll={r.offerScope === 'all'} ids={r.offerScope === 'offers' ? r.offerIds : []} names={offerName} />;
      case 'Advertisers': return <AssocCell showAll={false} ids={r.offerScope === 'advertisers' ? r.advertiserIds : []} names={advertiserName} />;
      case 'Partners': return <AssocCell showAll={r.partnerScope === 'all'} ids={r.partnerIds} names={partnerName} />;
      case 'Control Type': return <span className="capitalize">{r.controlType}</span>;
      case 'Created': return <DateTimeCell iso={r.createdAt} />;
      case 'Modified': return <DateTimeCell iso={r.updatedAt} />;
      default: return null;
    }
  };

  return (
    <>
      <PageHeader title="Manage Traffic Controls" subtitle="Offers › Traffic Controls › Manage" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-primary" onClick={() => nav('/app/offers-traffic-controls/add')}><Plus size={15} /> Traffic Control</button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-56 !pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="input !w-auto">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button type="button" className="btn-ghost relative" onClick={openDrawer}>
            <SlidersHorizontal size={15} /> Filters
            {appliedFilterCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-tiny font-bold text-white">{appliedFilterCount}</span>
            )}
          </button>
          <TableActionsMenu rows={rows} order={columnOrder} hidden={hiddenColumns} appliedFilters={appliedFilters}
            onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No traffic controls yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No traffic controls match your filters.</StateBlock>
        : (
          <>
            <TableScroll>
              <table className="w-full min-w-[1100px] text-left text-body">
                <thead className="sticky top-0 z-20 border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">ID</th>
                    {columnOrder.filter(showCol).map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                      {columnOrder.filter(showCol).map((c) => (
                        <td key={c} className={`px-4 py-3 ${c === 'Created' || c === 'Modified' ? 'whitespace-nowrap' : ''} text-small`}>
                          {c === 'Name' ? (
                            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${r.status === 'active' ? 'bg-success' : r.status === 'inactive' ? 'bg-warning' : 'bg-danger'}`} />{r.name}</span>
                          ) : cellFor(c, r)}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowMenu onEdit={() => nav(`/app/offers-traffic-controls/${r.id}/edit`)}
                            onSetDeleted={async () => { await setStatusMutation.run({ id: r.id, status: 'deleted' }); refetch(); }}
                            onHistory={() => setHistoryId(r.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <div className="mt-3 flex justify-end">
              <Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          </>
        )}

      {historyId && <HistoryModal id={historyId} onClose={() => setHistoryId(null)} />}

      {drawerOpen && (
        <SearchFilterDrawer appliedCount={draftFilterCount} onClose={() => setDrawerOpen(false)} onApply={applyDrawer}>
          <div className="mb-3 flex justify-end">
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearDraft}>Clear</button>
          </div>
          <p className="mb-3 text-[11px] text-fg-muted">Status and Search stay in the toolbar as quick filters — this panel narrows the list further.</p>

          <FieldBlock label="Control Type">
            <select className="input" value={dType} onChange={(e) => setDType(e.target.value)}>
              <option value="">Any</option>
              <option value="blacklist">Blacklist</option>
              <option value="whitelist">Whitelist</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Action">
            <select className="input" value={dAction} onChange={(e) => setDAction(e.target.value)}>
              <option value="">Any</option>
              <option value="block">Block — divert the click</option>
              <option value="fail_traffic">Fail Traffic — let it through, flag it</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Offer Scope">
            <select className="input" value={dOfferScope} onChange={(e) => setDOfferScope(e.target.value)}>
              <option value="">Any</option>
              <option value="all">All offers</option>
              <option value="offers">Specific offers</option>
              <option value="advertisers">Specific advertisers</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Partner Scope">
            <select className="input" value={dPartnerScope} onChange={(e) => setDPartnerScope(e.target.value)}>
              <option value="">Any</option>
              <option value="all">All partners</option>
              <option value="specific">Specific partners</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Variable">
            <select className="input" value={dVariable} onChange={(e) => setDVariable(e.target.value)}>
              <option value="">Any variable</option>
              {variableOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">Rules that check this click field (sub1…user_agent).</p>
          </FieldBlock>
        </SearchFilterDrawer>
      )}
    </>
  );
}
