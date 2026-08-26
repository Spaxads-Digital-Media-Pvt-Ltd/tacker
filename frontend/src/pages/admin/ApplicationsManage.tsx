/**
 * Partners › Offer Applications › Manage — verified item-by-item against the live reference. Two
 * tabs: "Offer Applications" (Approve/Reject on top of the existing offer_publisher_access grants)
 * and "Questionnaires" (a reusable field-set builder an Offer can require applicants to fill out).
 * Applications are self-service (a Partner requesting/being granted access) — there is no "+Add"
 * here, matching the reference; admins only decide.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import type { OfferApplication, QuestionnaireListItem, Publisher, Offer, Advertiser, DashboardUser } from '../../types';

const STATUS_DOT: Record<string, string> = { approved: 'bg-success', pending: 'bg-warning', rejected: 'bg-danger' };
const STATUS_LABEL: Record<string, string> = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected' };
const APP_STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-fg-muted' },
  { value: 'approved', label: 'Approved', dot: STATUS_DOT['approved']! },
  { value: 'pending', label: 'Pending', dot: STATUS_DOT['pending']! },
  { value: 'rejected', label: 'Rejected', dot: STATUS_DOT['rejected']! },
] as const;
const OFFER_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const APP_COLUMNS = ['Partner', 'Offer', 'Partner Manager', 'Status', 'Questionnaire', 'Request Date', 'Latest Update'] as const;
const Q_COLUMNS = ['ID', 'Name', 'Questions', 'Offers', 'Created', 'Modified'] as const;

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

function StatusSelect<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string; dot: string }[] }) {
  const { open, setOpen, ref } = useDropdown();
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

function AppRowMenu({ app, onChanged }: { app: OfferApplication; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const decide = useMutation((status: 'approved' | 'rejected') => api.patch<OfferApplication>(`/api/offer-applications/${app.id}`, { status }));

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

  const decideAndClose = async (status: 'approved' | 'rejected') => {
    setOpen(false);
    if (await decide.run(status)) onChanged();
  };

  const item = (label: string, onClick: () => void, disabled?: boolean) => (
    <button role="menuitem" onClick={onClick} disabled={disabled}
      className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
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
          {item('Approve', () => decideAndClose('approved'), app.status === 'approved')}
          {item('Reject', () => decideAndClose('rejected'), app.status === 'rejected')}
        </div>,
        document.body,
      )}
    </>
  );
}

function OfferApplicationsTab() {
  const [status, setStatus] = useState<'all' | 'approved' | 'pending' | 'rejected'>('pending');
  const { data, loading, error, refetch } = useQuery<OfferApplication[]>(`/api/offer-applications?status=${status}`);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: offerGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const { data: questionnaires } = useQuery<QuestionnaireListItem[]>('/api/questionnaires?status=all');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...APP_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) setTableActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const offerToAdvertiser = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.advertiserId])), [offers]);
  const offerToGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of offerGroups ?? []) for (const oid of g.offerIds) m.set(oid, [...(m.get(oid) ?? []), g.id]);
    return m;
  }, [offerGroups]);
  const offerToStatus = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.status])), [offers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'offerGroup', label: 'Offer Group', options: (offerGroups ?? []).map((g) => ({ value: g.id, label: g.name })) },
    { key: 'offerStatus', label: 'Offer Status', options: OFFER_STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'partnerManager', label: 'Partner Manager', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'questionnaire', label: 'Questionnaire', options: (questionnaires ?? []).map((qq) => ({ value: qq.id, label: qq.name })) },
  ], [advertisers, offers, offerGroups, publishers, users, questionnaires]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq2 = q.trim().toLowerCase();
      rows = rows.filter((a) => a.publisherName.toLowerCase().includes(qq2) || a.offerName.toLowerCase().includes(qq2));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('advertiser')) rows = rows.filter((a) => { const advId = offerToAdvertiser.get(a.offerId); return advId && filters['advertiser']!.includes(advId); });
    if (has('offer')) rows = rows.filter((a) => filters['offer']!.includes(a.offerId));
    if (has('offerGroup')) rows = rows.filter((a) => (offerToGroups.get(a.offerId) ?? []).some((g) => filters['offerGroup']!.includes(g)));
    if (has('offerStatus')) rows = rows.filter((a) => { const s = offerToStatus.get(a.offerId); return s && filters['offerStatus']!.includes(s); });
    if (has('partner')) rows = rows.filter((a) => filters['partner']!.includes(a.publisherId));
    if (has('partnerManager')) rows = rows.filter((a) => a.partnerManagerId && filters['partnerManager']!.includes(a.partnerManagerId));
    if (has('questionnaire')) rows = rows.filter((a) => a.questionnaireId && filters['questionnaire']!.includes(a.questionnaireId));
    return rows;
  }, [data, q, filters, offerToAdvertiser, offerToGroups, offerToStatus]);

  const columnsByHeader: Record<string, Column<OfferApplication>> = {
    Partner: { header: 'Partner', cell: (a) => <Link to={`/app/publishers/${a.publisherId}`} className="text-accent-text hover:underline">{a.publisherName}{a.publisherRef ? ` (${a.publisherRef})` : ''}</Link> },
    Offer: { header: 'Offer', cell: (a) => <Link to={`/app/offers/${a.offerId}`} className="text-accent-text hover:underline">{a.offerName}{a.offerRef ? ` (${a.offerRef})` : ''}</Link> },
    'Partner Manager': { header: 'Partner Manager', cell: (a) => a.partnerManagerName ?? <span className="text-fg-muted">—</span> },
    Status: {
      header: 'Status', cell: (a) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[a.status]}`} /> {STATUS_LABEL[a.status]}
        </span>
      ),
    },
    Questionnaire: { header: 'Questionnaire', cell: (a) => a.questionnaireName ?? <span className="text-fg-muted">-</span> },
    'Request Date': { header: 'Request Date', cell: (a) => new Date(a.requestDate).toLocaleString() },
    'Latest Update': { header: 'Latest Update', cell: (a) => new Date(a.latestUpdate).toLocaleString() },
  };
  const actionsCol: Column<OfferApplication> = { header: '', className: 'text-right', cell: (a) => <AppRowMenu app={a} onChanged={refetch} /> };
  const checkboxCol: Column<OfferApplication> = { header: '', cell: () => <input type="checkbox" className="chk" /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(APP_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<OfferApplication> => Boolean(c && shownColumns.has(c.header)));
    return [checkboxCol, ...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <StatusSelect value={status} onChange={setStatus} options={APP_STATUS_OPTIONS} />
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="relative">
          <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
          {filterOpen && (
            <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
              onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="offer-applications" />
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

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No applications match these filters.</StateBlock>
        : <Table columns={displayedColumns} rows={filtered} rowKey={(a) => a.id} />}

      {showColumns && <ColumnsModal allColumns={APP_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
      {showApiRequest && <ApiRequestModal path={`/api/offer-applications?status=${status}`} onClose={() => setShowApiRequest(false)} appliedFilters={{ status, search: q || undefined }} />}
    </>
  );
}

function QuestionnairesTab() {
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const { data, loading, error, refetch } = useQuery<QuestionnaireListItem[]>(`/api/questionnaires?status=${status}`);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const nav = useNavigate();
  const del = useMutation((id: string) => api.del(`/api/questionnaires/${id}`));
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...Q_COLUMNS]);
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
  ], [offers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) rows = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    if ((filters['offer']?.length ?? 0) > 0) {
      const wanted = new Set((offers ?? []).filter((o) => filters['offer']!.includes(o.id)).map((o) => o.name));
      rows = rows.filter((r) => r.offers.some((n) => wanted.has(n)));
    }
    return rows;
  }, [data, q, filters, offers]);

  const doDelete = async (item: QuestionnaireListItem) => {
    setOpenMenuId(null);
    if (!confirm(`Delete questionnaire "${item.name}"?`)) return;
    if (await del.run(item.id)) refetch();
  };

  const columnsByHeader: Record<string, Column<QuestionnaireListItem>> = {
    ID: { header: 'ID', cell: (r) => <span className="text-fg-secondary">{r.id.slice(0, 8)}</span> },
    Name: {
      header: 'Name', cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${r.status === 'active' ? 'bg-success' : 'bg-fg-muted'}`} />
          <Link to={`/app/aff-applications/questionnaires/${r.id}/edit`} className="text-accent-text hover:underline">{r.name}</Link>
        </span>
      ),
    },
    Questions: { header: 'Questions', cell: (r) => r.questions.length ? <div className="text-tiny">{r.questions.map((q2) => <div key={q2}>- {q2}</div>)}</div> : <span className="text-fg-muted">-</span> },
    Offers: { header: 'Offers', cell: (r) => r.offers.length ? <div className="text-tiny">{r.offers.map((o) => <div key={o}>- {o}</div>)}</div> : <span className="text-fg-muted">-</span> },
    Created: { header: 'Created', cell: (r) => new Date(r.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (r) => new Date(r.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<QuestionnaireListItem> = {
    header: '', className: 'text-right', cell: (r) => (
      <div className="relative inline-block">
        <button title="Actions" onClick={() => setOpenMenuId(openMenuId === r.id ? null : r.id)}
          className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
        {openMenuId === r.id && (
          <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-card border border-border bg-elevated py-1 shadow-elevated">
            <button onClick={() => { setOpenMenuId(null); nav(`/app/aff-applications/questionnaires/${r.id}/edit?preview=1`); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Preview Questionnaire</button>
            <button onClick={() => { setOpenMenuId(null); nav(`/app/aff-applications/questionnaires/${r.id}/edit`); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Edit</button>
            <button onClick={() => doDelete(r)} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-accent-subtle">Delete</button>
          </div>
        )}
      </div>
    ),
  };
  const shownColumns = useMemo<Set<string>>(() => new Set(Q_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<QuestionnaireListItem> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, openMenuId]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/aff-applications/questionnaires/new" className="btn-primary">+ Questionnaire</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <StatusSelect value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All', dot: 'bg-fg-muted' },
            { value: 'active', label: 'Active', dot: 'bg-success' },
            { value: 'inactive', label: 'Inactive', dot: 'bg-fg-muted' },
          ] as const} />
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout categories={FILTER_CATEGORIES} values={filters}
                onApply={setFilters} onClose={() => setFilterOpen(false)} storageKey="questionnaires" />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <button onClick={() => setTableActionsOpen(false)} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Export</button>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No questionnaires match these filters.</StateBlock>
        : <Table columns={displayedColumns} rows={filtered} rowKey={(r) => r.id} />}

      {showColumns && <ColumnsModal allColumns={Q_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}

export default function ApplicationsManage() {
  const [tab, setTab] = useState('Offer Applications');
  return (
    <>
      <PageHeader title="Manage Applications" subtitle="Partners › Offer Applications › Manage" />
      <Tabs tabs={['Offer Applications', 'Questionnaires']} active={tab} onChange={setTab} />
      {tab === 'Offer Applications' ? <OfferApplicationsTab /> : <QuestionnairesTab />}
    </>
  );
}
