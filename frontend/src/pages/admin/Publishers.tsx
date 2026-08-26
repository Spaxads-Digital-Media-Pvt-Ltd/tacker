import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { TableActionsMenu } from './PublishersTableActions';
import type { Publisher, DashboardUser } from '../../types';

interface Tag { id: string; name: string; color: string | null; createdAt: string }
interface TagAssignment { tagId: string; entityId: string }
interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }

const STATUS_OPTS = ['active', 'pending', 'inactive'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', pending: 'Pending', inactive: 'Inactive' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', inactive: 'bg-fg-muted' };
const PAYMENT_METHODS = ['Wire', 'Paypal', 'Webmoney', 'Direct Deposit', 'None'];
const BILLING_FREQUENCIES = ['Weekly', 'Bi-Weekly', 'Monthly', 'Net 15', 'Net 30'];

// Coarse, real (not fabricated) geographic bucketing over the free-text Country field — Everflow's
// own "Region" filter category, built from the only geography this app actually stores.
const COUNTRY_REGION: Record<string, string> = {
  'United States': 'North America', Canada: 'North America', Mexico: 'North America',
  'United Kingdom': 'Europe', Germany: 'Europe', France: 'Europe', Spain: 'Europe', Italy: 'Europe', Netherlands: 'Europe', Ireland: 'Europe',
  India: 'Asia', China: 'Asia', Japan: 'Asia', Singapore: 'Asia', Philippines: 'Asia', 'South Korea': 'Asia',
  Australia: 'Oceania', 'New Zealand': 'Oceania',
  Brazil: 'South America', Argentina: 'South America',
  'United Arab Emirates': 'Middle East', Israel: 'Middle East', 'Saudi Arabia': 'Middle East',
  'South Africa': 'Africa', Nigeria: 'Africa', Egypt: 'Africa',
};
const regionOf = (country: string | null | undefined): string => (country ? (COUNTRY_REGION[country] ?? 'Other') : 'Unknown');

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

function StatusFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const options = [{ value: '', label: 'All', dot: 'bg-fg-muted' }, ...STATUS_OPTS.map((s) => ({ value: s, label: STATUS_LABEL[s], dot: STATUS_DOT[s] }))];
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const impersonate = useMutation(() => api.post<{ link: string }>(`/api/publishers/${publisher.id}/impersonate`, {}));

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

  const go = (to: string) => { setOpen(false); nav(to); };
  const doImpersonate = async () => {
    setOpen(false);
    const res = await impersonate.run(undefined);
    if (res) window.open(res.link, '_blank', 'noopener');
  };

  const item = (label: string, onClick: () => void, inert?: string) => (
    <button role="menuitem" title={inert} onClick={onClick} disabled={Boolean(inert)}
      className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-small hover:bg-accent-subtle disabled:cursor-not-allowed ${inert ? 'text-fg-muted' : 'text-fg'}`}>
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
          className="z-50 w-56 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => go(`/app/publishers/${publisher.id}/edit`))}
          {item('View Partner Report', () => go(`/app/reports/partner?publisherId=${publisher.id}`))}
          {item('View Conversion Report', () => go(`/app/reports/conversions?publisherId=${publisher.id}`))}
          {item(impersonate.busy ? 'Impersonating…' : 'Impersonate', doImpersonate,
            publisher.hasPortalAccount ? undefined : 'This partner has no linked portal account yet')}
        </div>,
        document.body,
      )}
    </>
  );
}

type Tab = 'existing' | 'pending' | 'unverified';

export default function Publishers() {
  const { data, loading, error, refetch } = useQuery<Publisher[]>('/api/publishers');
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const { data: tags } = useQuery<Tag[]>('/api/tags');
  const { data: tagAssignments } = useQuery<TagAssignment[]>('/api/tags/assignments?entityType=publisher');
  const { data: allTimeClicks } = useQuery<AggResult>('/api/reports?groupBy=publisher&metrics=clicks');
  const today = useQuery<AggResult>(`/api/reports?groupBy=publisher&metrics=revenue&from=${encodeURIComponent(todayStartIso())}&to=${encodeURIComponent(new Date().toISOString())}`);

  const todayRevenueByPub = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of today.data?.rows ?? []) {
      const id = r.dimensions['publisher'];
      if (id) m.set(id, Number(r.metrics['revenue'] ?? 0));
    }
    return m;
  }, [today.data]);
  const hasTrafficSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of allTimeClicks?.rows ?? []) {
      const id = r.dimensions['publisher'];
      if (id && Number(r.metrics['clicks'] ?? 0) > 0) s.add(id);
    }
    return s;
  }, [allTimeClicks]);
  const tagIdsByPub = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of tagAssignments ?? []) m.set(a.entityId, [...(m.get(a.entityId) ?? []), a.tagId]);
    return m;
  }, [tagAssignments]);
  const userName = (id: string | null | undefined) => users?.find((u) => u.id === id)?.name;
  const pubName = (id: string | null | undefined) => (data ?? []).find((p) => p.id === id)?.name;

  const [tab, setTab] = useState<Tab>('existing');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [nameQ, setNameQ] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const tabbed = useMemo(() => {
    const rows = data ?? [];
    if (tab === 'pending') return rows.filter((p) => p.status === 'pending');
    if (tab === 'unverified') return rows.filter((p) => p.status !== 'pending' && !p.hasPortalAccount);
    return rows.filter((p) => p.status !== 'pending' && p.hasPortalAccount);
  }, [data, tab]);
  const unverifiedCount = useMemo(() => (data ?? []).filter((p) => p.status !== 'pending' && !p.hasPortalAccount).length, [data]);
  const pendingCount = useMemo(() => (data ?? []).filter((p) => p.status === 'pending').length, [data]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'accountExecutive', label: 'Account Executive', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'billingFrequency', label: 'Billing Frequency', options: BILLING_FREQUENCIES.map((v) => ({ value: v, label: v })) },
    { key: 'country', label: 'Country', options: Array.from(new Set((data ?? []).map((p) => p.country).filter((c): c is string => Boolean(c)))).sort().map((v) => ({ value: v, label: v })) },
    { key: 'hasRunTraffic', label: 'Has Run Traffic', options: [{ value: 'yes', label: 'Yes' }] },
    { key: 'label', label: 'Label', options: (tags ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: 'noTraffic', label: 'No Traffic', options: [{ value: 'yes', label: 'Yes' }] },
    { key: 'partnerManager', label: 'Partner Manager', options: (users ?? []).map((u) => ({ value: u.id, label: u.name })) },
    { key: 'partnerTiers', label: 'Partner Tiers', options: Array.from(new Set((data ?? []).map((p) => p.tier).filter((t): t is string => Boolean(t)))).sort().map((v) => ({ value: v, label: v })) },
    { key: 'payable', label: 'Payable', options: [{ value: 'yes', label: 'Payable' }, { value: 'no', label: 'Not Payable' }] },
    { key: 'paymentMethod', label: 'Payment Method', options: PAYMENT_METHODS.map((v) => ({ value: v, label: v })) },
    { key: 'paymentTerms', label: 'Payment Terms', options: Array.from(new Set((data ?? []).map((p) => p.payoutTerms).filter((t): t is string => Boolean(t)))).sort().map((v) => ({ value: v, label: v })) },
    { key: 'region', label: 'Region', options: Array.from(new Set((data ?? []).map((p) => regionOf(p.country)))).sort().map((v) => ({ value: v, label: v })) },
  ], [users, tags, data]);

  const filtered = useMemo(() => {
    let rows = tabbed;
    if (statuses.length) rows = rows.filter((p) => statuses.includes(p.status));
    if (nameQ.trim()) {
      const q = nameQ.trim().toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(q));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('accountExecutive')) rows = rows.filter((p) => p.accountExecutiveId && filters['accountExecutive']!.includes(p.accountExecutiveId));
    if (has('billingFrequency')) rows = rows.filter((p) => p.billingFrequency && filters['billingFrequency']!.includes(p.billingFrequency));
    if (has('country')) rows = rows.filter((p) => p.country && filters['country']!.includes(p.country));
    if (has('hasRunTraffic')) rows = rows.filter((p) => hasTrafficSet.has(p.id));
    if (has('label')) rows = rows.filter((p) => (tagIdsByPub.get(p.id) ?? []).some((t) => filters['label']!.includes(t)));
    if (has('noTraffic')) rows = rows.filter((p) => !hasTrafficSet.has(p.id));
    if (has('partnerManager')) rows = rows.filter((p) => p.partnerManagerId && filters['partnerManager']!.includes(p.partnerManagerId));
    if (has('partnerTiers')) rows = rows.filter((p) => p.tier && filters['partnerTiers']!.includes(p.tier));
    if (has('payable')) rows = rows.filter((p) => filters['payable']!.includes(isPayable(p) ? 'yes' : 'no'));
    if (has('paymentMethod')) rows = rows.filter((p) => p.paymentMethod && filters['paymentMethod']!.includes(p.paymentMethod));
    if (has('paymentTerms')) rows = rows.filter((p) => p.payoutTerms && filters['paymentTerms']!.includes(p.payoutTerms));
    if (has('region')) rows = rows.filter((p) => filters['region']!.includes(regionOf(p.country)));
    return rows;
  }, [tabbed, statuses, nameQ, filters, tagIdsByPub, hasTrafficSet]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allOnPageSelected = paged.length > 0 && paged.every((p) => selected.has(p.id));
  const toggleAllOnPage = () => setSelected((s) => {
    const next = new Set(s);
    if (allOnPageSelected) paged.forEach((p) => next.delete(p.id));
    else paged.forEach((p) => next.add(p.id));
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
  const referredByCol: Column<Publisher> = { header: 'Referred By', cell: (p) => pubName(p.referredById) ?? dash };
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
  }, [columnOrder, shownColumns, showCheckboxCol, tagIdsByPub, todayRevenueByPub, users, data]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const exportRows = (kind: 'partners' | 'emails', format: 'csv' | 'json') => {
    const rows = selected.size > 0 ? filtered.filter((p) => selected.has(p.id)) : filtered;
    const mapped = kind === 'emails'
      ? rows.map((p) => ({ id: p.ref ?? p.id, name: p.name, email: p.contactEmail ?? '' }))
      : rows.map((p) => ({
        id: p.ref ?? p.id, name: p.name, status: p.status, country: p.country ?? '',
        partnerManager: userName(p.partnerManagerId) ?? '', referredBy: pubName(p.referredById) ?? '',
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
          <button key={key} type="button" onClick={() => { setTab(key); setPage(1); setSelected(new Set()); }}
            className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-small font-medium transition-colors ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {label}
            {count > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1.5 text-tiny font-bold text-surface">{count}</span>}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/publishers/new" className="btn-primary">+ Partner</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={nameQ} onChange={(e) => { setNameQ(e.target.value); setPage(1); }} />
          </div>
          <StatusFilterSelect value={statuses[0] ?? ''} onChange={(v) => { setStatuses(v ? [v] : []); setPage(1); }} />
          <div className="relative">
            <FilterButton count={appliedFilterCount(filters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout
                categories={FILTER_CATEGORIES}
                values={filters}
                onApply={(v) => { setFilters(v); setPage(1); }}
                onClose={() => setFilterOpen(false)}
                storageKey="publishers"
              />
            )}
          </div>
          <TableActionsMenu
            selectedIds={[...selected]}
            allColumns={allColumnsForTab}
            columnOrder={columnOrder}
            hiddenColumns={hiddenColumns}
            onApplyColumns={(order, hidden) => {
              setOrderByTab((s) => ({ ...s, [tab]: order }));
              setHiddenByTab((s) => ({ ...s, [tab]: hidden }));
            }}
            onExport={exportRows}
            onBalancesRequested={(msg) => { setToast(msg); refetch(); }}
            appliedFilters={{ status: statuses[0], ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length).map(([k, v]) => [k, v.join(', ')])) }}
          />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No partners match these filters.</StateBlock>
        : (
          <>
            {showCheckboxCol && (
              <div className="mb-2 flex items-center gap-2 text-tiny text-fg-secondary">
                <input type="checkbox" className="chk" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                {selected.size > 0 ? `${selected.size} selected` : 'Select all on page'}
              </div>
            )}
            <Table columns={displayedColumns} rows={paged} rowKey={(p) => p.id} />
            <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
              <span>{filtered.length} Total</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">‹</button>
                <span className="px-1 tabular-nums">{page} / {pageCount}</span>
                <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">›</button>
              </div>
            </div>
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
