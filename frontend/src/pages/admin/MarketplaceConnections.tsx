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
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { useMutation, useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { CategorizedFiltersFlyout, FilterButton, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import type { MarketplaceAdvertiser } from '../../types';

const DASH = '—';
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

type Tab = 'connected' | 'awaiting' | 'pending';
interface Filters { categories: string[]; payoutModels: string[] }
const EMPTY_FILTERS: Filters = { categories: [], payoutModels: [] };

function filtersToValues(f: Filters): FilterValues {
  return { categories: f.categories, payoutModels: f.payoutModels };
}
function valuesToFilters(v: FilterValues): Filters {
  return { categories: v.categories ?? [], payoutModels: v.payoutModels ?? [] };
}

const INERT_FILTER_LABELS = ['Promotional Methods', 'Regions'] as const;

const PAGE_SIZE = 25;

function AdvertiserLogo({ name }: { name: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return (
    <span
      className="grid h-8 w-8 place-items-center rounded-full text-tiny font-semibold text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 24) % 360} 60% 34%))` }}
    >
      {initials}
    </span>
  );
}

function ContactCell({ email }: { email: string | null }) {
  if (!email) return <span className="text-fg-muted">{DASH}</span>;
  return <a href={`mailto:${email}`} className="text-accent-text hover:underline">{email}</a>;
}

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
  const [toast, setToast] = useState<string | null>(null);
  const { run: patchStatus, busy } = useMutation((args: { id: string; status: 'active' | 'inactive' }) =>
    api.patch(`/api/advertisers/${args.id}`, { status: args.status }));

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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

  const decide = async (id: string, status: 'active' | 'inactive', name: string) => {
    const r = await patchStatus({ id, status });
    if (r) {
      setToast(status === 'active' ? `Approved ${name}. Moved to Connected Advertisers.` : `Rejected ${name}.`);
      refetch();
    } else {
      setToast(`Could not update ${name}. Try again.`);
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'connected', label: 'Connected Advertisers' },
    { key: 'awaiting', label: 'Awaiting Your Approval' },
    { key: 'pending', label: 'Pending Approval' },
  ];
  const filterCount = appliedFilterCount(filtersToValues(appliedFilters));
  const filterCategories = useMemo((): FilterCategory[] => [
    { key: 'categories', label: 'Categories', options: allCategories.map((c) => ({ value: c, label: c })) },
    { key: 'payoutModels', label: 'Payout Types', options: allPayoutModels.map((p) => ({ value: p, label: p })) },
  ], [allCategories, allPayoutModels]);

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
          <FilterButton count={filterCount} onClick={() => setFilterOpen((o) => !o)} title="Table Filters" />
          {filterOpen && (
            <CategorizedFiltersFlyout
              title="Table Filters"
              categories={filterCategories}
              inertLabels={[...INERT_FILTER_LABELS]}
              values={filtersToValues(filters)}
              onApply={(v) => applyFilters(valuesToFilters(v))}
              onClose={() => setFilterOpen(false)}
              showPresets={false}
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
          ) : <StateBlock>
            No Record Found
            {tab === 'connected' && (
              <p className="mt-2 text-tiny text-fg-muted">
                Active advertisers appear here. Approve pending requests on the Awaiting tab, or browse{' '}
                <Link to="/app/marketplace" className="text-accent-text hover:underline">Discover Advertisers</Link>.
              </p>
            )}
            {tab === 'awaiting' && (
              <p className="mt-2 text-tiny text-fg-muted">
                When someone applies from{' '}
                <Link to="/app/marketplace" className="text-accent-text hover:underline">Discover Advertisers</Link>, they appear here for approval.
              </p>
            )}
          </StateBlock>
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
                    <td className="px-4 py-3"><AdvertiserLogo name={a.name} /></td>
                    <td className="px-4 py-3"><Link to={`/app/advertisers/${a.id}`} className="text-accent-text hover:underline">{a.name}</Link></td>
                    <td className="px-4 py-3 text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</td>
                    <td className="px-4 py-3 text-fg-secondary">{a.offerCount}</td>
                    <td className="px-4 py-3 text-fg-secondary">{fmtDate(a.createdAt)}</td>
                    <td className="px-4 py-3"><ContactCell email={a.contactEmail} /></td>
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
                    <td className="px-4 py-3"><AdvertiserLogo name={a.name} /></td>
                    <td className="px-4 py-3 text-fg">{a.name}</td>
                    <td className="px-4 py-3"><Link to={`/app/advertisers/${a.id}`} className="text-accent-text hover:underline">View Profile</Link></td>
                    <td className="px-4 py-3 text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</td>
                    <td className="px-4 py-3"><ContactCell email={a.contactEmail} /></td>
                    <td className="px-4 py-3 text-fg-muted">{DASH}</td>
                    <td className="px-4 py-3 text-fg-muted">{DASH}</td>
                    <td className="px-4 py-3 text-fg-secondary">{fmtDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button type="button" disabled={busy} onClick={() => decide(a.id, 'active', a.name)} className="btn-primary !py-1.5 text-tiny disabled:opacity-50">Approve</button>
                        <button type="button" disabled={busy} onClick={() => decide(a.id, 'inactive', a.name)} className="rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-tiny font-medium text-fg hover:bg-accent-subtle disabled:opacity-50">Reject</button>
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

      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-card border border-border bg-elevated px-4 py-3 text-small text-fg shadow-elevated">
          {toast}
        </div>,
        document.body,
      )}
    </>
  );
}
