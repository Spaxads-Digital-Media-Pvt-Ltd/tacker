/**
 * Control Center › Segmentations. Categories and Channels are derived from real data already in
 * this app (Offer.category, Publisher.trafficSource) — the names are genuine, not fabricated, but
 * there's no dedicated categories/channels table, so columns like Status/Created/Offers that we
 * can't back honestly render as "—" rather than invented values. Labels reuses the real tags
 * backend (/api/tags, same as Offers/Partners/Advertisers "Tags"), same caveat for usage counts.
 * Business Unit has no backing concept anywhere, so it's a pure honest shell.
 */
import { useState, type ReactNode } from 'react';
import { Search, MoreVertical, ChevronDown, Pencil } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { StateBlock, Spinner, Tabs } from '../../../components/ui';
import type { Offer, Publisher } from '../../../types';

const SUB_TABS = ['Categories', 'Channels', 'Labels', 'Business Unit'] as const;

function Toolbar({ addLabel, status, moreVertical }: { addLabel: string; status?: string; moreVertical?: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <button title="Not available yet" className="btn-primary">+ {addLabel}</button>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input title="Not available yet" placeholder="Search…" className="input !w-56 !pl-8" />
        </div>
        {status && (
          <button title="Not available yet" className="input flex !w-auto items-center gap-2 !py-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" />{status}<ChevronDown size={14} className="text-fg-muted" />
          </button>
        )}
        {moreVertical && <button title="Not available yet" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>}
      </div>
    </div>
  );
}

function SegTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[640px] text-left text-body">
        <thead className="bg-page text-tiny uppercase tracking-wide text-fg-secondary">
          <tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function CategoriesSub() {
  const { data, loading } = useQuery<Offer[]>('/api/offers');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const names = [...new Set((data ?? []).map((o) => o.category).filter((c): c is string => !!c))].sort();
  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">Facilitate search and reporting of grouped Offers by assigning categories. This will be visible internally and externally by Partners.</p>
      <Toolbar addLabel="Category" status="Active" />
      {names.length === 0 ? (
        <p className="rounded-card border border-dashed border-border py-10 text-center text-small italic text-fg-muted">No categories found on any offer yet.</p>
      ) : (
        <SegTable columns={['ID', 'Name', 'Status', 'Created', 'Modified', '']}>
          {names.map((name) => (
            <tr key={name} className="bg-surface text-fg">
              <td className="px-4 py-3 text-fg-secondary">—</td>
              <td className="px-4 py-3 font-medium">{name}</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-right">
                <button title="Not available yet" className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Pencil size={14} /></button>
              </td>
            </tr>
          ))}
        </SegTable>
      )}
      <p className="mt-2 text-tiny text-fg-muted">Derived from each offer's own Category field — there's no separate categories table, so Status/Created/Modified aren't tracked.</p>
    </div>
  );
}

function ChannelsSub() {
  const { data, loading } = useQuery<Publisher[]>('/api/publishers');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const names = [...new Set((data ?? []).map((p) => p.trafficSource).filter((c): c is string => !!c))].sort();
  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">Assign tags to identify types of traffic sources at the Partner Level.</p>
      <Toolbar addLabel="Channel" status="Active" moreVertical />
      {names.length === 0 ? (
        <p className="rounded-card border border-dashed border-border py-10 text-center text-small italic text-fg-muted">No traffic sources found on any partner yet.</p>
      ) : (
        <SegTable columns={['Name', 'Offers', 'Created', 'Modified', '']}>
          {names.map((name) => (
            <tr key={name} className="bg-surface text-fg">
              <td className="px-4 py-3 font-medium"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-success" />{name}</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-right">
                <button title="Not available yet" className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
              </td>
            </tr>
          ))}
        </SegTable>
      )}
      <p className="mt-2 text-tiny text-fg-muted">Derived from each partner's own Traffic Source field — there's no separate channels table, so Offers/Created/Modified aren't tracked.</p>
    </div>
  );
}

interface Tag { id: string; name: string; color: string | null }

function LabelsSub() {
  const { data, loading } = useQuery<Tag[]>('/api/tags');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const tags = data ?? [];
  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">Set custom tags to link with a Partner, Advertiser, or Offer for internal reporting, searching, or filtering.</p>
      <Toolbar addLabel="Label" moreVertical />
      {tags.length === 0 ? (
        <p className="rounded-card border border-dashed border-border py-10 text-center text-small italic text-fg-muted">No labels yet.</p>
      ) : (
        <SegTable columns={['Name', 'Advertisers', 'Partners', 'Smart Links', 'Offers', 'Offer Groups', 'Partner Tiers', '']}>
          {tags.map((t) => (
            <tr key={t.id} className="bg-surface text-fg">
              <td className="px-4 py-3 font-medium text-accent-text"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color ?? '#94a3b8' }} />{t.name}</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-fg-muted">—</td>
              <td className="px-4 py-3 text-right">
                <button title="Not available yet" className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
              </td>
            </tr>
          ))}
        </SegTable>
      )}
      <p className="mt-2 text-tiny text-fg-muted">Real tag dictionary (shared with Offers/Partners/Advertisers "Tags") — per-entity usage counts aren't tracked, shown as —.</p>
    </div>
  );
}

function BusinessUnitSub() {
  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">Categorize the internal structure of your Networks. For example, Finance, Sales, European Department, etc.</p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button title="Not available yet" className="btn-primary">+ Add Business Unit</button>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input title="Not available yet" placeholder="Search…" className="input !w-56 !pl-8" />
        </div>
      </div>
      <SegTable columns={['Name', '']}>
        <tr><td colSpan={2} className="px-4 py-10 text-center text-small italic text-fg-muted">No Record Found</td></tr>
      </SegTable>
    </div>
  );
}

export default function SegmentationsTab() {
  const [sub, setSub] = useState<string>('Categories');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'Categories' && <CategoriesSub />}
      {sub === 'Channels' && <ChannelsSub />}
      {sub === 'Labels' && <LabelsSub />}
      {sub === 'Business Unit' && <BusinessUnitSub />}
    </>
  );
}
