import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { Search, SlidersHorizontal, Image as ImageIcon, MoreVertical, ChevronDown } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import { SearchFilterDrawer, FieldBlock } from '../../components/SearchFilterDrawer';
import { TableActionsMenu, ALL_COLUMNS } from './OffersTableActions';
import { CopyOfferModal } from './CopyOfferModal';
import { CopyOfferSettingsModal } from './CopyOfferSettingsModal';
import { TrackingLinksModal } from './offerDetail/TrackingLinksModal';
import type { Offer, Advertiser, Publisher, TrackingDomain } from '../../types';

/** Row action menu (Everflow-style), verified item-by-item against the live reference: Edit, Copy
 * Offer, Copy Offer Settings (onto an existing offer), and Copy Landing Page URL are real. View
 * Postbacks / View Offer Applications deep-link straight to that tab on Offer Detail (matching the
 * reference's own `?tab=` deep links). View Conversion Report / View Offer Report deep-link to the
 * Reports pages pre-filtered to this offer (matching the reference's own `autoRun` behavior). Get
 * Tracking Link opens the same real TrackingLinksModal already used on Offer Detail, without
 * leaving the list — matching the reference opening it as an overlay too. Rendered via a portal so
 * it isn't clipped by the table's own `overflow-x-auto` scroll container. */
function RowActionMenu({
  offer, onDuplicated, publishers, domains,
}: { offer: Offer; onDuplicated: () => void; publishers: Publisher[]; domains: TrackingDomain[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySettingsOpen, setCopySettingsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', () => setOpen(false), true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', () => setOpen(false), true);
    };
  }, [open]);

  const go = (to: string) => { setOpen(false); nav(to); };
  const copyUrl = async () => {
    await navigator.clipboard?.writeText(offer.destinationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
    setOpen(false);
  };
  const openCopyOffer = () => { setOpen(false); setCopyOpen(true); };
  const openCopyOfferSettings = () => { setOpen(false); setCopySettingsOpen(true); };
  const openTrackingLink = () => { setOpen(false); setLinksOpen(true); };

  const item = (label: string, onClick: () => void, inert?: boolean) => (
    <button
      key={label}
      role="menuitem"
      title={inert ? 'Not available yet' : undefined}
      onClick={onClick}
      className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle"
    >
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef} title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      >
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef} role="menu"
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-56 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated"
        >
          {item('Edit', () => go(`/app/offers/${offer.id}/edit`))}
          {item('Copy Offer', openCopyOffer)}
          {item('Copy Offer Settings', openCopyOfferSettings)}
          {item(copied ? 'Copied!' : 'Copy Landing Page URL', copyUrl)}
          {item('View Postbacks', () => go(`/app/offers/${offer.id}?tab=Postbacks`))}
          {item('View Offer Applications', () => go(`/app/offers/${offer.id}?tab=${encodeURIComponent('Offer Applications')}`))}
          {item('View Conversion Report', () => go(`/app/reports/conversions?offerId=${offer.id}`))}
          {item('View Offer Report', () => go(`/app/reports/offer?offerId=${offer.id}`))}
          {item('Get Tracking Link', openTrackingLink)}
        </div>,
        document.body,
      )}
      {copyOpen && <CopyOfferModal offerId={offer.id} onClose={() => setCopyOpen(false)}
        onDone={(newId) => { setCopyOpen(false); onDuplicated(); nav(`/app/offers/${newId}`); }} />}
      {copySettingsOpen && <CopyOfferSettingsModal offerId={offer.id} onClose={() => setCopySettingsOpen(false)} />}
      {linksOpen && <TrackingLinksModal offer={offer} publishers={publishers} domains={domains} onClose={() => setLinksOpen(false)} />}
    </>
  );
}

