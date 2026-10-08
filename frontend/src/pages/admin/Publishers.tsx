import { useEffect, useMemo, useState } from 'react';

import { createPortal } from "react-dom";
import { Link, useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, ChevronDown, Pencil, User, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, MenuItem, type Column } from '../../shared-components/primitives/ui';
import { CategoryFilterDrawer, type FilterCategory } from '../../shared-components/primitives/CategoryFilterDrawer';
import { TableActionsMenu } from './PublishersTableActions';
import { useDropdown, TableRowMenu } from '../../shared-components/primitives/TableActionsKit';
import { countryLabel, isCountryCode } from '../../data/geo';
import { ActiveFilterChips, type FilterChip } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { pagedPath, fetchAllPages, useDebounced, sortParams, EXPORT_MAX_ROWS, type PagedParams } from './pagedList';
import { SortSelect, PagerFooter, ExportNotice, type SortOption } from './PagedListControls';
import type { Publisher, DashboardUser, PagedList } from '../../types';

interface Tag { id: string; name: string; color: string | null; createdAt: string }
interface TagAssignment { tagId: string; entityId: string }
interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[]; total?: number }

const STATUS_OPTS = ['active', 'pending', 'inactive'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', pending: 'Pending', inactive: 'Inactive' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', inactive: 'bg-fg-muted' };
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
function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

const PAGE_SIZE = 12;

function StatusFilterSelect({ value, onChange, statusOpts }: { value: string; onChange: (v: string) => void; statusOpts: readonly string[] }) {
  const { open, setOpen, ref } = useDropdown();
  const options = [{ value: '', label: 'All', dot: 'bg-fg-muted' }, ...statusOpts.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s, dot: STATUS_DOT[s] ?? 'bg-fg-muted' }))];
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

/** Row action menu, verified against the live reference: Edit is real; View Partner Report / View
 * Conversion Report deep-link to Reports pre-filtered to this partner. Impersonate mints a real
 * Supabase magic-link for the partner's OWN linked portal account — partners without one show a
 * disabled state with an explanatory tooltip rather than faking a login. */
function RowActionMenu({ publisher }: { publisher: Publisher }) {
  const nav = useNavigate();
  const impersonate = useMutation(() => api.post<{ link: string }>(`/api/publishers/${publisher.id}/impersonate`, {}));

  const go = (api: { close: () => void }, to: string) => { api.close(); nav(to); };
  const doImpersonate = async (api: { close: () => void }) => {
    if (!publisher.hasPortalAccount) return;
    api.close();
    const res = await impersonate.run(undefined);
    if (res) window.open(res.link, '_blank', 'noopener');
  };

  return (
    <TableRowMenu>
      {(api) => (
        <>
          <MenuItem icon={Pencil} onSelect={() => go(api, `/app/publishers/${publisher.id}/edit`)}>Edit</MenuItem>
          <MenuItem icon={FileText} onSelect={() => go(api, `/app/reports/partner?publisherId=${publisher.id}`)}>View Partner Report</MenuItem>
          <MenuItem icon={FileText} onSelect={() => go(api, `/app/reports/conversion?publisherId=${publisher.id}`)}>View Conversion Report</MenuItem>
          {publisher.hasPortalAccount ? (
            <MenuItem icon={User} onSelect={() => doImpersonate(api)}>{impersonate.busy ? 'Impersonating…' : 'Impersonate'}</MenuItem>
          ) : (
            <div title="This partner has no linked portal account yet" className="opacity-50 pointer-events-none">
              <MenuItem icon={User} onSelect={() => {}}>Impersonate</MenuItem>
            </div>
          )}
        </>
      )}
    </TableRowMenu>
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
  const today = useQuery<AggResult>(`/api/reports?groupBy=publisher&metrics=revenue&from=${encodeURIComponent(todayStartIso())}&to=${encodeURIComponent(new Date().toISOString())}`);

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
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[p.status] ?? 'bg-fg-muted'}`} />
      <Link to={`/app/publishers/${p.id}`} className="font-medium text-accent-text hover:underline">{p.name}</Link>
    </span>
  );
  const dash = <span className="text-fg-muted">—</span>;
  const checkboxCol: Column<Publisher> = { header: '', cell: (p) => <input type="checkbox" className="chk" checked={selected.has(p.id)} onChange={() => toggleRow(p.id)} /> };
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
    "Today's Revenue": { header: "Today's Revenue", className: 'text-right', cell: (p) => money(todayRevenueByPub.get(p.id)) },
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

      <div className="mb-4 flex items-center gap-6 border-b border-border">
        {([['existing', 'Existing', 0], ['pending', 'Pending', pendingCount], ['unverified', 'Unverified', unverifiedCount]] as const).map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => {
            setTab(key); resetView();
            if (key !== 'pending') setStatuses((s) => s.filter((x) => x !== 'pending'));
          }}
            className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-small font-medium transition-colors ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {label}
            {count > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1.5 text-tiny font-bold text-surface">{count}</span>}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Link to="/app/publishers/new" className="btn-primary max-sm:w-full">+ Partner</Link>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <div className="relative max-sm:w-full">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-full sm:!w-56 !pl-8" placeholder="Search…" value={nameQ} onChange={(e) => { setNameQ(e.target.value); resetView(); }} />
          </div>
          <StatusFilterSelect statusOpts={tabStatusOpts} value={statuses[0] ?? ''} onChange={(v) => { setStatuses(v ? [v] : []); resetView(); }} />
          <SortSelect value={sort} options={SORT_OPTIONS} onChange={(v) => { setSort(v); resetView(); }} />
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg relative">
              <SlidersHorizontal size={15} />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filterOpen && (
              <CategoryFilterDrawer categories={FILTER_CATEGORIES} values={filters}
                onApply={(v) => { setFilters(v); resetView(); }} onClose={() => setFilterOpen(false)} />
            )}
          </div>
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
            appliedFilters={{ status: statuses.join(', ') || undefined, search: searchQ || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((x) => filterValueLabel(k, x)).join(', ')])) }}
          />
        </div>
      </div>

      <ActiveFilterChips chips={chips} onRemove={removeChip} onClearAll={clearAll} className="mb-3" />
      <ExportNotice message={exportNote} onDismiss={() => setExportNote(null)} />

      {loading && !data ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !rows.length ? <StateBlock>{loading ? <Spinner /> : 'No partners match these filters.'}</StateBlock>
        : (
          <>
            {showCheckboxCol && (
              <div className="mb-2 flex items-center gap-2 text-tiny text-fg-secondary">
                <input type="checkbox" className="chk" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                {visibleSelected.length > 0 ? `${visibleSelected.length} selected on this page` : 'Select all on page'}
              </div>
            )}
            <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
              <Table columns={displayedColumns} rows={rows} rowKey={(p) => p.id} stickyCol={displayedColumns.findIndex((c) => c.header === 'Name')} />
            </div>
            <PagerFooter total={total} page={page} pageSize={PAGE_SIZE} onPage={goPage} loading={loading} />
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
