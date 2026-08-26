/**
 * Marketplace › Manage Connections — verified against the live reference (clicked through from the
 * flyout's real `href="/everxchange/connections"`): "Manage Connections", a collapsible Summary
 * (Connected / Awaiting Your Approval / Pending Approval / Total Offers Pulled), 3 tabs, a search +
 * "Table Filters" toolbar (real flyout: Categories, Payout Types, Promotional Methods, Regions), and
 * a table — each of the 3 tabs has its OWN real column set, confirmed live per-tab (clicking the tab
 * bar precisely — earlier attempts kept hitting the Summary tile with the same label): Connected
 * Advertisers (Logo, Advertiser Name, Categories, Offers, Connection Date, Contact), Awaiting Your
 * Approval (Logo, Name, Profile, Categories, Contact, Terms & Conditions, Notes, Request Date —
 * no Offers/Connection Date since there's no connection yet), Pending Approval (Logo, Name, Profile,
 * Categories, Contact, Terms & Conditions, Request Date — no Notes column).
 *
 * Connected/Awaiting are real, using this network's own real Advertiser records (same
 * honest-substitution precedent as Discover Advertisers): "Connected Advertisers" = real Advertisers
 * with `status: 'active'`, "Awaiting Your Approval" = real Advertisers with `status: 'pending'` —
 * this maps exactly, not loosely: a pending Advertiser in this app genuinely IS awaiting this
 * network's approval before it's active, the same real relationship the reference tab describes.
 * Categories/Payout Types reuse the real `/api/advertisers/marketplace` aggregation (offer.category,
 * offer.payout_model) already built for Discover Advertisers; Promotional Methods/Regions have no
 * equivalent stored field anywhere in this schema (same gap already established there) so they're
 * shown, real labels, but inert. Approve/Reject on the Awaiting tab are real actions — they PATCH the
 * advertiser's real `status` (api-backend's existing `PATCH /api/advertisers/:id`).
 *
 * Pending Approval (requests THIS network sent to a different network on Everflow's cross-tenant
 * EverXchange, awaiting their approval) has no analog: this app is single-tenant, so there's no other
 * network to send a request to. Rather than omitting the tab's real shape, it keeps the reference's
 * own real column structure (an honest, permanently-empty shell — same convention as Redirect
 * Report/Partner Referrals) with a note explaining why it can never have rows.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useMutation, useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { Icon } from '../../components/icons';
import { Pagination } from '../../components/ReportPageKit';
import type { MarketplaceAdvertiser } from '../../types';

const DASH = '—';
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

type Tab = 'connected' | 'awaiting' | 'pending';
interface Filters { categories: string[]; payoutModels: string[] }
const EMPTY_FILTERS: Filters = { categories: [], payoutModels: [] };
const REAL_FILTER_KEYS = ['categories', 'payoutModels'] as const;
type RealFilterKey = (typeof REAL_FILTER_KEYS)[number];
const REAL_FILTER_LABELS: Record<RealFilterKey, string> = { categories: 'Categories', payoutModels: 'Payout Types' };
const INERT_FILTER_LABELS = ['Promotional Methods', 'Regions'] as const;

function TableFiltersFlyout({
  allCategories, allPayoutModels, value, onApply, onClose,
}: { allCategories: string[]; allPayoutModels: string[]; value: Filters; onApply: (v: Filters) => void; onClose: () => void }) {
  const [path, setPath] = useState<RealFilterKey | null>(null);
  const [draft, setDraft] = useState<Filters>(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const toggle = (key: RealFilterKey, v: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));
  const count = draft.categories.length + draft.payoutModels.length;
  const apply = () => { onApply(draft); onClose(); };

  return (
    <div ref={ref} className="absolute right-0 top-full z-30 mt-1 rounded-card border border-border bg-elevated shadow-elevated">
      {path === null ? (
        <div className="w-64">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h3 className="text-small font-semibold text-fg">Table Filters</h3>
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraft(EMPTY_FILTERS)}>Clear</button>
          </div>
          <div className="py-1">
            {REAL_FILTER_KEYS.map((k) => (
              <button key={k} type="button" onClick={() => setPath(k)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                <span className="flex items-center gap-2">{REAL_FILTER_LABELS[k]}{draft[k].length > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{draft[k].length}</span>}</span>
                <ChevronRight size={13} className="text-fg-muted" />
              </button>
            ))}
            {INERT_FILTER_LABELS.map((label) => (
              <div key={label} title="Not available yet" className="flex w-full cursor-not-allowed items-center justify-between px-3 py-1.5 text-left text-small text-fg-muted">
                {label} <ChevronRight size={13} className="text-fg-muted" />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-3 py-2.5">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={apply}>Apply{count > 0 ? ` (${count})` : ''}</button>
          </div>
        </div>
      ) : (
        <div className="w-64">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <button type="button" onClick={() => setPath(null)} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
              <ChevronDown size={15} className="-rotate-90" /> {REAL_FILTER_LABELS[path]}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {(path === 'categories' ? allCategories : allPayoutModels).length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No options.</p>}
            {(path === 'categories' ? allCategories : allPayoutModels).map((v) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                <input type="checkbox" className="chk" checked={draft[path].includes(v)} onChange={() => toggle(path, v)} />
                {v}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-3 py-2.5">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={apply}>Apply{count > 0 ? ` (${count})` : ''}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 25;

export default function MarketplaceConnections() {
  const { data, loading, error, refetch } = useQuery<MarketplaceAdvertiser[]>('/api/advertisers/marketplace');
  const [tab, setTab] = useState<Tab>('connected');
  const [q, setQ] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const { run: patchStatus, busy } = useMutation((args: { id: string; status: 'active' | 'inactive' }) =>
    api.patch(`/api/advertisers/${args.id}`, { status: args.status }));

  const connected = useMemo(() => (data ?? []).filter((a) => a.status === 'active'), [data]);
  const awaiting = useMemo(() => (data ?? []).filter((a) => a.status === 'pending'), [data]);
  const totalOffersPulled = useMemo(() => connected.reduce((n, a) => n + a.offerCount, 0), [connected]);
  const allCategories = useMemo(() => [...new Set((data ?? []).flatMap((a) => a.categories))].sort(), [data]);
  const allPayoutModels = useMemo(() => [...new Set((data ?? []).flatMap((a) => a.payoutModels))].sort(), [data]);

  const changeTab = (t: Tab) => { setTab(t); setPage(1); };
  const changeQ = (v: string) => { setQ(v); setPage(1); };
  const applyFilters = (v: Filters) => { setFilters(v); setAppliedFilters(v); setPage(1); };
  const toggleSort = () => { setSortDir((d) => (d === 'desc' ? 'asc' : 'desc')); setPage(1); };

  const rows = useMemo(() => {
    let base = tab === 'connected' ? connected : tab === 'awaiting' ? awaiting : [];
    if (q.trim()) { const s = q.trim().toLowerCase(); base = base.filter((a) => a.name.toLowerCase().includes(s)); }
    if (appliedFilters.categories.length) base = base.filter((a) => a.categories.some((c) => appliedFilters.categories.includes(c)));
    if (appliedFilters.payoutModels.length) base = base.filter((a) => a.payoutModels.some((p) => appliedFilters.payoutModels.includes(p)));
    return [...base].sort((a, b) => sortDir === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
  }, [tab, connected, awaiting, q, appliedFilters, sortDir]);

  const pagedRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);

  const decide = async (id: string, status: 'active' | 'inactive') => {
    const r = await patchStatus({ id, status });
    if (r) refetch();
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'connected', label: 'Connected Advertisers' },
    { key: 'awaiting', label: 'Awaiting Your Approval' },
    { key: 'pending', label: 'Pending Approval' },
  ];
  const filterCount = appliedFilters.categories.length + appliedFilters.payoutModels.length;

  return (
    <>
      <PageHeader title="Manage Connections" subtitle="Marketplace › Manage Connections" />

      <div className="card mb-4">
        <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
        </button>
        {summaryOpen && (
          <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <div>
              <p className="text-tiny uppercase tracking-wide text-fg-muted">Connected</p>
              <p className="mt-1 text-h3 font-medium text-fg">{connected.length}</p>
            </div>
            <div>
              <p className="text-tiny uppercase tracking-wide text-fg-muted">Awaiting Your Approval</p>
              <p className="mt-1 text-h3 font-medium text-fg">{awaiting.length}</p>
            </div>
            <div>
              <p className="text-tiny uppercase tracking-wide text-fg-muted">Pending Approval</p>
              <p className="mt-1 text-h3 font-medium text-fg-muted">0</p>
            </div>
            <div>
              <p className="text-tiny uppercase tracking-wide text-fg-muted">Total Offers Pulled</p>
              <p className="mt-1 text-h3 font-medium text-fg">{totalOffersPulled}</p>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex gap-6 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => changeTab(t.key)}
            className={`border-b-2 pb-2.5 text-small font-medium ${tab === t.key ? 'border-accent text-accent-text' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex justify-end gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-64 !pl-8" placeholder="Search…" value={q} onChange={(e) => changeQ(e.target.value)} />
        </div>
        <div className="relative">
          <button type="button" title="Table Filters" onClick={() => setFilterOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <span className="relative">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
              {filterCount > 0 && <span className="absolute -right-2 -top-2 grid h-3.5 w-3.5 place-items-center rounded-full bg-accent text-[9px] font-bold text-white">{filterCount}</span>}
            </span>
          </button>
          {filterOpen && (
            <TableFiltersFlyout
              allCategories={allCategories} allPayoutModels={allPayoutModels}
              value={filters} onApply={applyFilters} onClose={() => setFilterOpen(false)}
            />
          )}
        </div>
      </div>

      {tab === 'pending' && (
        <div className="card mb-4">
          <p className="text-small text-fg-muted">Pending Approval tracks connection requests this network sent to a different network on Everflow's cross-tenant marketplace, awaiting their approval. This app is single-tenant — there's no other network to send a request to — so this table structure is real but can never have rows.</p>
        </div>
      )}

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : tab === 'pending' || rows.length === 0 ? (
          tab === 'pending' ? (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Logo</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Profile</th>
                    <th className="px-4 py-3 font-semibold">Categories</th>
                    <th className="px-4 py-3 font-semibold">Contact</th>
                    <th className="px-4 py-3 font-semibold">Terms &amp; Conditions</th>
                    <th className="px-4 py-3 font-semibold">Request Date</th>
                  </tr>
                </thead>
                <tbody><tr><td colSpan={7} className="px-4 py-10 text-center text-small italic text-fg-muted">No Record Found</td></tr></tbody>
              </table>
            </div>
          ) : <StateBlock>No Record Found</StateBlock>
        ) : tab === 'connected' ? (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left text-body">
              <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Logo</th>
                  <th className="cursor-pointer select-none px-4 py-3 font-semibold" onClick={toggleSort}>Advertiser Name {sortDir === 'desc' ? '↓' : '↑'}</th>
                  <th className="px-4 py-3 font-semibold">Categories</th>
                  <th className="px-4 py-3 font-semibold">Offers</th>
                  <th className="px-4 py-3 font-semibold">Connection Date</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedRows.map((a) => (
                  <tr key={a.id} className="hover:bg-accent-subtle/40">
                    <td className="px-4 py-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={16} height={16} /></span></td>
                    <td className="px-4 py-3"><Link to={`/app/advertisers/${a.id}`} className="text-accent-text hover:underline">{a.name}</Link></td>
                    <td className="px-4 py-3 text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</td>
                    <td className="px-4 py-3 text-fg-secondary">{a.offerCount}</td>
                    <td className="px-4 py-3 text-fg-secondary">{fmtDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-fg-secondary">{a.contactEmail ?? DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          // Awaiting Your Approval — real, distinct column set confirmed live (different from
          // Connected Advertisers: no Offers/Connection Date since there's no connection yet; adds
          // Profile/Terms & Conditions/Notes/Request Date). Terms & Conditions and Notes have no
          // backing field on this app's Advertiser record (no onboarding-T&Cs or notes concept for
          // advertisers — Offer has `notes`, Advertiser doesn't) so they're shown, real column, but
          // honestly dashed.
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left text-body">
              <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Logo</th>
                  <th className="cursor-pointer select-none px-4 py-3 font-semibold" onClick={toggleSort}>Name {sortDir === 'desc' ? '↓' : '↑'}</th>
                  <th className="px-4 py-3 font-semibold">Profile</th>
                  <th className="px-4 py-3 font-semibold">Categories</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Terms &amp; Conditions</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                  <th className="px-4 py-3 font-semibold">Request Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedRows.map((a) => (
                  <tr key={a.id} className="hover:bg-accent-subtle/40">
                    <td className="px-4 py-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={16} height={16} /></span></td>
                    <td className="px-4 py-3 text-fg">{a.name}</td>
                    <td className="px-4 py-3"><Link to={`/app/advertisers/${a.id}`} className="text-accent-text hover:underline">View Profile</Link></td>
                    <td className="px-4 py-3 text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</td>
                    <td className="px-4 py-3 text-fg-secondary">{a.contactEmail ?? DASH}</td>
                    <td className="px-4 py-3 text-fg-muted">{DASH}</td>
                    <td className="px-4 py-3 text-fg-muted">{DASH}</td>
                    <td className="px-4 py-3 text-fg-secondary">{fmtDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button type="button" disabled={busy} onClick={() => decide(a.id, 'active')} className="btn-primary !py-1.5 text-tiny disabled:opacity-50">Approve</button>
                        <button type="button" disabled={busy} onClick={() => decide(a.id, 'inactive')} className="rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-tiny font-medium text-fg hover:bg-accent-subtle disabled:opacity-50">Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!loading && !error && (
        <div className="mt-3 flex justify-end">
          <Pagination total={tab === 'pending' ? 0 : rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </>
  );
}