// Real backend enum (draft/active/paused/archived) shown under Everflow's own status labels —
// draft ≈ Pending (awaiting setup), archived ≈ Deleted. Colors follow this app's own semantic
// rule (green=positive, amber=pending, red=negative, neutral=inert), not Everflow's literal hues.
const STATUS_OPTS = ['active', 'paused', 'draft', 'archived'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', paused: 'Paused', draft: 'Pending', archived: 'Deleted' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', paused: 'bg-fg-muted', draft: 'bg-warning', archived: 'bg-danger' };
// Everflow-style model prefixes: R- on the revenue side, C- on the payout side, same suffix.
const REV_PREFIX: Record<string, string> = { CPA: 'RPA', CPL: 'RPL', CPC: 'RPC', CPI: 'RPI', RevShare: 'RevShare' };
const PAYOUT_TYPES = ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'] as const;
// Device Type filter — reference uses "PC/Tablet/Mobile"; this app stores allowed_traffic_types as
// desktop/mobile/tablet (the only device values the Add/Edit Offer form writes).
const DEVICE_TYPES: { value: string; label: string }[] = [
  { value: 'desktop', label: 'PC (Desktop)' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'mobile', label: 'Mobile' },
];
// Reference "Table Filters" panel lists these too, but this app's schema has no field to back them
// (offers carry no channel / platform / business-unit classification, and "Marketplace Advertisers"
// is a multi-tenant concept). Shown for 1:1 parity with the reference, rendered inert with a note
// rather than fabricating options. (Country IS backed — see the geo-rules bulk fetch.)
const UNBACKED_FILTERS: Record<string, string> = {
  'Business Unit': 'No business-unit concept in this app.',
  Channel: 'Offers carry no traffic-channel field.',
  'Marketplace Advertisers': 'Single-tenant — same set as the Advertiser filter.',
  Platform: 'Offers carry no OS/platform targeting field.',
};

interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }
const nfmt = new Intl.NumberFormat('en-US');
const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
// Bare 2-dp amount — the Revenue/Payout columns pair it with a separate currency label, and it keeps
// them consistent with the money-formatted "Today's Revenue" column instead of dumping raw "10.0000".
const amt = (v: string | number | undefined) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

const PAGE_SIZE = 12;

interface Tag { id: string; name: string; color: string | null; createdAt: string }
interface TagAssignment { tagId: string; entityId: string }
/** Per-offer effective allowed countries (bulk, from GET /api/offers/geo-rules). Offers with no
 * geo rules are absent from the response — treated as "allows every country". */
interface OfferCountries { offerId: string; mode: 'allow' | 'deny'; countries: string[] }

/** Mirrors tracking/geo-rules.ts: no entry → allows all; allow-list → only those; deny-list → all but those. */
function offerAllowsCountry(g: OfferCountries | undefined, cc: string): boolean {
  if (!g) return true;
  return g.mode === 'allow' ? g.countries.includes(cc) : !g.countries.includes(cc);
}

/** Short, readable countries summary for the list column. */
function countriesLabel(g: OfferCountries | undefined): string {
  if (!g || g.countries.length === 0) return g?.mode === 'allow' ? '—' : 'All';
  const shown = g.countries.slice(0, 3).join(', ');
  const more = g.countries.length > 3 ? ` +${g.countries.length - 3}` : '';
  return g.mode === 'allow' ? `${shown}${more}` : `All except ${shown}${more}`;
}

const SEARCH_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'advertiser', label: 'Advertiser' },
  { value: 'id', label: 'ID' },
] as const;
type SearchField = (typeof SEARCH_FIELDS)[number]['value'];

/** Small dropdown trigger, closes on outside click. Shared shape for the search-field and status
 * selectors — both are single-select lists rendered right in the toolbar (not portal-based; the
 * toolbar itself isn't inside a clipped scroll container). */
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

/** A "Table Filters" row the reference has but this app's schema can't back — rendered as a real,
 * disabled control with a one-line reason, rather than fabricating options (same honesty convention
 * used for the inert filter facets on the Marketplace/Advertisers pages). */
function InertFilter({ label }: { label: string }) {
  return (
    <FieldBlock label={label}>
      <select className="input cursor-not-allowed opacity-60" disabled>
        <option>Not available in this app</option>
      </select>
      <p className="mt-1 text-[11px] text-fg-muted">{UNBACKED_FILTERS[label]}</p>
    </FieldBlock>
  );
}

