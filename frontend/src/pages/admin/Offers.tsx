import { useEffect, useMemo, useState } from 'react';

import { useNavigate, Link } from 'react-router-dom';
import { Search, SlidersHorizontal, ChevronDown, Pencil, Copy, Settings, Link as LinkIcon, Eye, FileText } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, MenuItem, type Column } from '../../shared-components/primitives/ui';
import { OfferThumbnail } from '../../shared-components/primitives/OfferThumbnail';
import { SearchFilterDrawer, FieldBlock } from '../../shared-components/primitives/SearchFilterDrawer';
import { TableActionsMenu, ALL_COLUMNS } from './OffersTableActions';
import { useDropdown, TableRowMenu } from '../../shared-components/primitives/TableActionsKit';
import { CopyOfferModal } from './CopyOfferModal';
import { CopyOfferSettingsModal } from './CopyOfferSettingsModal';
import { TrackingLinksModal } from './offerDetail/TrackingLinksModal';
import { groupTrackingDomains } from '../../lib/trackingLinks';
import { countryLabel, countryName } from '../../data/geo';
import { ActiveFilterChips, type FilterChip } from '../../shared-components/primitives/ActiveFilterChips';
import { pagedPath, fetchAllPages, useDebounced, sortParams, useTodaySoFarRange, EXPORT_MAX_ROWS, type PagedParams } from './pagedList';
import { SortSelect, PagerFooter, ExportNotice, type SortOption } from './PagedListControls';
import type { Offer, Advertiser, Publisher, TrackingDomain, PagedList } from '../../types';

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
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySettingsOpen, setCopySettingsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const nav = useNavigate();

  const go = (api: { close: () => void }, to: string) => { api.close(); nav(to); };
  const copyUrl = async (api: { close: () => void }) => {
    await navigator.clipboard?.writeText(offer.destinationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
    api.close();
  };
  const openCopyOffer = (api: { close: () => void }) => { api.close(); setCopyOpen(true); };
  const openCopyOfferSettings = (api: { close: () => void }) => { api.close(); setCopySettingsOpen(true); };
  const openTrackingLink = (api: { close: () => void }) => { api.close(); setLinksOpen(true); };

  return (
    <>
      <TableRowMenu>
        {(api) => (
          <>
            <MenuItem icon={Pencil} onSelect={() => go(api, `/app/offers/${offer.id}/edit`)}>Edit</MenuItem>
            <MenuItem icon={Copy} onSelect={() => openCopyOffer(api)}>Copy Offer</MenuItem>
            <MenuItem icon={Settings} onSelect={() => openCopyOfferSettings(api)}>Copy Offer Settings</MenuItem>
            <MenuItem icon={LinkIcon} onSelect={() => copyUrl(api)}>{copied ? 'Copied!' : 'Copy Landing Page URL'}</MenuItem>
            <MenuItem icon={Eye} onSelect={() => go(api, `/app/offers/${offer.id}?tab=Postbacks`)}>View Postbacks</MenuItem>
            <MenuItem icon={Eye} onSelect={() => go(api, `/app/offers/${offer.id}?tab=${encodeURIComponent('Offer Applications')}`)}>View Offer Applications</MenuItem>
            <MenuItem icon={FileText} onSelect={() => go(api, `/app/reports/conversion?offerId=${offer.id}`)}>View Conversion Report</MenuItem>
            <MenuItem icon={FileText} onSelect={() => go(api, `/app/reports/offer?offerId=${offer.id}`)}>View Offer Report</MenuItem>
            <MenuItem icon={LinkIcon} onSelect={() => openTrackingLink(api)}>Get Tracking Link</MenuItem>
          </>
        )}
      </TableRowMenu>
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
// Platform filter — always offer the common OSes, plus any platform named in an offer's targeting.
const BASE_PLATFORMS = ['Windows', 'Android', 'iOS', 'Mac OS', 'Linux'] as const;

interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }
const nfmt = new Intl.NumberFormat('en-US');
const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
// Bare 2-dp amount — the Revenue/Payout columns pair it with a separate currency label, and it keeps
// them consistent with the money-formatted "Today's Revenue" column instead of dumping raw "10.0000".
const amt = (v: string | number | undefined) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

const PAGE_SIZE = 12;

interface Tag { id: string; name: string; color: string | null; createdAt: string }
interface TagAssignment { tagId: string; entityId: string }
/** Per-offer effective allowed countries (bulk, from GET /api/offers/geo-rules). Offers with no
 * geo rules are absent from the response — treated as "allows every country". */
interface OfferCountries { offerId: string; mode: 'allow' | 'deny'; countries: string[] }

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

/** Toolbar status quick-pick. Picks a single status; when the drawer has several selected it shows
 * "N statuses" instead of pretending only the first one applies. */
function StatusFilterSelect({ statuses, onChange }: { statuses: string[]; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const options = [{ value: '', label: 'All', dot: 'bg-fg-muted' }, ...STATUS_OPTS.map((s) => ({ value: s, label: STATUS_LABEL[s], dot: STATUS_DOT[s] }))];
  const value = statuses.length === 1 ? statuses[0]! : '';
  const current = statuses.length > 1
    ? { value: '', label: `${statuses.length} statuses`, dot: 'bg-accent' }
    : options.find((o) => o.value === value) ?? options[0]!;
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
              {statuses.length <= 1 && o.value === value && <span className="ml-auto text-accent-text">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Distinct values in use (GET /api/offers/filter-options) — complete regardless of paging. */
interface OfferFilterOptions { categories: string[]; countries: string[]; platforms: string[] }
interface CatalogEntry { id: string; name: string; status: string }

const SORT_OPTIONS: SortOption[] = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'id:desc', label: 'ID (high → low)' },
  { value: 'id:asc', label: 'ID (low → high)' },
  { value: 'advertiser:asc', label: 'Advertiser A–Z' },
  { value: 'payout:desc', label: 'Payout (high → low)' },
  { value: 'revenue:desc', label: 'Revenue (high → low)' },
  { value: 'updatedAt:desc', label: 'Recently modified' },
];
const DEFAULT_SORT = 'createdAt:desc';
const OBJECTIVE_LABEL: Record<string, string> = {
  conversions: 'Conversions', sale: 'Sale', app_installs: 'App Installs', leads: 'Leads', impressions: 'Impressions', clicks: 'Clicks',
};
const DEFAULT_STATUSES = ['active'];

export default function Offers() {
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const domainGroups = groupTrackingDomains(domains);
  const { data: users } = useQuery<{ id: string; name: string; email: string }[]>('/api/users');
  const { data: tags } = useQuery<Tag[]>('/api/tags');
  const { data: tagAssignments } = useQuery<TagAssignment[]>('/api/tags/assignments?entityType=offer');
  const { data: offerCountries } = useQuery<OfferCountries[]>('/api/offers/geo-rules');
  const { data: filterOptions } = useQuery<OfferFilterOptions>('/api/offers/filter-options');
  const { data: ccCategories } = useQuery<CatalogEntry[]>('/api/control-center/categories?status=active');
  const tagIdsByOffer = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of tagAssignments ?? []) m.set(a.entityId, [...(m.get(a.entityId) ?? []), a.tagId]);
    return m;
  }, [tagAssignments]);
  const geoByOffer = useMemo(() => new Map((offerCountries ?? []).map((g) => [g.offerId, g])), [offerCountries]);
  // Country options — every country named in any offer's geo-rule allow/deny list or in its
  // targeting.country include/exclude list (server-side distinct), sorted by full name.
  const countryOptions = useMemo(
    () => [...(filterOptions?.countries ?? [])].sort((a, b) => countryName(a).localeCompare(countryName(b))),
    [filterOptions],
  );
  // Platform options — the common OSes plus every platform named in any offer's targeting rule.
  const platformOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const p of [...BASE_PLATFORMS, ...(filterOptions?.platforms ?? [])]) {
      if (!byKey.has(p.toLowerCase())) byKey.set(p.toLowerCase(), p);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [filterOptions]);
  // Category options — the Control Center catalog plus every category actually in use on an offer
  // (offers.category is free text), de-duplicated case-insensitively; matching is case-insensitive.
  const categories = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const c of [...(ccCategories ?? []).map((x) => x.name), ...(filterOptions?.categories ?? [])]) {
      const v = c.trim();
      if (v && !byKey.has(v.toLowerCase())) byKey.set(v.toLowerCase(), v);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [ccCategories, filterOptions]);
  const todayRange = useTodaySoFarRange();
  const today = useQuery<AggResult>(`/api/reports?groupBy=offer&metrics=clicks,revenue&${todayRange}`);
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
  // Paged rows carry their advertiser's name/ref/managers (joined server-side), so a row never
  // depends on the advertiser picker list being complete.
  const offerAdvName = (o: Offer) => (o.advertiserName != null
    ? (o.advertiserRef != null ? `(${o.advertiserRef}) ${o.advertiserName}` : o.advertiserName)
    : advName(o.advertiserId));
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
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES);
  const [offerIdsText, setOfferIdsText] = useState('');
  const [nameQ, setNameQ] = useState(''); // toolbar search (matches under `searchField`)
  const searchQ = useDebounced(nameQ.trim());
  const [offerNameQ, setOfferNameQ] = useState(''); // drawer "Offer Name" filter (always by name)
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
  const [platform, setPlatform] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Selection is per page: any filter/search/sort change → page 1 and an empty selection; a page
  // change also clears it, so bulk actions only ever see rows the current view shows.
  const resetView = () => { setPage(1); setSelected(new Set()); };
  const goPage = (p: number) => { setPage(p); setSelected(new Set()); };

  const { data: offerGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');

  // Draft while drawer open
  const [dStatuses, setDStatuses] = useState(statuses);
  const [dIds, setDIds] = useState(offerIdsText);
  const [dName, setDName] = useState(offerNameQ);
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
  const [dPlatform, setDPlatform] = useState(platform);

  const openDrawer = () => {
    setDStatuses(statuses); setDIds(offerIdsText); setDName(offerNameQ);
    setDAdv(advertiserId); setDObj(objective); setDVis(visibility); setDTag(tagId); setDCat(category);
    setDPayout(payoutType); setDRev(revenueType); setDGroup(offerGroupId);
    setDAcct(accountManagerId); setDSales(salesManagerId); setDDomain(trackingDomainId); setDDevice(deviceType);
    setDCountry(country); setDPlatform(platform);
    setOpen(true);
  };
  const applyDrawer = () => {
    setStatuses(dStatuses); setOfferIdsText(dIds); setOfferNameQ(dName);
    setAdvertiserId(dAdv); setObjective(dObj); setVisibility(dVis); setTagId(dTag); setCategory(dCat);
    setPayoutType(dPayout); setRevenueType(dRev); setOfferGroupId(dGroup);
    setAccountManagerId(dAcct); setSalesManagerId(dSales); setTrackingDomainId(dDomain); setDeviceType(dDevice);
    setCountry(dCountry); setPlatform(dPlatform);
    setOpen(false); resetView();
  };
  const clearDraft = () => {
    setDStatuses([]); setDIds(''); setDName(''); setDAdv(''); setDObj(''); setDVis(''); setDTag(''); setDCat('');
    setDPayout(''); setDRev(''); setDGroup(''); setDAcct(''); setDSales(''); setDDomain(''); setDDevice(''); setDCountry('');
    setDPlatform('');
  };

  // The server does every filter, the search, sort and paging (GET /api/offers?paged=1).
  const offerIdList = useMemo(() => offerIdsText.split(',').map((s) => s.trim()).filter(Boolean), [offerIdsText]);
  const listParams = useMemo<PagedParams>(() => ({
    ...sortParams(sort),
    search: searchQ || undefined, searchField: searchQ ? searchField : undefined,
    name: offerNameQ.trim() || undefined, offerIds: offerIdList.join(',') || undefined,
    status: statuses.join(',') || undefined, advertiserId, category, tagId, offerGroupId,
    accountManagerId, salesManagerId, trackingDomainId, visibility, payoutType, revenueType, objective,
    deviceType, country, platform,
  }), [sort, searchQ, searchField, offerNameQ, offerIdList, statuses, advertiserId, category, tagId, offerGroupId,
    accountManagerId, salesManagerId, trackingDomainId, visibility, payoutType, revenueType, objective, deviceType, country, platform]);
  const { data, loading, error, refetch } = useQuery<PagedList<Offer>>(pagedPath('/api/offers', { ...listParams, page, pageSize: PAGE_SIZE }));
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (data && page > pageCount) setPage(pageCount); }, [data, page, pageCount]);

  const boolCount = (...vals: unknown[]) => vals.reduce<number>((n, v) => n + (v ? 1 : 0), 0);
  const appliedCount = statuses.length + boolCount(offerIdsText, offerNameQ, advertiserId, objective, visibility, tagId, category,
    payoutType, revenueType, offerGroupId, accountManagerId, salesManagerId, trackingDomainId, deviceType, country, platform);
  const draftCount = dStatuses.length + boolCount(dIds, dName, dAdv, dObj, dVis, dTag, dCat,
    dPayout, dRev, dGroup, dAcct, dSales, dDomain, dDevice, dCountry, dPlatform);

  // Applied-filter chips (names, never uuids/ISO codes). Removing one applies immediately.
  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    const add = (key: string, label: string, value: string, valueLabel?: string | null) => {
      if (value) out.push({ key, value, label, valueLabel: valueLabel || value });
    };
    for (const s of statuses) add('status', 'Status', s, STATUS_LABEL[s]);
    add('search', `Search (${SEARCH_FIELDS.find((f) => f.value === searchField)?.label ?? searchField})`, searchQ);
    for (const id of offerIdList) add('offerIds', 'Offer ID', id);
    add('offerName', 'Offer Name', offerNameQ.trim());
    add('advertiserId', 'Advertiser', advertiserId, advertiserId ? advName(advertiserId) : null);
    add('category', 'Category', category);
    add('country', 'Country', country, country ? countryLabel(country) : null);
    add('deviceType', 'Device Type', deviceType, DEVICE_TYPES.find((d) => d.value === deviceType)?.label);
    add('tagId', 'Label', tagId, tags?.find((t) => t.id === tagId)?.name);
    add('offerGroupId', 'Offer Group', offerGroupId, offerGroups?.find((g) => g.id === offerGroupId)?.name);
    add('payoutType', 'Payout Type', payoutType);
    add('revenueType', 'Revenue Type', revenueType);
    add('platform', 'Platform', platform);
    add('accountManagerId', 'Account Manager', accountManagerId, userName(accountManagerId));
    add('salesManagerId', 'Sales Manager', salesManagerId, userName(salesManagerId));
    add('trackingDomainId', 'Tracking Domain', trackingDomainId, domains?.find((d) => d.id === trackingDomainId)?.host);
    add('visibility', 'Visibility', visibility, visibility ? visibility[0]!.toUpperCase() + visibility.slice(1) : null);
    add('objective', 'Objective', objective, OBJECTIVE_LABEL[objective]);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, searchQ, searchField, offerIdList, offerNameQ, advertiserId, category, country, deviceType, tagId, offerGroupId,
    payoutType, revenueType, platform, accountManagerId, salesManagerId, trackingDomainId, visibility, objective,
    tags, offerGroups, domains, users, advById]);
  const removeChip = (c: FilterChip) => {
    const setters: Record<string, (v: string) => void> = {
      search: setNameQ, offerName: setOfferNameQ, advertiserId: setAdvertiserId, category: setCategory, country: setCountry,
      deviceType: setDeviceType, tagId: setTagId, offerGroupId: setOfferGroupId, payoutType: setPayoutType,
      revenueType: setRevenueType, platform: setPlatform, accountManagerId: setAccountManagerId,
      salesManagerId: setSalesManagerId, trackingDomainId: setTrackingDomainId, visibility: setVisibility, objective: setObjective,
    };
    if (c.key === 'status') setStatuses((s) => s.filter((x) => x !== c.value));
    else if (c.key === 'offerIds') setOfferIdsText(offerIdList.filter((x) => x !== c.value).join(', '));
    else setters[c.key]?.('');
    resetView();
  };
  const clearAll = () => {
    setStatuses([]); setOfferIdsText(''); setNameQ(''); setOfferNameQ(''); setAdvertiserId(''); setObjective('');
    setVisibility(''); setTagId(''); setCategory(''); setPayoutType(''); setRevenueType(''); setOfferGroupId('');
    setAccountManagerId(''); setSalesManagerId(''); setTrackingDomainId(''); setDeviceType(''); setCountry(''); setPlatform('');
    resetView();
  };

  // Bulk actions / export only ever act on selected rows of the current page (selection is per page).
  const visibleSelected = useMemo(() => rows.filter((o) => selected.has(o.id)), [rows, selected]);
  const allOnPageSelected = rows.length > 0 && rows.every((o) => selected.has(o.id));
  const toggleAllOnPage = () => setSelected((s) => {
    const next = new Set(s);
    if (allOnPageSelected) rows.forEach((o) => next.delete(o.id));
    else rows.forEach((o) => next.add(o.id));
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
    { header: 'Thumbnail', cell: (o) => <OfferThumbnail url={o.thumbnailUrl} name={o.name} /> },
    {
      header: 'Name', cell: (o) => (
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[o.status] ?? 'bg-fg-muted'}`} />
          <Link to={`/app/offers/${o.id}`} className="font-medium text-accent-text hover:underline">{o.name}</Link>
        </span>
      ),
    },
    { header: 'Visibility', cell: (o) => <span className="capitalize text-fg-secondary">{o.visibility ?? 'public'}</span> },
    { header: 'Advertiser', cell: (o) => <span className="text-accent-text">{offerAdvName(o)}</span> },
    { header: 'Sales Manager', cell: (o) => {
      const n = userName(o.advertiserSalesManagerId ?? advById.get(o.advertiserId)?.salesManagerId ?? null);
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

  // Export = the selected rows, or EVERY offer matching the current filters (walked page by page on
  // the server, capped at EXPORT_MAX_ROWS with a visible note).
  const exportRows = async (format: 'csv' | 'json') => {
    setExportNote(null);
    let rowsOut: Offer[] = visibleSelected;
    if (rowsOut.length === 0) {
      try {
        const all = await fetchAllPages<Offer>('/api/offers', listParams);
        rowsOut = all.rows;
        if (all.capped) setExportNote(`Export capped at ${EXPORT_MAX_ROWS.toLocaleString()} of ${all.total.toLocaleString()} matching offers — narrow the filters to export the rest.`);
      } catch (e) {
        setExportNote(`Export failed: ${e instanceof Error ? e.message : 'request error'}`);
        return;
      }
    }
    const mapped = rowsOut.map((o) => ({
      id: o.ref ?? o.id, name: o.name, status: o.status, visibility: o.visibility ?? 'public',
      advertiser: offerAdvName(o), category: o.category ?? '', currency: o.currency,
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
            <SearchFieldSelect value={searchField} onChange={(v) => { setSearchField(v); resetView(); }} />
            <div className="relative max-sm:w-full">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-full sm:!w-56 !pl-8" placeholder={`Search by ${searchField}…`} value={nameQ} onChange={(e) => { setNameQ(e.target.value); resetView(); }} />
            </div>
            <StatusFilterSelect statuses={statuses} onChange={(v) => { setStatuses(v ? [v] : []); resetView(); }} />
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={(v) => { setSort(v); resetView(); }} />
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
              selectedIds={visibleSelected.map((o) => o.id)}
              columnOrder={columnOrder}
              hiddenColumns={hiddenColumns}
              onApplyColumns={(order, hidden) => { setColumnOrder(order); setHiddenColumns(hidden); }}
              onExport={(f) => { void exportRows(f); }}
              appliedFilters={{
                status: statuses.length ? statuses.join(',') : undefined, search: searchQ || undefined, searchField,
                offerName: offerNameQ || undefined,
                country: country || undefined, platform: platform || undefined,
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
      <ActiveFilterChips chips={chips} onRemove={removeChip} onClearAll={clearAll} className="mb-3" />
      <ExportNotice message={exportNote} onDismiss={() => setExportNote(null)} />
      {loading && !data ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !rows.length ? <StateBlock>{loading ? <Spinner /> : 'No offers match these filters.'}</StateBlock>
        : (
          <>
            <div className="mb-2 flex items-center gap-2 text-tiny text-fg-secondary">
              <input type="checkbox" className="chk" checked={allOnPageSelected} onChange={toggleAllOnPage} />
              {visibleSelected.length > 0 ? `${visibleSelected.length} selected on this page` : 'Select all on page'}
            </div>
            <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
              <Table columns={displayedColumns} rows={rows} rowKey={(o) => o.id} stickyCol={displayedColumns.findIndex((c) => c.header === 'Name')} />
            </div>
            <PagerFooter total={total} page={page} pageSize={PAGE_SIZE} onPage={goPage} loading={loading} />
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
              Only filters with a real backing field are shown. */}
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

          <FieldBlock label="Category">
            <select className="input" value={dCat} onChange={(e) => setDCat(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Country">
            <select className="input" value={dCountry} onChange={(e) => setDCountry(e.target.value)}>
              <option value="">All Countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">From each offer's geo rules and country targeting — an offer with no country rule matches every country.</p>
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

          <FieldBlock label="Platform">
            <select className="input" value={dPlatform} onChange={(e) => setDPlatform(e.target.value)}>
              <option value="">All Platforms</option>
              {platformOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">From each offer's platform targeting — an offer with no platform rule matches every platform.</p>
          </FieldBlock>

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
              {domainGroups.production.length > 0 && (
                <optgroup label="Production">
                  {domainGroups.production.map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
                </optgroup>
              )}
              {domainGroups.devOnly.length > 0 && (
                <optgroup label="Local Testing">
                  {domainGroups.devOnly.map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
                </optgroup>
              )}
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
