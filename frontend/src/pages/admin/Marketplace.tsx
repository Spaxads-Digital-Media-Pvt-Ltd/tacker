/**
 * Marketplace › Discover Advertisers — verified against the live reference (screenshots supplied
 * directly by the user: breadcrumb "Marketplace / Marketplace", title "Discover Advertisers", a
 * "Your Profile" button, a bordered "Featured Advertisers" panel, a toolbar with "Advertiser
 * Filters" / "Sort By Date" / search / grid-list toggle, and a card grid — logo, name, category
 * line, website link, "Learn More" + "Apply"). The reference lists real third-party brands (Roman
 * Health Ventures, BlueChew, Evite Inc., …) — reproducing those names/logos here would misrepresent
 * them as partners of this app, so this uses our own real Advertiser records instead, same
 * structure, honest data (matches the precedent already set for the sibling "Discover Partners"-
 * style substitution used elsewhere in this app).
 *
 * The reference's "Advertiser Filters" flyout has 9 categories (Categories, Conversion Funnel,
 * Promotional Methods Accepted, Payment Methods Available, Payout Types Available, Geo Markets
 * Targeted, Countries Targeted, Device Types Targeted, Connection Status — captured live in a
 * user-supplied screenshot, "Categories" submenu expanded showing a real vertical taxonomy: Adult &
 * Dating, Assistive Care, Beauty & Personal Care, Education & Career, Electronics, Entertainment &
 * Gaming, Fashion & Shopping, Financial Growth & Investments, …). Backed here via a new endpoint
 * (GET /api/advertisers/marketplace, api-backend/.../advertisers/routes.ts) that aggregates real
 * columns per advertiser: Categories (offers.category), Payout Types Available
 * (offers.payout_model), Conversion Funnel (an offer with >1 real goal — offer_goals, spec
 * feature-depth multi-goal offers), Connection Status (advertisers.status). Promotional Methods
 * Accepted / Payment Methods Available / Geo Markets Targeted / Countries Targeted / Device Types
 * Targeted have no equivalent stored field anywhere in this schema (offers carry no targeting
 * config — the only `countries` column in the whole schema belongs to `offer_forwarding_rules`,
 * which is never enforced, see RedirectReport.tsx) — those 5 categories are shown, real labels, but
 * inert ("Not available yet"), rather than fabricating values. Advertisers have no website/logo
 * field, so those reference elements are omitted rather than invented.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, LayoutGrid, List, MessageSquare, Search } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { Icon } from '../../components/icons';
import type { MarketplaceAdvertiser } from '../../types';

const REAL_FILTER_CATEGORIES = [
  { key: 'categories', label: 'Categories' },
  { key: 'funnel', label: 'Conversion Funnel' },
  { key: 'payoutModels', label: 'Payout Types Available' },
  { key: 'connectionStatus', label: 'Connection Status' },
] as const;
type RealFilterKey = (typeof REAL_FILTER_CATEGORIES)[number]['key'];
const INERT_FILTER_LABELS = [
  'Promotional Methods Accepted', 'Payment Methods Available',
  'Geo Markets Targeted', 'Countries Targeted', 'Device Types Targeted',
] as const;

const STATUS_LABEL: Record<string, string> = { active: 'Connected', pending: 'Pending', inactive: 'Inactive' };
const FUNNEL_LABEL: Record<string, string> = { any: 'Any', funnel: 'Multi-Step Funnel', single: 'Single Step' };

interface Filters { categories: string[]; payoutModels: string[]; connectionStatus: string[]; funnel: 'any' | 'funnel' | 'single' }
const EMPTY_FILTERS: Filters = { categories: [], payoutModels: [], connectionStatus: [], funnel: 'any' };

function AdvertiserFiltersFlyout({
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

  const toggle = (key: 'categories' | 'payoutModels' | 'connectionStatus', v: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));

  const count = draft.categories.length + draft.payoutModels.length + draft.connectionStatus.length + (draft.funnel !== 'any' ? 1 : 0);
  const apply = () => { onApply(draft); onClose(); };

  return (
    <div ref={ref} className="absolute left-0 top-full z-30 mt-1 rounded-card border border-border bg-elevated shadow-elevated">
      {path === null ? (
        <div className="w-72">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h3 className="text-small font-semibold text-fg">Marketplace Advertiser Filters</h3>
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraft(EMPTY_FILTERS)}>Clear</button>
          </div>
          <div className="py-1">
            {REAL_FILTER_CATEGORIES.map((c) => {
              const n = c.key === 'categories' ? draft.categories.length : c.key === 'payoutModels' ? draft.payoutModels.length
                : c.key === 'connectionStatus' ? draft.connectionStatus.length : (draft.funnel !== 'any' ? 1 : 0);
              return (
                <button key={c.key} type="button" onClick={() => setPath(c.key)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                  <span className="flex items-center gap-2">{c.label}{n > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{n}</span>}</span>
                  <ChevronRight size={13} className="text-fg-muted" />
                </button>
              );
            })}
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
      ) : path === 'categories' || path === 'payoutModels' ? (
        <div className="w-72">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <button type="button" onClick={() => setPath(null)} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
              <ChevronDown size={15} className="-rotate-90" /> {REAL_FILTER_CATEGORIES.find((c) => c.key === path)?.label}
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
      ) : path === 'connectionStatus' ? (
        <div className="w-64">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <button type="button" onClick={() => setPath(null)} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
              <ChevronDown size={15} className="-rotate-90" /> Connection Status
            </button>
          </div>
          <div className="py-1">
            {(['active', 'pending', 'inactive'] as const).map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                <input type="checkbox" className="chk" checked={draft.connectionStatus.includes(s)} onChange={() => toggle('connectionStatus', s)} />
                {STATUS_LABEL[s]}
              </label>
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
              <ChevronDown size={15} className="-rotate-90" /> Conversion Funnel
            </button>
          </div>
          <div className="py-1">
            {(['any', 'funnel', 'single'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setDraft((d) => ({ ...d, funnel: f }))}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${draft.funnel === f ? 'text-accent-text' : 'text-fg'}`}>
                {draft.funnel === f && '✓'} {FUNNEL_LABEL[f]}
              </button>
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

export default function Marketplace() {
  const { data, loading, error } = useQuery<MarketplaceAdvertiser[]>('/api/advertisers/marketplace');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

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
    .sort((a, b) => b.offerCount - a.offerCount).slice(0, 4), [data]);

  const filterCount = appliedFilters.categories.length + appliedFilters.payoutModels.length + appliedFilters.connectionStatus.length + (appliedFilters.funnel !== 'any' ? 1 : 0);

  return (
    <>
      <PageHeader title="Discover Advertisers" subtitle="Marketplace › Discover Advertisers" action={
        <button title="Not available yet" className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-small font-medium text-fg-muted">Your Profile</button>
      } />

      {featured.length > 0 && (
        <div className="mb-6 rounded-card border-2 border-fg p-6">
          <h3 className="mb-4 text-h3 font-medium text-fg">Featured Advertisers</h3>
          <div className="grid grid-cols-1 gap-6 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            {featured.map((a) => (
              <Link key={a.id} to={`/app/advertisers/${a.id}`} className="flex flex-col items-center gap-2 pt-4 text-center first:pt-0 sm:pt-0 sm:first:pl-0 sm:[&:not(:first-child)]:pl-6">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={26} height={26} /></div>
                <p className="font-semibold text-fg">{a.name}</p>
                <p className="text-tiny text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)} className="btn-ghost flex items-center gap-1.5">
              {filterCount > 0 ? `Advertiser Filters (${filterCount})` : 'Advertiser Filters'} <ChevronDown size={13} className="text-fg-muted" />
            </button>
            {filterOpen && (
              <AdvertiserFiltersFlyout
                allCategories={allCategories} allPayoutModels={allPayoutModels}
                value={filters}
                onApply={(v) => { setFilters(v); setAppliedFilters(v); }}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
          <button type="button" onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))} className="btn-ghost">
            Sort By Date {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-64 !pl-8" placeholder="Search Advertiser…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
            <button type="button" title="Grid view" onClick={() => setView('grid')} className={`grid h-9 w-9 place-items-center ${view === 'grid' ? 'bg-accent-subtle text-accent-text' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}><LayoutGrid size={15} /></button>
            <button type="button" title="List view" onClick={() => setView('list')} className={`grid h-9 w-9 place-items-center ${view === 'list' ? 'bg-accent-subtle text-accent-text' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}><List size={15} /></button>
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : rows.length === 0 ? <StateBlock>No advertisers match this search.</StateBlock>
        : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((a) => (
              <div key={a.id} className="card flex flex-col items-center gap-2 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={26} height={26} /></div>
                <p className="font-medium text-fg">{a.name}</p>
                <p className="min-h-[1.2em] text-tiny text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</p>
                <div className="mt-2 flex w-full gap-2">
                  <Link to={`/app/advertisers/${a.id}`} className="btn-ghost flex-1 !py-1.5 text-tiny">Learn More</Link>
                  <button title="Not available yet" className="flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border bg-surface !py-1.5 text-tiny text-fg-muted">
                    <MessageSquare size={13} /> Apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-border">
            <table className="w-full text-left text-body">
              <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                <tr><th className="px-4 py-3 font-semibold">Advertiser</th><th className="px-4 py-3 font-semibold">Categories</th><th className="px-4 py-3 font-semibold">Connection Status</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-accent-subtle/40">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={16} height={16} /></span>
                        {a.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg-secondary">{a.categories.length ? a.categories.join(', ') : 'Uncategorized'}</td>
                    <td className="px-4 py-3 text-fg-secondary">{STATUS_LABEL[a.status]}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Link to={`/app/advertisers/${a.id}`} className="btn-ghost !py-1.5 text-tiny">Learn More</Link>
                        <button title="Not available yet" className="cursor-not-allowed rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-tiny text-fg-muted">Apply</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