function SearchFieldSelect({ value, onChange }: { value: SearchField; onChange: (v: SearchField) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const current = SEARCH_FIELDS.find((f) => f.value === value)!;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
        {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-40 rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {SEARCH_FIELDS.map((f) => (
            <button key={f.value} type="button" onClick={() => { onChange(f.value); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {f.label}{f.value === value && <span className="text-accent-text">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

export default function Offers() {
  const { data, loading, error, refetch } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const { data: users } = useQuery<{ id: string; name: string; email: string }[]>('/api/users');
  const { data: tags } = useQuery<Tag[]>('/api/tags');
  const { data: tagAssignments } = useQuery<TagAssignment[]>('/api/tags/assignments?entityType=offer');
  const { data: offerCountries } = useQuery<OfferCountries[]>('/api/offers/geo-rules');
  const tagIdsByOffer = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of tagAssignments ?? []) m.set(a.entityId, [...(m.get(a.entityId) ?? []), a.tagId]);
    return m;
  }, [tagAssignments]);
  const geoByOffer = useMemo(() => new Map((offerCountries ?? []).map((g) => [g.offerId, g])), [offerCountries]);
  // Country options — every country named in any offer's allow-list or deny-list.
  const countryOptions = useMemo(
    () => Array.from(new Set((offerCountries ?? []).flatMap((g) => g.countries))).sort(),
    [offerCountries],
  );
  const categories = useMemo(() => Array.from(new Set((data ?? []).map((o) => o.category).filter((c): c is string => Boolean(c)))).sort(), [data]);
  const today = useQuery<AggResult>(`/api/reports?groupBy=offer&metrics=clicks,revenue&from=${encodeURIComponent(todayStartIso())}&to=${encodeURIComponent(new Date().toISOString())}`);
  const todayByOffer = useMemo(() => {
    const m = new Map<string, { clicks: number; revenue: number }>();
    for (const r of today.data?.rows ?? []) {
      const id = r.dimensions['offer'];
      if (id) m.set(id, { clicks: Number(r.metrics['clicks'] ?? 0), revenue: Number(r.metrics['revenue'] ?? 0) });
    }
    return m;
  }, [today.data]);

  const advById = useMemo(() => new Map((advertisers ?? []).map((a) => [a.id, a])), [advertisers]);
  const userName = (id: string | null | undefined) => (id ? users?.find((u) => u.id === id)?.name ?? id.slice(0, 8) + '…' : null);
  const advName = (id: string) => {
    const a = advById.get(id);
    return a ? (a.ref != null ? `(${a.ref}) ${a.name}` : a.name) : id.slice(0, 8) + '…';
  };
  const mgrOf = (advertiserId: string, key: 'accountManagerId' | 'salesManagerId') => advById.get(advertiserId)?.[key] ?? null;
  // Account / Sales manager live on the offer's advertiser (advertisers.account_manager_id /
  // sales_manager_id → users). Options = managers actually assigned to at least one advertiser.
  const [acctManagers, salesManagers] = useMemo(() => {
    const build = (key: 'accountManagerId' | 'salesManagerId') =>
      Array.from(new Set((advertisers ?? []).map((a) => a[key]).filter((x): x is string => Boolean(x))))
        .map((id) => ({ id, name: (users ?? []).find((u) => u.id === id)?.name ?? `${id.slice(0, 8)}…` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return [build('accountManagerId'), build('salesManagerId')];
  }, [advertisers, users]);

  // Applied filters (Trackog Manage Offer defaults: Active checked)
  const [statuses, setStatuses] = useState<string[]>(['active']);
  const [offerIdsText, setOfferIdsText] = useState('');
  const [nameQ, setNameQ] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('name');
  const [advertiserId, setAdvertiserId] = useState('');
  const [objective, setObjective] = useState('');
  const [visibility, setVisibility] = useState('');
  const [tagId, setTagId] = useState('');
  const [category, setCategory] = useState('');
  const [payoutType, setPayoutType] = useState('');
  const [revenueType, setRevenueType] = useState('');
  const [offerGroupId, setOfferGroupId] = useState('');
  const [accountManagerId, setAccountManagerId] = useState('');
  const [salesManagerId, setSalesManagerId] = useState('');
  const [trackingDomainId, setTrackingDomainId] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [country, setCountry] = useState('');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: offerGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');

  // Draft while drawer open
  const [dStatuses, setDStatuses] = useState(statuses);
  const [dIds, setDIds] = useState(offerIdsText);
  const [dName, setDName] = useState(nameQ);
  const [dAdv, setDAdv] = useState(advertiserId);
  const [dObj, setDObj] = useState(objective);
  const [dVis, setDVis] = useState(visibility);
  const [dTag, setDTag] = useState(tagId);
  const [dCat, setDCat] = useState(category);
  const [dPayout, setDPayout] = useState(payoutType);
  const [dRev, setDRev] = useState(revenueType);
  const [dGroup, setDGroup] = useState(offerGroupId);
  const [dAcct, setDAcct] = useState(accountManagerId);
  const [dSales, setDSales] = useState(salesManagerId);
  const [dDomain, setDDomain] = useState(trackingDomainId);
  const [dDevice, setDDevice] = useState(deviceType);
  const [dCountry, setDCountry] = useState(country);

  const openDrawer = () => {
    setDStatuses(statuses); setDIds(offerIdsText); setDName(nameQ);
    setDAdv(advertiserId); setDObj(objective); setDVis(visibility); setDTag(tagId); setDCat(category);
    setDPayout(payoutType); setDRev(revenueType); setDGroup(offerGroupId);
    setDAcct(accountManagerId); setDSales(salesManagerId); setDDomain(trackingDomainId); setDDevice(deviceType);
    setDCountry(country);
    setOpen(true);
  };
  const applyDrawer = () => {
    setStatuses(dStatuses); setOfferIdsText(dIds); setNameQ(dName);
    setAdvertiserId(dAdv); setObjective(dObj); setVisibility(dVis); setTagId(dTag); setCategory(dCat);
    setPayoutType(dPayout); setRevenueType(dRev); setOfferGroupId(dGroup);
    setAccountManagerId(dAcct); setSalesManagerId(dSales); setTrackingDomainId(dDomain); setDeviceType(dDevice);
    setCountry(dCountry);
    setOpen(false); setPage(1);
  };
  const clearDraft = () => {
    setDStatuses([]); setDIds(''); setDName(''); setDAdv(''); setDObj(''); setDVis(''); setDTag(''); setDCat('');
    setDPayout(''); setDRev(''); setDGroup(''); setDAcct(''); setDSales(''); setDDomain(''); setDDevice(''); setDCountry('');
  };

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (statuses.length) rows = rows.filter((o) => statuses.includes(o.status));
    if (nameQ.trim()) {
      const q = nameQ.trim().toLowerCase();
      if (searchField === 'name') rows = rows.filter((o) => o.name.toLowerCase().includes(q));
      else if (searchField === 'advertiser') rows = rows.filter((o) => advName(o.advertiserId).toLowerCase().includes(q));
      else rows = rows.filter((o) => String(o.ref ?? '').includes(q) || o.id.toLowerCase().includes(q));
    }
    if (offerIdsText.trim()) {
      const ids = offerIdsText.split(',').map((s) => s.trim()).filter(Boolean);
      rows = rows.filter((o) => ids.includes(String(o.ref)) || ids.includes(o.id));
    }
    if (advertiserId) rows = rows.filter((o) => o.advertiserId === advertiserId);
    if (objective) rows = rows.filter((o) => (o.objective ?? o.payoutModel) === objective);
    if (visibility) rows = rows.filter((o) => (o.visibility ?? 'public') === visibility);
    if (tagId) rows = rows.filter((o) => (tagIdsByOffer.get(o.id) ?? []).includes(tagId));
    if (category) rows = rows.filter((o) => o.category === category);
    if (payoutType) rows = rows.filter((o) => o.payoutModel === payoutType);
    if (revenueType) rows = rows.filter((o) => (REV_PREFIX[o.payoutModel] ?? o.payoutModel) === revenueType);
    if (accountManagerId) rows = rows.filter((o) => mgrOf(o.advertiserId, 'accountManagerId') === accountManagerId);
    if (salesManagerId) rows = rows.filter((o) => mgrOf(o.advertiserId, 'salesManagerId') === salesManagerId);
    if (trackingDomainId) rows = rows.filter((o) => o.trackingDomainId === trackingDomainId);
    if (deviceType) rows = rows.filter((o) => {
      const t = o.allowedTrafficTypes ?? [];
      return t.length === 0 || t.includes(deviceType); // no restriction = allows every device
    });
    if (country) rows = rows.filter((o) => offerAllowsCountry(geoByOffer.get(o.id), country));
    if (offerGroupId) {
      const group = (offerGroups ?? []).find((g) => g.id === offerGroupId);
      rows = rows.filter((o) => group?.offerIds.includes(o.id));
    }
    return rows;
  }, [data, statuses, nameQ, searchField, offerIdsText, advertiserId, objective, visibility, tagId, category, payoutType, revenueType, accountManagerId, salesManagerId, trackingDomainId, deviceType, country, geoByOffer, offerGroupId, offerGroups, tagIdsByOffer, advertisers, advById]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const boolCount = (...vals: unknown[]) => vals.reduce<number>((n, v) => n + (v ? 1 : 0), 0);
  const appliedCount = statuses.length + boolCount(offerIdsText, nameQ, advertiserId, objective, visibility, tagId, category,
    payoutType, revenueType, offerGroupId, accountManagerId, salesManagerId, trackingDomainId, deviceType, country);
  const draftCount = dStatuses.length + boolCount(dIds, dName, dAdv, dObj, dVis, dTag, dCat,
    dPayout, dRev, dGroup, dAcct, dSales, dDomain, dDevice, dCountry);

  const allOnPageSelected = paged.length > 0 && paged.every((o) => selected.has(o.id));
  const toggleAllOnPage = () => setSelected((s) => {
    const next = new Set(s);
    if (allOnPageSelected) paged.forEach((o) => next.delete(o.id));
    else paged.forEach((o) => next.add(o.id));
    return next;
  });
  const toggleRow = (id: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const columns: Column<Offer>[] = [
    { header: '', cell: (o) => <input type="checkbox" className="chk" checked={selected.has(o.id)} onChange={() => toggleRow(o.id)} /> },
    { header: 'ID', cell: (o) => <span className="tabular-nums text-fg-secondary">{o.ref ?? '—'}</span> },
    { header: 'Thumbnail', cell: () => <div className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-page text-fg-muted"><ImageIcon size={15} /></div> },
    {
      header: 'Name', cell: (o) => (
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[o.status] ?? 'bg-fg-muted'}`} />
          <Link to={`/app/offers/${o.id}`} className="font-medium text-accent-text hover:underline">{o.name}</Link>
        </span>
      ),
    },
    { header: 'Visibility', cell: (o) => <span className="capitalize text-fg-secondary">{o.visibility ?? 'public'}</span> },
    { header: 'Advertiser', cell: (o) => <span className="text-accent-text">{advName(o.advertiserId)}</span> },
    { header: 'Sales Manager', cell: (o) => {
      const n = userName(mgrOf(o.advertiserId, 'salesManagerId'));
      return n ? <span className="text-fg-secondary">{n}</span> : <span className="text-fg-muted">—</span>;
    } },
    { header: 'Category', cell: (o) => o.category ?? '—' },
    {
      header: 'Labels', cell: (o) => {
        const ids = tagIdsByOffer.get(o.id) ?? [];
        const names = ids.map((tid) => tags?.find((t) => t.id === tid)?.name).filter(Boolean);
        return names.length ? names.join(', ') : <span className="text-fg-muted">-</span>;
      },
    },
    { header: 'Countries', cell: (o) => {
      const g = geoByOffer.get(o.id);
      return g ? <span className="text-fg-secondary">{countriesLabel(g)}</span> : 'All';
    } },
    { header: 'Revenue', className: 'text-right', cell: (o) => <><span className="text-tiny text-fg-muted">{REV_PREFIX[o.payoutModel] ?? o.payoutModel}</span> {o.currency} <span className="tabular-nums">{amt(o.defaultRevenue)}</span></> },
    { header: 'Payout', className: 'text-right', cell: (o) => <><span className="text-tiny text-fg-muted">{o.payoutModel}</span> {o.currency} <span className="tabular-nums">{amt(o.defaultPayout)}</span></> },
    { header: "Today's Clicks", className: 'text-right', cell: (o) => nfmt.format(todayByOffer.get(o.id)?.clicks ?? 0) },
    { header: "Today's Revenue", className: 'text-right', cell: (o) => money(todayByOffer.get(o.id)?.revenue) },
    { header: 'Created', cell: (o) => new Date(o.createdAt).toLocaleDateString() },
    { header: 'Modified', cell: (o) => (o.updatedAt ? new Date(o.updatedAt).toLocaleDateString() : '—') },
    { header: '', className: 'text-right', cell: (o) => <RowActionMenu offer={o} onDuplicated={refetch} publishers={publishers ?? []} domains={domains ?? []} /> },
  ];

  const toggleStatus = (s: string) =>
    setDStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const checkboxCol = columns[0]!;
    const actionsCol = columns[columns.length - 1]!;
    const byHeader = new Map(columns.filter((c) => c.header !== '').map((c) => [c.header, c]));
    const ordered = columnOrder.map((h) => byHeader.get(h)).filter((c): c is Column<Offer> => Boolean(c) && shownColumns.has(c!.header));
    return [checkboxCol, ...ordered, actionsCol];
  }, [columns, columnOrder, shownColumns]);

  const exportRows = (format: 'csv' | 'json') => {
    const rows = selected.size > 0 ? filtered.filter((o) => selected.has(o.id)) : filtered;
    const mapped = rows.map((o) => ({
      id: o.ref ?? o.id, name: o.name, status: o.status, visibility: o.visibility ?? 'public',
      advertiser: advName(o.advertiserId), category: o.category ?? '', currency: o.currency,
      payoutModel: o.payoutModel, revenue: o.defaultRevenue, payout: o.defaultPayout,
      countries: countriesLabel(geoByOffer.get(o.id)),
      createdAt: o.createdAt, modifiedAt: o.updatedAt ?? '',
    }));
    let blob: Blob;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json;charset=utf-8;' });
    } else {
      const headers = Object.keys(mapped[0] ?? { id: '', name: '', status: '', visibility: '', advertiser: '', category: '', currency: '', payoutModel: '', revenue: '', payout: '', countries: '', createdAt: '', modifiedAt: '' });
      const lines = [headers.join(',')];
      for (const row of mapped) {
        lines.push(headers.map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
      }
      blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offers-export-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Manage Offers"
        subtitle="Create, manage and optimize your affiliate Offer."
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center max-sm:w-full">
            <SearchFieldSelect value={searchField} onChange={setSearchField} />
            <div className="relative max-sm:w-full">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-full sm:!w-56 !pl-8" placeholder={`Search by ${searchField}…`} value={nameQ} onChange={(e) => { setNameQ(e.target.value); setPage(1); }} />
            </div>
            <StatusFilterSelect value={statuses[0] ?? ''} onChange={(v) => { setStatuses(v ? [v] : []); setPage(1); }} />
            <button type="button" className="btn-ghost relative" onClick={openDrawer}>
              <SlidersHorizontal size={15} /> Filters
              {appliedCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-tiny font-bold text-white">
                  {appliedCount}
                </span>
              )}
            </button>
            <Link to="/app/offers/new" className="btn-primary max-sm:w-full">+ Offer</Link>
            <TableActionsMenu
              selectedIds={[...selected]}
              columnOrder={columnOrder}
              hiddenColumns={hiddenColumns}
              onApplyColumns={(order, hidden) => { setColumnOrder(order); setHiddenColumns(hidden); }}
              onExport={exportRows}
              appliedFilters={{
                status: statuses[0] ?? undefined, search: nameQ || undefined, searchField,
                advertiser: advertiserId ? advName(advertiserId) : undefined, category: category || undefined,
                label: tagId ? tags?.find((t) => t.id === tagId)?.name : undefined, payoutType: payoutType || undefined,
                revenueType: revenueType || undefined,
                accountManager: accountManagerId ? userName(accountManagerId) ?? undefined : undefined,
                salesManager: salesManagerId ? userName(salesManagerId) ?? undefined : undefined,
                trackingDomain: trackingDomainId ? domains?.find((d) => d.id === trackingDomainId)?.host : undefined,
                deviceType: deviceType || undefined,
                offerGroup: offerGroupId ? offerGroups?.find((g) => g.id === offerGroupId)?.name : undefined,
              }}
            />
          </div>
        }
      />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No offers match these filters.</StateBlock>
        : (
          <>
            <div className="mb-2 flex items-center gap-2 text-tiny text-fg-secondary">
              <input type="checkbox" className="chk" checked={allOnPageSelected} onChange={toggleAllOnPage} />
              {selected.size > 0 ? `${selected.size} selected` : 'Select all on page'}
            </div>
            <Table columns={displayedColumns} rows={paged} rowKey={(o) => o.id} stickyCol={displayedColumns.findIndex((c) => c.header === 'Name')} />
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

      {open && (
        <SearchFilterDrawer appliedCount={draftCount} onClose={() => setOpen(false)} onApply={applyDrawer}>
          <div className="mb-3 flex justify-end">
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearDraft}>Clear</button>
          </div>
          <FieldBlock label="Offer IDs">
            <input className="input" placeholder="e.g. 101, 205, 310" value={dIds} onChange={(e) => setDIds(e.target.value)} />
            <p className="mt-1 text-[11px] text-fg-muted">Comma separated IDs</p>
          </FieldBlock>
          <FieldBlock label="Offer Name">
            <input className="input" placeholder="Search by offer name..." value={dName} onChange={(e) => setDName(e.target.value)} />
          </FieldBlock>
          <div className="mb-4">
            <p className="label">Status</p>
            <div className="space-y-1.5">
              {STATUS_OPTS.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-small text-fg hover:bg-page">
                  <input type="checkbox" className="chk" checked={dStatuses.includes(s)} onChange={() => toggleStatus(s)} />
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} /> {STATUS_LABEL[s]}
                </label>
              ))}
            </div>
          </div>

          {/* Everflow's "Table Filters" panel, field-for-field. Alphabetical, like the reference.
              Filters with a real backing column are live; the rest are shown inert (see below). */}
          <p className="mb-2 mt-1 border-t border-border pt-3 text-tiny font-semibold uppercase tracking-wide text-fg-muted">Table Filters</p>

          <FieldBlock label="Account Manager">
            <select className="input" value={dAcct} onChange={(e) => setDAcct(e.target.value)}>
              <option value="">All Account Managers</option>
              {acctManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {acctManagers.length === 0 && <p className="mt-1 text-[11px] text-fg-muted">No account managers assigned to any advertiser yet.</p>}
          </FieldBlock>

          <FieldBlock label="Advertiser">
            <select className="input" value={dAdv} onChange={(e) => setDAdv(e.target.value)}>
              <option value="">All Advertisers</option>
              {(advertisers ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.ref != null ? `(${a.ref}) ${a.name}` : a.name}</option>
              ))}
            </select>
          </FieldBlock>

          <InertFilter label="Business Unit" />

          <FieldBlock label="Category">
            <select className="input" value={dCat} onChange={(e) => setDCat(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldBlock>

          <InertFilter label="Channel" />

          <FieldBlock label="Country">
            <select className="input" value={dCountry} onChange={(e) => setDCountry(e.target.value)}>
              <option value="">All Countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">From each offer's geo rules — an offer with no rules matches every country.</p>
          </FieldBlock>

          <FieldBlock label="Device Type">
            <select className="input" value={dDevice} onChange={(e) => setDDevice(e.target.value)}>
              <option value="">All Device Types</option>
              {DEVICE_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">Matches an offer's Allowed Traffic Types (no restriction = matches all).</p>
          </FieldBlock>

          <FieldBlock label="Label">
            <select className="input" value={dTag} onChange={(e) => setDTag(e.target.value)}>
              <option value="">All Labels</option>
              {(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FieldBlock>

          <InertFilter label="Marketplace Advertisers" />

          <FieldBlock label="Offer Group">
            <select className="input" value={dGroup} onChange={(e) => setDGroup(e.target.value)}>
              <option value="">All Offer Groups</option>
              {(offerGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </FieldBlock>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <FieldBlock label="Payout Type">
              <select className="input" value={dPayout} onChange={(e) => setDPayout(e.target.value)}>
                <option value="">All Payout Types</option>
                {PAYOUT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </FieldBlock>
            <FieldBlock label="Revenue Type">
              <select className="input" value={dRev} onChange={(e) => setDRev(e.target.value)}>
                <option value="">All Revenue Types</option>
                {PAYOUT_TYPES.map((p) => <option key={p} value={REV_PREFIX[p]}>{REV_PREFIX[p]}</option>)}
              </select>
            </FieldBlock>
          </div>

          <InertFilter label="Platform" />

          <FieldBlock label="Sales Manager">
            <select className="input" value={dSales} onChange={(e) => setDSales(e.target.value)}>
              <option value="">All Sales Managers</option>
              {salesManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {salesManagers.length === 0 && <p className="mt-1 text-[11px] text-fg-muted">No sales managers assigned to any advertiser yet.</p>}
          </FieldBlock>

          <FieldBlock label="Tracking Domain">
            <select className="input" value={dDomain} onChange={(e) => setDDomain(e.target.value)}>
              <option value="">All Tracking Domains</option>
              {(domains ?? []).map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Visibility">
            <select className="input" value={dVis} onChange={(e) => setDVis(e.target.value)}>
              <option value="">All Visibility</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="ask">Ask</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Objective">
            <select className="input" value={dObj} onChange={(e) => setDObj(e.target.value)}>
              <option value="">All Objectives</option>
              <option value="conversions">Conversions</option>
              <option value="sale">Sale</option>
              <option value="app_installs">App Installs</option>
              <option value="leads">Leads</option>
              <option value="impressions">Impressions</option>
              <option value="clicks">Clicks</option>
            </select>
          </FieldBlock>
        </SearchFilterDrawer>
      )}
    </>
  );
}
