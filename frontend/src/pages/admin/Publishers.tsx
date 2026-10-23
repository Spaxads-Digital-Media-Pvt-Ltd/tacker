import { useEffect, useMemo, useState } from 'react';

import { createPortal } from "react-dom";
import { Link, useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, Pencil, User, FileText } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { useImpersonate } from '../../lib/impersonation';
import { PageHeader, Table, StateBlock, MenuItem, type Column, MenuSelect } from '../../shared-components/primitives/ui';
import { Pagination } from '../../shared-components/primitives/ReportPageKit';
import { CategoryFilterDrawer, type FilterCategory } from '../../shared-components/primitives/CategoryFilterDrawer';
import { TableActionsMenu } from './PublishersTableActions';
import { TableRowMenu } from '../../shared-components/primitives/TableActionsKit';
import { countryLabel, isCountryCode } from '../../data/geo';
import type { FilterChip } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { pagedPath, fetchAllPages, useDebounced, sortParams, useTodaySoFarRange, EXPORT_MAX_ROWS, type PagedParams } from './pagedList';
import { SortSelect, ExportNotice, type SortOption, FilterToolbar } from './PagedListControls';
import type { Publisher, DashboardUser, PagedList } from '../../types';

interface Tag { id: string; name: string; color: string | null; createdAt: string }
interface TagAssignment { tagId: string; entityId: string }
interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[]; total?: number }

const STATUS_OPTS = ['active', 'pending', 'inactive'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', pending: 'Pending', inactive: 'Inactive' };
// Pending dot uses warning-text: plain --warning is 2.15:1 on white, under the 3:1 UI minimum.
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning-text', inactive: 'bg-fg-muted' };
const BILLING_FREQUENCIES = ['Weekly', 'Bi-Weekly', 'Monthly', 'Net 15', 'Net 30'];
// Region buckets, Payable, Has Run Traffic and every other filter are evaluated server-side
// (api-backend/src/surfaces/dashboard/publishers/list-query.ts) with the same semantics.

/** "Is Payable" — a real, derived readiness flag (not stored): has a linked portal account, a
 * payment method on file, and an active status. Matches the reference column's own mostly-empty
 * look in demo data (most rows genuinely aren't payable yet). */
const isPayable = (p: Publisher): boolean => Boolean(p.hasPortalAccount && p.paymentMethod && p.status === 'active');
/** "User Name" — the actual contact person, distinct from the partner/company Name; falls back to
 * the email's local part when contactName hasn't been filled in yet (real data either way). */
const userDisplayName = (p: Publisher): string | null => p.contactName || (p.contactEmail ? p.contactEmail.split('@')[0]! : null);

const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
const PAGE_SIZE = 12;

function StatusFilterSelect({ value, onChange, statusOpts }: { value: string; onChange: (v: string) => void; statusOpts: readonly string[] }) {
  const options = [{ value: '', label: 'All', dot: 'bg-fg-muted' }, ...statusOpts.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s, dot: STATUS_DOT[s] ?? 'bg-fg-muted' }))];
  return <MenuSelect label="Status" value={value} options={options} onChange={onChange} active={value !== ''} />;
}

/** Row action menu, verified against the live reference: Edit is real; View Partner Report / View
 * Conversion Report deep-link to Reports pre-filtered to this partner. Impersonate opens the
 * partner's portal in a new tab as a 30-minute admin session (F-10, lib/impersonation.ts) — it needs
 * no portal login of their own; the admin's sign-in elsewhere is untouched. */
