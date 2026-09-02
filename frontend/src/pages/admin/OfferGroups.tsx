/**
 * Offers › Groups — matches the reference's real "Manage Offer Groups" (verified live at
 * /offers/groups): ID/Name/Advertiser/Offers/Today's Clicks/Today's Payout/Today's Revenue/Daily
 * Payout Cap/Daily Revenue Cap/Daily Click Cap/Daily Conversion Cap columns, a real search + Active
 * status filter + a Filter drawer (Advertiser / Currency / Caps Enabled / Contains Offer / Label —
 * client-side over the fetched list, same pattern as Manage Offers & Smart Links) + Table Actions
 * (Export) toolbar, a per-row kebab (Edit), and — matching the reference exactly — "+ Offer Group"
 * and a group's Name navigate to real dedicated pages rather than a modal.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, TableScroll, MenuPopover, MenuItem } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { SearchFilterDrawer, FieldBlock } from '../../components/SearchFilterDrawer';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { fmtMoney, type OfferGroup } from '../../data/offerGroups';
import type { Advertiser, Offer } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'paused', 'deleted'] as const;

function capCell(v: number | null | undefined, money: boolean) {
  if (v == null) return <span className="text-fg-muted">N/A</span>;
  return money ? fmtMoney(v) : v.toLocaleString();
}

function TableActionsMenu({ rows, advName }: { rows: OfferGroup[]; advName: (id: string | null) => string }) {
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.ref, Name: r.name, Advertiser: advName(r.advertiserId), Offers: r.offerIds.length,
    "Today's Clicks": r.today?.clicks ?? 0, "Today's Payout": fmtMoney(r.today?.payout), "Today's Revenue": fmtMoney(r.today?.revenue),
    'Daily Payout Cap': r.caps.payout?.daily ?? 'N/A', 'Daily Revenue Cap': r.caps.revenue?.daily ?? 'N/A',
    'Daily Click Cap': r.caps.clicks?.daily ?? 'N/A', 'Daily Conversion Cap': r.caps.conversions?.daily ?? 'N/A',
  }));
  return (
    <MenuPopover
      ariaLabel="Table Actions" align="end" width="w-48"
      triggerClassName="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
      onOpenChange={(o) => { if (!o) setSubOpen(false); }}
    >
      {({ close }) => (
        <>
          <p className="px-3 py-1.5 text-small font-semibold text-fg">Table Actions</p>
          <div className="relative">
            <button type="button" onClick={() => setSubOpen((o) => !o)}
              className="flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-page">
              Export <ChevronRight size={13} className="text-fg-muted" />
            </button>
            {subOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <MenuItem onSelect={() => { downloadCsv('offer-groups.csv', exportRows()); close(); }}>CSV</MenuItem>
                <MenuItem onSelect={() => { downloadXlsx('offer-groups.xlsx', exportRows()); close(); }}>Excel</MenuItem>
              </div>
            )}
          </div>
        </>
      )}
    </MenuPopover>
  );
}

function RowMenu({ onEdit }: { onEdit: () => void }) {
  return (
    <MenuPopover
      ariaLabel="Offer group actions" align="end" width="w-40"
      triggerClassName="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
    >
      {({ close }) => <MenuItem onSelect={() => { close(); onEdit(); }}>Edit</MenuItem>}
    </MenuPopover>
  );
}

export default function OfferGroups() {
  const { data, loading, error } = useQuery<OfferGroup[]>('/api/offer-groups');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);

  const advName = useCallback(
    (id: string | null) => (id ? advertisers?.find((a) => a.id === id)?.name ?? id.slice(0, 8) + '…' : '—'),
    [advertisers],
  );
  const offerLabel = useCallback(
    (id: string) => { const o = offers?.find((x) => x.id === id); return o ? (o.ref != null ? `${o.name} (${o.ref})` : o.name) : id.slice(0, 8) + '…'; },
    [offers],
  );

  // ── Filter drawer (client-side, over the fetched list — same pattern as Manage Offers /
  //    Smart Links). Status + Search stay as quick-filters in the toolbar; the drawer covers
  //    Advertiser / Currency / Caps Enabled / Contains Offer / Label. ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fAdv, setFAdv] = useState('');       // advertiserId | '__none__'
  const [fCur, setFCur] = useState('');       // currency code
  const [fCaps, setFCaps] = useState('');     // '' | 'yes' | 'no'
  const [fOffer, setFOffer] = useState('');   // offerId a group must contain
  const [fLabel, setFLabel] = useState('');   // labels contains
  const [dAdv, setDAdv] = useState('');
  const [dCur, setDCur] = useState('');
  const [dCaps, setDCaps] = useState('');
  const [dOffer, setDOffer] = useState('');
  const [dLabel, setDLabel] = useState('');

  // Data-driven option lists so the drawer only offers values that exist in the current list.
  const advOptions = useMemo(
    () => Array.from(new Set((data ?? []).map((g) => g.advertiserId).filter((x): x is string => Boolean(x))))
      .map((id) => ({ id, label: advName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [data, advName],
  );
  const currencyOptions = useMemo(
    () => Array.from(new Set((data ?? []).map((g) => g.currency).filter(Boolean))).sort(),
    [data],
  );
  const memberOfferOptions = useMemo(
    () => Array.from(new Set((data ?? []).flatMap((g) => g.offerIds)))
      .map((id) => ({ id, label: offerLabel(id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [data, offerLabel],
  );
  const hasNoAdv = useMemo(() => (data ?? []).some((g) => !g.advertiserId), [data]);

  const openDrawer = () => {
    setDAdv(fAdv); setDCur(fCur); setDCaps(fCaps); setDOffer(fOffer); setDLabel(fLabel);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setFAdv(dAdv); setFCur(dCur); setFCaps(dCaps); setFOffer(dOffer); setFLabel(dLabel);
    setDrawerOpen(false); setPage(1);
  };
  const clearDraft = () => { setDAdv(''); setDCur(''); setDCaps(''); setDOffer(''); setDLabel(''); };

  const appliedFilterCount = [fAdv, fCur, fCaps, fOffer, fLabel.trim()].filter(Boolean).length;
  const draftFilterCount = [dAdv, dCur, dCaps, dOffer, dLabel.trim()].filter(Boolean).length;

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (fAdv) out = out.filter((r) => (fAdv === '__none__' ? !r.advertiserId : r.advertiserId === fAdv));
    if (fCur) out = out.filter((r) => r.currency === fCur);
    if (fCaps) out = out.filter((r) => r.capsEnabled === (fCaps === 'yes'));
    if (fOffer) out = out.filter((r) => r.offerIds.includes(fOffer));
    if (fLabel.trim()) { const s = fLabel.trim().toLowerCase(); out = out.filter((r) => (r.labels ?? '').toLowerCase().includes(s)); }
    return out;
  }, [data, status, q, fAdv, fCur, fCaps, fOffer, fLabel]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Manage Offer Groups" subtitle="Offers › Groups › Manage" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <button className="btn-primary max-sm:w-full" onClick={() => nav('/app/offers-groups/add')}><Plus size={15} /> Offer Group</button>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <div className="relative max-sm:w-full">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-full sm:!w-56 !pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="input !w-auto">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button type="button" className="btn-ghost relative" onClick={openDrawer}>
            <SlidersHorizontal size={15} /> Filters
            {appliedFilterCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-tiny font-bold text-white">{appliedFilterCount}</span>
            )}
          </button>
          <TableActionsMenu rows={rows} advName={advName} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No offer groups yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No offer groups match your filters.</StateBlock>
        : (
          <>
            <TableScroll>
              <table className="w-full min-w-[1300px] text-left text-body">
                <thead className="sticky top-0 z-20 border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Advertiser</th>
                    <th className="px-4 py-3 font-semibold">Offers</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Clicks</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Payout</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Revenue</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Payout Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Revenue Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Click Cap</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Daily Conversion Cap</th>
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                      <td className="px-4 py-3"><button className="font-medium text-accent-text hover:underline" onClick={() => nav(`/app/offers-groups/${r.id}`)}>{r.name}</button></td>
                      <td className="px-4 py-3 text-accent-text">{advName(r.advertiserId)}</td>
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.offerIds.length}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{(r.today?.clicks ?? 0).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{fmtMoney(r.today?.payout)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{fmtMoney(r.today?.revenue)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{r.capsEnabled ? capCell(r.caps.payout?.daily, true) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{r.capsEnabled ? capCell(r.caps.revenue?.daily, true) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{r.capsEnabled ? capCell(r.caps.clicks?.daily, false) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{r.capsEnabled ? capCell(r.caps.conversions?.daily, false) : <span className="text-fg-muted">N/A</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowMenu onEdit={() => nav(`/app/offers-groups/${r.id}/edit`)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <div className="mt-3 flex justify-end">
              <Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          </>
        )}

      {drawerOpen && (
        <SearchFilterDrawer appliedCount={draftFilterCount} onClose={() => setDrawerOpen(false)} onApply={applyDrawer}>
          <div className="mb-3 flex justify-end">
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearDraft}>Clear</button>
          </div>
          <p className="mb-3 text-[11px] text-fg-muted">Status and Search stay in the toolbar as quick filters — this panel narrows the list further.</p>

          <FieldBlock label="Advertiser">
            <select className="input" value={dAdv} onChange={(e) => setDAdv(e.target.value)}>
              <option value="">All Advertisers</option>
              {hasNoAdv && <option value="__none__">— No advertiser set</option>}
              {advOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Currency">
            <select className="input" value={dCur} onChange={(e) => setDCur(e.target.value)}>
              <option value="">All Currencies</option>
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Caps Enabled">
            <select className="input" value={dCaps} onChange={(e) => setDCaps(e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Yes — a caps matrix is configured</option>
              <option value="no">No</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Contains Offer">
            <select className="input" value={dOffer} onChange={(e) => setDOffer(e.target.value)}>
              <option value="">Any Offer</option>
              {memberOfferOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">Groups whose member list includes this offer — useful when auditing which group(s) an offer belongs to.</p>
          </FieldBlock>

          <FieldBlock label="Label contains">
            <input className="input" placeholder="e.g. nutrition" value={dLabel} onChange={(e) => setDLabel(e.target.value)} />
            <p className="mt-1 text-[11px] text-fg-muted">Substring match against a group's free-text Labels.</p>
          </FieldBlock>
        </SearchFilterDrawer>
      )}
    </>
  );
}
