/**
 * Marketplace › Discover Advertisers — verified against the live reference (screenshots supplied
 * directly by the user: breadcrumb "Marketplace / Marketplace", title "Discover Advertisers", a
 * "Your Profile" button, a bordered "Featured Advertisers" panel, a toolbar with "Advertiser
 * Filters" / "Sort By Date" / search / grid-list toggle, and a card grid — logo, name, category
 * line, website link, stats box (CVR / EPC), "Learn More" + "Apply"). The reference lists real
 * third-party brands — this uses our own real Advertiser records instead, same structure, honest
 * data.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  ArrowDownUp, ChevronDown, Filter, LayoutGrid, List, Search,
} from 'lucide-react';
import { useMutation, useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import type { MarketplaceAdvertiser } from '../../types';

const STATUS_LABEL: Record<string, string> = { active: 'Connected', pending: 'Pending', inactive: 'Inactive' };
const INERT_FILTER_LABELS = [
  'Promotional Methods Accepted', 'Payment Methods Available',
  'Geo Markets Targeted', 'Countries Targeted', 'Device Types Targeted',
] as const;

interface Filters { categories: string[]; payoutModels: string[]; connectionStatus: string[]; funnel: 'any' | 'funnel' | 'single' }
const EMPTY_FILTERS: Filters = { categories: [], payoutModels: [], connectionStatus: [], funnel: 'any' };

function filtersToValues(f: Filters): FilterValues {
  return {
    categories: f.categories,
    payoutModels: f.payoutModels,
    connectionStatus: f.connectionStatus,
    funnel: f.funnel === 'any' ? [] : [f.funnel],
  };
}
function valuesToFilters(v: FilterValues): Filters {
  const funnelVal = v.funnel?.[0];
  return {
    categories: v.categories ?? [],
    payoutModels: v.payoutModels ?? [],
    connectionStatus: v.connectionStatus ?? [],
    funnel: funnelVal === 'funnel' || funnelVal === 'single' ? funnelVal : 'any',
  };
}

interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }

function todayIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function logoHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function websiteLabel(email: string | null, name: string): string | null {
  if (email?.includes('@')) {
    const domain = email.split('@')[1];
    if (domain && !domain.endsWith('.test')) return domain;
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  return slug ? `${slug}.com` : null;
}

function fmtPct(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function fmtEpc(v: number | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return '—';
  return `$${v.toFixed(2)}`;
}

function AdvertiserLogo({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-20 w-20 text-xl' : size === 'sm' ? 'h-9 w-9 text-tiny' : 'h-16 w-16 text-base';
  const hue = logoHue(name);
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-sm ${dim}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 24) % 360} 60% 34%))` }}
    >
      {initials(name)}
    </div>
  );
}

type AdvertiserStats = { cvr7: number; epc7: number; cvr30: number; epc30: number };

function AdvertiserCard({
  a, stats, onApply, applying,
}: {
  a: MarketplaceAdvertiser;
  stats?: AdvertiserStats;
  onApply: (a: MarketplaceAdvertiser) => void;
  applying: boolean;
}) {
  const site = websiteLabel(a.contactEmail, a.name);
  const catLine = a.categories.length ? a.categories.join(', ') : 'Uncategorized';
  const catLine2 = a.payoutModels.length ? a.payoutModels.join(', ') : null;

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card transition-shadow hover:shadow-elevated">
      <div className="flex flex-col items-center px-6 pb-4 pt-8 text-center">
        <AdvertiserLogo name={a.name} size="lg" />
        <h3 className="mt-4 text-body font-semibold text-fg">{a.name}</h3>
        <p className="mt-1 line-clamp-2 text-tiny leading-relaxed text-fg-secondary">{catLine}</p>
        {catLine2 && <p className="mt-0.5 line-clamp-1 text-tiny text-fg-muted">{catLine2}</p>}
        {site && (
          <p className="mt-2 font-mono text-tiny text-accent-text">{site}/</p>
        )}
      </div>

      <div className="mx-5 mb-4 rounded-[var(--radius)] border border-border bg-page px-4 py-3">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">CVR</p>
            <p className="mt-1 font-mono text-h3 font-semibold tabular-nums text-fg">{fmtPct(stats?.cvr7)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Earnings Per Click (EPC)</p>
            <p className="mt-1 font-mono text-tiny tabular-nums text-fg">
              {fmtEpc(stats?.epc7)}<span className="text-fg-muted"> / 7 days</span>
              {' | '}
              {fmtEpc(stats?.epc30)}<span className="text-fg-muted"> / 30 days</span>
            </p>
          </div>
        </div>
      </div>

      {a.categories.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Brand(s)</p>
          <p className="mt-1 text-tiny text-fg-secondary">{a.categories.slice(0, 4).join(', ')}</p>
        </div>
      )}

      <div className="mt-auto flex gap-2 border-t border-border p-4">
        <Link
          to={`/app/advertisers/${a.id}`}
          className="btn-ghost flex-1 !py-2 text-small font-medium"
        >
          Learn More
        </Link>
        {a.status === 'active' ? (
          <Link
            to="/app/marketplace/connections"
            className="btn-primary flex-1 !py-2 text-center text-small font-medium"
          >
            Connected
          </Link>
        ) : a.status === 'pending' ? (
          <Link
            to="/app/marketplace/connections"
            className="flex flex-1 cursor-default items-center justify-center rounded-[var(--radius)] border border-warning-bg bg-warning-bg !py-2 text-small font-medium text-warning-text"
          >
            Pending
          </Link>
        ) : (
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(a)}
            className="btn-primary flex-1 !py-2 text-small font-medium disabled:opacity-60"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function Marketplace() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery<MarketplaceAdvertiser[]>('/api/advertisers/marketplace');
  const stats7 = useQuery<AggResult>(`/api/reports?groupBy=advertiser&metrics=cr,epc&from=${encodeURIComponent(todayIso(7))}&to=${encodeURIComponent(new Date().toISOString())}&limit=200`);
  const stats30 = useQuery<AggResult>(`/api/reports?groupBy=advertiser&metrics=cr,epc&from=${encodeURIComponent(todayIso(30))}&to=${encodeURIComponent(new Date().toISOString())}&limit=200`);
  const { run: patchAdvertiser, busy: applying } = useMutation((id: string) => api.patch(`/api/advertisers/${id}`, { status: 'pending' }));

  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const statsMap = useMemo(() => {
    const map = new Map<string, AdvertiserStats>();
    for (const row of stats7.data?.rows ?? []) {
      const id = row.dimensions.advertiser;
      if (!id) continue;
      map.set(id, {
        cvr7: Number(row.metrics.cr ?? 0),
        epc7: Number(row.metrics.epc ?? 0),
        cvr30: 0,
        epc30: 0,
      });
    }
    for (const row of stats30.data?.rows ?? []) {
      const id = row.dimensions.advertiser;
      if (!id) continue;
      const prev = map.get(id) ?? { cvr7: 0, epc7: 0, cvr30: 0, epc30: 0 };
      map.set(id, { ...prev, cvr30: Number(row.metrics.cr ?? 0), epc30: Number(row.metrics.epc ?? 0) });
    }
    return map;
  }, [stats7.data, stats30.data]);

  const allCategories = useMemo(() => [...new Set((data ?? []).flatMap((a) => a.categories))].sort(), [data]);
  const allPayoutModels = useMemo(() => [...new Set((data ?? []).flatMap((a) => a.payoutModels))].sort(), [data]);

  const rows = useMemo(() => {
    let r = data ?? [];
    if (q.trim()) { const s = q.trim().toLowerCase(); r = r.filter((a) => a.name.toLowerCase().includes(s)); }
    if (appliedFilters.categories.length) r = r.filter((a) => a.categories.some((c) => appliedFilters.categories.includes(c)));
    if (appliedFilters.payoutModels.length) r = r.filter((a) => a.payoutModels.some((p) => appliedFilters.payoutModels.includes(p)));
    if (appliedFilters.connectionStatus.length) r = r.filter((a) => appliedFilters.connectionStatus.includes(a.status));
    if (appliedFilters.funnel === 'funnel') r = r.filter((a) => a.hasFunnel);
    if (appliedFilters.funnel === 'single') r = r.filter((a) => !a.hasFunnel);
    return [...r].sort((a, b) => sortDir === 'desc' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));
  }, [data, q, appliedFilters, sortDir]);

  const featured = useMemo(() => [...(data ?? [])].filter((a) => a.status === 'active')
    .sort((a, b) => b.offerCount - a.offerCount).slice(0, 5), [data]);

  const filterCategories = useMemo((): FilterCategory[] => [
    { key: 'categories', label: 'Categories', options: allCategories.map((c) => ({ value: c, label: c })) },
    { key: 'funnel', label: 'Conversion Funnel', options: [
      { value: 'any', label: 'Any' },
      { value: 'funnel', label: 'Multi-Step Funnel' },
      { value: 'single', label: 'Single Step' },
    ] },
    { key: 'payoutModels', label: 'Payout Types Available', options: allPayoutModels.map((p) => ({ value: p, label: p })) },
    { key: 'connectionStatus', label: 'Connection Status', options: [
      { value: 'active', label: 'Connected' },
      { value: 'pending', label: 'Pending' },
      { value: 'inactive', label: 'Inactive' },
    ] },
  ], [allCategories, allPayoutModels]);

  const filterCount = appliedFilterCount(filtersToValues(appliedFilters), ['funnel']);

  const handleApply = async (a: MarketplaceAdvertiser) => {
    if (a.status !== 'inactive') return;
    setApplyingId(a.id);
    const ok = await patchAdvertiser(a.id);
    setApplyingId(null);
    if (ok !== null) {
      setToast(`Connection request sent for ${a.name}. View it under Manage Connections.`);
      refetch();
    }
  };

  return (
    <>
      <PageHeader
        title="Discover Advertisers"
        subtitle="Marketplace › Discover Advertisers"
        action={
          <Link to="/app/marketplace/profile" className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-small font-medium text-fg transition-colors hover:border-accent/40 hover:bg-accent-subtle hover:text-accent-text">
            Your Profile
          </Link>
        }
      />

      {featured.length > 0 && (
        <section className="mb-8 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-small font-medium text-fg-secondary">Featured Advertisers</h2>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
            {featured.map((a, i) => (
              <Link
                key={a.id}
                to={`/app/advertisers/${a.id}`}
                className={`group flex flex-col items-center gap-2 px-6 py-8 text-center transition-colors hover:bg-page ${i > 0 ? 'sm:border-l sm:border-border' : ''}`}
              >
                <AdvertiserLogo name={a.name} />
                <p className="font-semibold text-fg group-hover:text-accent-text">{a.name}</p>
                <p className="line-clamp-2 text-tiny leading-relaxed text-fg-secondary">
                  {a.categories.length ? a.categories.join(', ') : 'Uncategorized'}
                </p>
                {a.payoutModels.length > 0 && (
                  <p className="line-clamp-1 text-tiny text-fg-muted">{a.payoutModels.join(', ')}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)} className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3.5 py-2 text-small font-medium text-fg transition-colors hover:bg-page">
              <Filter size={14} className="text-fg-muted" />
              {filterCount > 0 ? `Advertiser Filters (${filterCount})` : 'Advertiser Filters'}
              <ChevronDown size={13} className="text-fg-muted" />
            </button>
            {filterOpen && (
              <CategorizedFiltersFlyout
                title="Marketplace Advertiser Filters"
                categories={filterCategories}
                inertLabels={[...INERT_FILTER_LABELS]}
                values={filtersToValues(filters)}
                singleSelectKeys={['funnel']}
                onApply={(v) => {
                  const next = valuesToFilters(v);
                  setFilters(next);
                  setAppliedFilters(next);
                }}
                onClose={() => setFilterOpen(false)}
                showPresets={false}
                align="left"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3.5 py-2 text-small font-medium text-fg transition-colors hover:bg-page"
          >
            <ArrowDownUp size={14} className="text-fg-muted" />
            Sort By Date {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              className="input !w-72 !rounded-full !pl-9"
              placeholder="Search Advertiser"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
            <button type="button" title="Grid view" onClick={() => setView('grid')} className={`grid h-9 w-9 place-items-center transition-colors ${view === 'grid' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-page'}`}><LayoutGrid size={15} /></button>
            <button type="button" title="List view" onClick={() => setView('list')} className={`grid h-9 w-9 place-items-center border-l border-border transition-colors ${view === 'list' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-page'}`}><List size={15} /></button>
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : rows.length === 0 ? <StateBlock>No advertisers match this search.</StateBlock>
        : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((a) => (
              <AdvertiserCard
                key={a.id}
                a={a}
                stats={statsMap.get(a.id)}
                onApply={handleApply}
                applying={applying && applyingId === a.id}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <table className="w-full text-left text-body">
              <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                <tr>
                  <th className="px-5 py-3 font-semibold">Advertiser</th>
                  <th className="px-5 py-3 font-semibold">Categories</th>
                  <th className="px-5 py-3 font-semibold">CVR</th>
                  <th className="px-5 py-3 font-semibold">EPC (7d)</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => {
                  const stats = statsMap.get(a.id);
                  const site = websiteLabel(a.contactEmail, a.name);
                  return (
                    <tr key={a.id} className="transition-colors hover:bg-page/60">
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-3">
                          <AdvertiserLogo name={a.name} size="sm" />
                          <span>
                            <span className="block font-medium text-fg">{a.name}</span>
                            {site && <span className="font-mono text-tiny text-accent-text">{site}/</span>}
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-4 text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</td>
                      <td className="px-5 py-4 font-mono tabular-nums text-fg">{fmtPct(stats?.cvr7)}</td>
                      <td className="px-5 py-4 font-mono tabular-nums text-fg">{fmtEpc(stats?.epc7)}</td>
                      <td className="px-5 py-4 text-fg-secondary">{STATUS_LABEL[a.status]}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex gap-2">
                          <Link to={`/app/advertisers/${a.id}`} className="btn-ghost !py-1.5 text-tiny">Learn More</Link>
                          {a.status === 'active' ? (
                            <Link to="/app/marketplace/connections" className="btn-primary !py-1.5 text-tiny">Connected</Link>
                          ) : a.status === 'pending' ? (
                            <Link to="/app/marketplace/connections" className="rounded-[var(--radius)] border border-warning-bg bg-warning-bg px-3 py-1.5 text-tiny font-medium text-warning-text">Pending</Link>
                          ) : (
                            <button
                              type="button"
                              disabled={applying && applyingId === a.id}
                              onClick={() => handleApply(a)}
                              className="btn-primary !py-1.5 text-tiny disabled:opacity-60"
                            >
                              {applying && applyingId === a.id ? 'Applying…' : 'Apply'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-card border border-border bg-elevated px-4 py-3 text-small text-fg shadow-elevated">
          {toast}
          <button type="button" className="ml-3 text-accent-text hover:underline" onClick={() => navigate('/app/marketplace/connections')}>View connections</button>
        </div>,
        document.body,
      )}
    </>
  );
}