function RowActionMenu({ publisher }: { publisher: Publisher }) {
  const nav = useNavigate();
  const impersonate = useImpersonate('publisher', publisher.id);
  const [errDismissed, setErrDismissed] = useState(false);

  const go = (api: { close: () => void }, to: string) => { api.close(); nav(to); };
  const doImpersonate = (api: { close: () => void }) => {
    api.close();
    setErrDismissed(false);
    void impersonate.start();
  };

  return (
    <>
    <TableRowMenu>
      {(api) => (
        <>
          <MenuItem icon={Pencil} onSelect={() => go(api, `/app/publishers/${publisher.id}/edit`)}>Edit</MenuItem>
          <MenuItem icon={FileText} onSelect={() => go(api, `/app/reports/partner?publisherId=${publisher.id}`)}>View Partner Report</MenuItem>
          <MenuItem icon={FileText} onSelect={() => go(api, `/app/reports/conversion?publisherId=${publisher.id}`)}>View Conversion Report</MenuItem>
          <MenuItem icon={User} onSelect={() => doImpersonate(api)}>{impersonate.busy ? 'Impersonating…' : 'Impersonate'}</MenuItem>
        </>
      )}
    </TableRowMenu>
    {impersonate.error && !errDismissed && createPortal(
      <button type="button" onClick={() => setErrDismissed(true)} title="Dismiss"
        className="fixed bottom-6 right-6 z-50 max-w-sm rounded-card border border-danger/40 bg-danger-bg px-4 py-3 text-left text-small text-danger-text shadow-elevated">
        {impersonate.error}
      </button>,
      document.body,
    )}
    </>
  );
}

type Tab = 'existing' | 'pending' | 'unverified';

/** Distinct stored values for the drawer (GET /api/publishers/filter-options) — complete regardless
 * of paging. */
interface PublisherFilterOptions { countries: string[]; regions: string[]; tiers: string[]; paymentMethods: string[]; paymentTerms: string[] }
interface Channel { id: string; name: string; status: string }

const SORT_OPTIONS: SortOption[] = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'id:desc', label: 'ID (high → low)' },
  { value: 'id:asc', label: 'ID (low → high)' },
  { value: 'country:asc', label: 'Country A–Z' },
  { value: 'updatedAt:desc', label: 'Recently modified' },
];
const DEFAULT_SORT = 'createdAt:desc';
/** Free-text country → readable label: ISO-2 codes get their full name ("India (IN)"). */
const countryValueLabel = (v: string) => (v.trim().length === 2 && isCountryCode(v.trim()) ? countryLabel(v.trim()) : v);

export default function Publishers() {
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const { data: tags } = useQuery<Tag[]>('/api/tags');
  const { data: tagAssignments } = useQuery<TagAssignment[]>('/api/tags/assignments?entityType=publisher');
  const { data: options } = useQuery<PublisherFilterOptions>('/api/publishers/filter-options');
  const { data: channels } = useQuery<Channel[]>('/api/control-center/channels?status=active');
  const todayRange = useTodaySoFarRange();
  const today = useQuery<AggResult>(`/api/reports?groupBy=publisher&metrics=revenue&${todayRange}`);

  const todayRevenueByPub = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of today.data?.rows ?? []) {
      const id = r.dimensions['publisher'];
      if (id) m.set(id, Number(r.metrics['revenue'] ?? 0));
    }
    return m;
  }, [today.data]);
  const tagIdsByPub = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of tagAssignments ?? []) m.set(a.entityId, [...(m.get(a.entityId) ?? []), a.tagId]);
    return m;
  }, [tagAssignments]);
  const userName = (id: string | null | undefined) => users?.find((u) => u.id === id)?.name;

  const [tab, setTab] = useState<Tab>('existing');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [nameQ, setNameQ] = useState('');
  const searchQ = useDebounced(nameQ.trim());
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Selection is per page: any filter/search/sort/tab change → page 1 and an empty selection; a page
  // change also clears it, so bulk actions only ever see rows the current view shows.
  const resetView = () => { setPage(1); setSelected(new Set()); };
  const goPage = (p: number) => { setPage(p); setSelected(new Set()); };
  // Existing / Unverified tabs exclude pending partners, so "Pending" is only offered on its own tab.
  const tabStatusOpts = tab === 'pending' ? STATUS_OPTS : STATUS_OPTS.filter((s) => s !== 'pending');

  // The server does tab/status/search/drawer filters, sort and paging (GET /api/publishers?paged=1).
  const listParams = useMemo<PagedParams>(() => {
    const f = (k: string) => (filters[k]?.length ? filters[k] : undefined);
    return {
      tab, status: statuses.join(',') || undefined, search: searchQ || undefined, ...sortParams(sort),
      accountExecutiveId: f('accountExecutive')?.join(','), partnerManagerId: f('partnerManager')?.join(','),
      channelId: f('channel')?.join(','), label: f('label')?.join(','), region: f('region')?.join(','),
      payable: f('payable')?.join(','),
      billingFrequency: f('billingFrequency'), country: f('country'), tier: f('partnerTiers'),
      paymentMethod: f('paymentMethod'), paymentTerms: f('paymentTerms'),
      hasRunTraffic: f('hasRunTraffic') ? 'true' : undefined, noTraffic: f('noTraffic') ? 'true' : undefined,
    };
  }, [tab, statuses, searchQ, sort, filters]);
  const { data, loading, error, refetch } = useQuery<PagedList<Publisher>>(pagedPath('/api/publishers', { ...listParams, page, pageSize: PAGE_SIZE }));
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (data && page > pageCount) setPage(pageCount); }, [data, page, pageCount]);
  const unverifiedCount = data?.counts['tabs']?.['unverified'] ?? 0;
  const pendingCount = data?.counts['tabs']?.['pending'] ?? 0;

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'accountExecutive', label: 'Account Executive', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'billingFrequency', label: 'Billing Frequency', options: BILLING_FREQUENCIES.map((v) => ({ value: v, label: v })) },
    { key: 'channel', label: 'Channel', options: (channels ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { key: 'country', label: 'Country', options: (options?.countries ?? []).map((v) => ({ value: v, label: countryValueLabel(v) })) },
    { key: 'hasRunTraffic', label: 'Has Run Traffic', options: [{ value: 'yes', label: 'Yes' }] },
    { key: 'label', label: 'Label', options: (tags ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: 'noTraffic', label: 'No Traffic', options: [{ value: 'yes', label: 'Yes' }] },
    { key: 'partnerManager', label: 'Partner Manager', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'partnerTiers', label: 'Partner Tiers', options: (options?.tiers ?? []).map((v) => ({ value: v, label: v })) },
    { key: 'payable', label: 'Payable', options: [{ value: 'yes', label: 'Payable' }, { value: 'no', label: 'Not Payable' }] },
    // Free text in the DB ("PayPal", "Payoneer", "ACH", …) — options are the distinct stored values,
    // de-duplicated case-insensitively server-side; matching is case-insensitive too.
    { key: 'paymentMethod', label: 'Payment Method', options: (options?.paymentMethods ?? []).map((v) => ({ value: v, label: v })) },
    { key: 'paymentTerms', label: 'Payment Terms', options: (options?.paymentTerms ?? []).map((v) => ({ value: v, label: v })) },
    { key: 'region', label: 'Region', options: (options?.regions ?? []).map((v) => ({ value: v, label: v })) },
  ], [users, tags, options, channels]);
  // Display label for an applied filter value (user / label UUIDs → names) for the API-request modal.
  const filterValueLabel = (key: string, value: string) =>
    FILTER_CATEGORIES.find((c) => c.key === key)?.options.find((o) => o.value === value)?.label ?? value;

  // Applied-filter chips: status + search + every drawer value, with names instead of uuids/codes.
  const chips = useMemo<FilterChip[]>(() => [
    ...statuses.map((s) => ({ key: '__status', value: s, label: 'Status', valueLabel: STATUS_LABEL[s] ?? s })),
    ...(searchQ ? [{ key: '__search', value: searchQ, label: 'Search', valueLabel: searchQ }] : []),
    ...chipsFromValues(FILTER_CATEGORIES, filters),
  ], [statuses, searchQ, filters, FILTER_CATEGORIES]);
  const removeChip = (c: FilterChip) => {
    if (c.key === '__status') setStatuses((s) => s.filter((x) => x !== c.value));
    else if (c.key === '__search') setNameQ('');
    else setFilters((f) => withoutValue(f, c.key, c.value));
    resetView();
  };
  const clearAll = () => { setStatuses([]); setNameQ(''); setFilters({}); resetView(); };

  // Bulk actions / export only ever act on selected rows of the current page (selection is per page).
  const visibleSelected = useMemo(() => rows.filter((p) => selected.has(p.id)), [rows, selected]);
  const allOnPageSelected = rows.length > 0 && rows.every((p) => selected.has(p.id));
  const toggleAllOnPage = () => setSelected((s) => {
    const next = new Set(s);
    if (allOnPageSelected) rows.forEach((p) => next.delete(p.id));
    else rows.forEach((p) => next.add(p.id));
    return next;
  });
  const toggleRow = (id: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const nameCell = (p: Publisher) => (
    <span className="inline-flex items-center gap-2">
      <span role="img" aria-label={STATUS_LABEL[p.status] ?? p.status} title={STATUS_LABEL[p.status] ?? p.status} className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[p.status] ?? 'bg-fg-muted'}`} />
      <Link to={`/app/publishers/${p.id}`} className="font-medium text-accent-text hover:underline">{p.name}</Link>
    </span>
  );
  const dash = <span className="text-fg-muted">—</span>;
  const checkboxCol: Column<Publisher> = { header: '', cell: (p) => <input type="checkbox" className="chk" aria-label={`Select partner ${p.name}`} checked={selected.has(p.id)} onChange={() => toggleRow(p.id)} /> };
  const actionsCol: Column<Publisher> = { header: '', className: 'text-right', cell: (p) => <RowActionMenu publisher={p} /> };
  const idCol: Column<Publisher> = { header: 'ID', cell: (p) => <span className="tabular-nums text-fg-secondary">{p.ref ?? '—'}</span> };
  const partnerManagerCol: Column<Publisher> = { header: 'Partner Manager', cell: (p) => userName(p.partnerManagerId) ?? dash };
  const countryCol: Column<Publisher> = { header: 'Country', cell: (p) => p.country ?? dash };
  const referredByCol: Column<Publisher> = { header: 'Referred By', cell: (p) => p.referredByName ?? dash };
  const createdCol: Column<Publisher> = { header: 'Created', cell: (p) => new Date(p.createdAt).toLocaleDateString() };
  const userNameCol: Column<Publisher> = { header: 'User Name', cell: (p) => userDisplayName(p) ?? dash };
  const userEmailCol: Column<Publisher> = { header: 'User Email', cell: (p) => p.contactEmail ?? dash };
  const taxIdCol: Column<Publisher> = { header: 'Tax ID / VAT or SSN', cell: (p) => p.taxId ?? dash };

  const EXISTING_COLUMNS: readonly string[] = ['ID', 'Name', 'Country', 'Partner Manager', 'Referred By', 'Labels', "Today's Revenue", 'Payment Method', 'Is Payable', 'Created', 'Traffic Source', 'Payment Terms', 'Website', 'Modified'];
  const PENDING_COLUMNS: readonly string[] = ['ID', 'Name', 'Partner Manager', 'Country', 'Advertiser', 'User Name', 'User Email', 'Notes', 'Referred By', 'Tax ID / VAT or SSN', 'Created'];
  const UNVERIFIED_COLUMNS: readonly string[] = ['ID', 'Name', 'Partner Manager', 'Country', 'User Name', 'User Email', 'Referred By', 'Tax ID / VAT or SSN', 'Created'];

  const columnsByHeader: Record<string, Column<Publisher>> = {
    ID: idCol,
    Name: { header: 'Name', cell: nameCell },
    Country: countryCol,
    'Partner Manager': partnerManagerCol,
    'Referred By': referredByCol,
    Labels: {
      header: 'Labels', cell: (p) => {
        const ids = tagIdsByPub.get(p.id) ?? [];
        const names = ids.map((tid) => tags?.find((t) => t.id === tid)?.name).filter(Boolean);
        return names.length ? names.join(', ') : <span className="text-fg-muted">-</span>;
      },
    },
    "Today's Revenue": { header: "Today's Revenue", className: 'text-right tabular-nums', cell: (p) => money(todayRevenueByPub.get(p.id)) },
    'Payment Method': { header: 'Payment Method', cell: (p) => p.paymentMethod ?? dash },
    'Is Payable': { header: 'Is Payable', cell: (p) => (isPayable(p) ? <span className="text-success-text">Yes</span> : dash) },
    Created: createdCol,
    'Traffic Source': { header: 'Traffic Source', cell: (p) => p.trafficSource ?? dash },
    'Payment Terms': { header: 'Payment Terms', cell: (p) => p.payoutTerms ?? dash },
    Website: { header: 'Website', cell: (p) => p.website ?? dash },
    Modified: { header: 'Modified', cell: (p) => (p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—') },
    Advertiser: { header: 'Advertiser', cell: () => dash },
    'User Name': userNameCol,
    'User Email': userEmailCol,
    Notes: { header: 'Notes', cell: (p) => p.notes ?? dash },
    'Tax ID / VAT or SSN': taxIdCol,
  };

  const allColumnsForTab = tab === 'existing' ? EXISTING_COLUMNS : tab === 'pending' ? PENDING_COLUMNS : UNVERIFIED_COLUMNS;
  const [hiddenByTab, setHiddenByTab] = useState<Record<Tab, Set<string>>>({ existing: new Set(), pending: new Set(), unverified: new Set() });
  const [orderByTab, setOrderByTab] = useState<Record<Tab, string[]>>({ existing: [...EXISTING_COLUMNS], pending: [...PENDING_COLUMNS], unverified: [...UNVERIFIED_COLUMNS] });
  const hiddenColumns = hiddenByTab[tab];
  const columnOrder = orderByTab[tab];
  const shownColumns = useMemo<Set<string>>(() => new Set(allColumnsForTab.filter((c) => !hiddenColumns.has(c))), [allColumnsForTab, hiddenColumns]);
  const showCheckboxCol = tab !== 'unverified';
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<Publisher> => Boolean(c && shownColumns.has(c.header)));
    return [...(showCheckboxCol ? [checkboxCol] : []), ...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, showCheckboxCol, selected, tagIdsByPub, todayRevenueByPub, users, data]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Export = the selected rows, or EVERY row matching the current filters (walked page by page on
  // the server, capped at EXPORT_MAX_ROWS with a visible note).
  const exportRows = async (kind: 'partners' | 'emails', format: 'csv' | 'json') => {
    setExportNote(null);
    let rowsOut: Publisher[] = visibleSelected;
    if (rowsOut.length === 0) {
      try {
        const all = await fetchAllPages<Publisher>('/api/publishers', listParams);
        rowsOut = all.rows;
        if (all.capped) setExportNote(`Export capped at ${EXPORT_MAX_ROWS.toLocaleString()} of ${all.total.toLocaleString()} matching partners — narrow the filters to export the rest.`);
      } catch (e) {
        setExportNote(`Export failed: ${e instanceof Error ? e.message : 'request error'}`);
        return;
      }
    }
    const mapped = kind === 'emails'
      ? rowsOut.map((p) => ({ id: p.ref ?? p.id, name: p.name, email: p.contactEmail ?? '' }))
      : rowsOut.map((p) => ({
        id: p.ref ?? p.id, name: p.name, status: p.status, country: p.country ?? '',
        partnerManager: userName(p.partnerManagerId) ?? '', referredBy: p.referredByName ?? '',
        paymentMethod: p.paymentMethod ?? '', createdAt: p.createdAt, modifiedAt: p.updatedAt ?? '',
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
    a.download = `partners-${kind}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Manage Partners" subtitle="Manage your partner network — approval status, payout terms, traffic sources." />

      <div className="mb-4 flex items-center gap-6 overflow-x-auto border-b border-border">
        {([['existing', 'Existing', 0], ['pending', 'Pending', pendingCount], ['unverified', 'Unverified', unverifiedCount]] as const).map(([key, label, count]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => {
            setTab(key); resetView();
            if (key !== 'pending') setStatuses((s) => s.filter((x) => x !== 'pending'));
          }}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 text-small font-medium transition-colors duration-fast ${tab === key ? 'border-accent-text text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {label}
            {count > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1.5 text-tiny font-bold tabular-nums text-surface">{count}</span>}
          </button>
        ))}
      </div>

      <FilterToolbar className="mb-4" chips={chips} onRemoveChip={removeChip} onClearAll={clearAll} actions={<>
        <Link to="/app/publishers/new" className="btn-primary whitespace-nowrap">+ Partner</Link>
        <TableActionsMenu
          selectedIds={visibleSelected.map((p) => p.id)}
          allColumns={allColumnsForTab}
          columnOrder={columnOrder}
          hiddenColumns={hiddenColumns}
          onApplyColumns={(order, hidden) => {
            setOrderByTab((s) => ({ ...s, [tab]: order }));
            setHiddenByTab((s) => ({ ...s, [tab]: hidden }));
          }}
          onExport={(kind, format) => { void exportRows(kind, format); }}
          onBalancesRequested={(msg) => { setToast(msg); refetch(); }}
          partnerName={(id) => rows.find((p) => p.id === id)?.name ?? id}
          appliedFilters={{ status: statuses.join(', ') || undefined, search: searchQ || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((x) => filterValueLabel(k, x)).join(', ')])) }}
        />
      </>} lead={
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[16rem] sm:flex-1 lg:max-w-sm">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !pl-9" aria-label="Search partners" placeholder="Search…" value={nameQ} onChange={(e) => { setNameQ(e.target.value); resetView(); }} />
        </div>
      }>
        <StatusFilterSelect statusOpts={tabStatusOpts} value={statuses[0] ?? ''} onChange={(v) => { setStatuses(v ? [v] : []); resetView(); }} />
        <SortSelect value={sort} options={SORT_OPTIONS} onChange={(v) => { setSort(v); resetView(); }} />
        <div className="relative">
          <button type="button" onClick={() => setFilterOpen((o) => !o)} className="btn-toolbar" data-active={activeFilterCount > 0 ? 'true' : undefined}>
            <SlidersHorizontal size={16} aria-hidden /> Filters
            {activeFilterCount > 0 && (
              <>
                <span aria-hidden className="tabular-nums">· {activeFilterCount}</span>
                <span className="sr-only">({activeFilterCount} applied)</span>
              </>
            )}
          </button>
          {filterOpen && (
            <CategoryFilterDrawer categories={FILTER_CATEGORIES} values={filters}
              onApply={(v) => { setFilters(v); resetView(); }} onClose={() => setFilterOpen(false)} />
          )}
        </div>
      </FilterToolbar>

      <ExportNotice message={exportNote} onDismiss={() => setExportNote(null)} />

      {loading && !data ? <StateBlock variant="loading" title="Loading partners…" rows={6} />
        : error ? <StateBlock variant="error" title="Couldn’t load partners" hint={error} onRetry={refetch} />
        : !rows.length ? (loading
          ? <StateBlock variant="loading" title="Loading partners…" rows={6} />
          : <StateBlock variant="empty" title="No partners match these filters." />)
        : (
          <>
            {showCheckboxCol && (
              <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-tiny text-fg-secondary">
                <input type="checkbox" className="chk" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                {visibleSelected.length > 0 ? `${visibleSelected.length} selected on this page` : 'Select all on page'}
              </label>
            )}
            <div aria-busy={loading || undefined} className={`rounded-card shadow-card transition-opacity duration-base ${loading ? 'opacity-60' : ''}`}>
              <Table columns={displayedColumns} rows={rows} rowKey={(p) => p.id} stickyCol={displayedColumns.findIndex((c) => c.header === 'Name')} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {loading && <span role="status" className="text-tiny text-fg-muted">Loading…</span>}
              <Pagination total={total} page={page} pageSize={PAGE_SIZE} onPageChange={goPage} />
            </div>
            <p className="mt-2 text-tiny text-fg-muted sm:hidden">Swipe the table sideways for more columns.</p>
          </>
        )}

      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-card border border-border bg-elevated px-4 py-3 text-small text-fg shadow-elevated">
          {toast}
          <button type="button" className="ml-3 text-tiny font-medium text-accent-text hover:underline" onClick={() => setToast(null)}>Dismiss</button>
        </div>,
        document.body,
      )}
    </>
  );
}
