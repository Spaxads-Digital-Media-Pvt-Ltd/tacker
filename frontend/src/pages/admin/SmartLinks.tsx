/**
 * Offers › Smart Links — matches the reference's real "Manage Smart Links" (verified live at
 * /offers/campaigns): ID/Name/Offers/Catch-All Offer/Show to Partners/Today's Revenue/Created/
 * Modified columns, a real search + Active status filter + Table Actions (Export) toolbar, a
 * per-row kebab (Edit / Copy / View Smart Link Report), and — matching the reference exactly —
 * "+ Smart Link" and a link's Name navigate to real dedicated pages rather than a modal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, TableScroll, MenuPopover, MenuItem } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { SearchFilterDrawer, FieldBlock } from '../../components/SearchFilterDrawer';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { fmtDateTime, fmtMoney, REDIRECT_MECHANISMS, type SmartLink, type SmartLinkItem } from '../../data/smartLinks';
import type { Offer, TrackingDomain } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'paused', 'deleted'] as const;

function DateTimeCell({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return <><div>{date}</div><div className="text-tiny text-fg-secondary">{time}</div></>;
}

/** Offer names for each link's items — real, fetched per-row from the link's own `/items`
 * endpoint (small demo dataset, so N+1 is fine; matches the reference's own "Offers" column). */
function useLinkItems(links: SmartLink[] | null): Record<string, SmartLinkItem[]> {
  const [byLink, setByLink] = useState<Record<string, SmartLinkItem[]>>({});
  useEffect(() => {
    if (!links) return;
    let alive = true;
    Promise.all(links.map((l) => api.get<SmartLinkItem[]>(`/api/smart-links/${l.id}/items`).then((items) => [l.id, items] as const).catch(() => [l.id, []] as const)))
      .then((pairs) => { if (alive) setByLink(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [links]);
  return byLink;
}

function trackBase(domains: TrackingDomain[] | null): string {
  const active = (domains ?? []).filter((d) => d.status === 'active');
  const primary = active.find((d) => d.isPrimary) ?? active[0];
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  return isLocal ? 'http://localhost:4002' : `https://${primary?.host ?? 'your-tracking-domain.com'}`;
}

function TableActionsMenu({ rows, offerName }: { rows: SmartLink[]; offerName: (id: string | null) => string }) {
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.ref, Name: r.name, 'Catch-All Offer': offerName(r.catchAllOfferId), 'Show to Partners': r.showToPartners ? 'YES' : 'NO',
    "Today's Revenue": fmtMoney(r.todayRevenue), Created: r.createdAt, Modified: r.updatedAt,
  }));
  return (
    <MenuPopover
      ariaLabel="Table Actions" align="end" width="w-52"
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
                <MenuItem onSelect={() => { downloadCsv('smart-links.csv', exportRows()); close(); }}>CSV</MenuItem>
                <MenuItem onSelect={() => { downloadXlsx('smart-links.xlsx', exportRows()); close(); }}>Excel</MenuItem>
              </div>
            )}
          </div>
          <button type="button" title="Not available yet" onClick={close}
            className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg-muted hover:bg-page">Columns Customization</button>
        </>
      )}
    </MenuPopover>
  );
}

function RowMenu({ onEdit, onCopy, onReport }: { onEdit: () => void; onCopy: () => void; onReport: () => void }) {
  return (
    <MenuPopover
      ariaLabel="Smart link actions" align="end" width="w-52"
      triggerClassName="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
    >
      {({ close }) => (
        <>
          <MenuItem onSelect={() => { close(); onEdit(); }}>Edit</MenuItem>
          <MenuItem onSelect={() => { close(); onCopy(); }}>Copy</MenuItem>
          <MenuItem onSelect={() => { close(); onReport(); }}>View Smart Link Report</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

export default function SmartLinks() {
  const { data, loading, error, refetch } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const itemsByLink = useLinkItems(data);
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);
  const copy = useMutation((id: string) => api.post(`/api/smart-links/${id}/copy`, {}));

  // ── Filter drawer (client-side, over the fetched list — same pattern as Manage Offers).
  //    Status + Search stay as quick-filters in the toolbar; the drawer covers the rest. ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fMech, setFMech] = useState('');         // redirectMechanism
  const [fPartners, setFPartners] = useState(''); // '' | 'yes' | 'no'  (showToPartners)
  const [fCatch, setFCatch] = useState('');       // catchAllOfferId | '__none__'
  const [fRoutes, setFRoutes] = useState('');     // offerId that a link routes to
  const [fDomain, setFDomain] = useState('');     // trackingDomainId
  const [fLabel, setFLabel] = useState('');       // labels contains
  const [dMech, setDMech] = useState('');
  const [dPartners, setDPartners] = useState('');
  const [dCatch, setDCatch] = useState('');
  const [dRoutes, setDRoutes] = useState('');
  const [dDomain, setDDomain] = useState('');
  const [dLabel, setDLabel] = useState('');

  const offerLabel = useCallback(
    (id: string) => { const o = offers?.find((x) => x.id === id); return o ? (o.ref != null ? `${o.name} (${o.ref})` : o.name) : id.slice(0, 8) + '…'; },
    [offers],
  );
  const offerName = (id: string | null) => (id ? offerLabel(id) : '—');
  const base = trackBase(domains ?? null);

  // Data-driven option lists so the drawer only offers values that actually exist in the list.
  const catchAllOptions = useMemo(
    () => Array.from(new Set((data ?? []).map((l) => l.catchAllOfferId).filter((x): x is string => Boolean(x))))
      .map((id) => ({ id, label: offerLabel(id) })).sort((a, b) => a.label.localeCompare(b.label)),
    [data, offerLabel],
  );
  const routedOfferOptions = useMemo(
    () => Array.from(new Set(Object.values(itemsByLink).flat().map((it) => it.offerId)))
      .map((id) => ({ id, label: offerLabel(id) })).sort((a, b) => a.label.localeCompare(b.label)),
    [itemsByLink, offerLabel],
  );

  const openDrawer = () => {
    setDMech(fMech); setDPartners(fPartners); setDCatch(fCatch); setDRoutes(fRoutes); setDDomain(fDomain); setDLabel(fLabel);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setFMech(dMech); setFPartners(dPartners); setFCatch(dCatch); setFRoutes(dRoutes); setFDomain(dDomain); setFLabel(dLabel);
    setDrawerOpen(false); setPage(1);
  };
  const clearDraft = () => { setDMech(''); setDPartners(''); setDCatch(''); setDRoutes(''); setDDomain(''); setDLabel(''); };

  const appliedFilterCount = [fMech, fPartners, fCatch, fRoutes, fDomain, fLabel.trim()].filter(Boolean).length;
  const draftFilterCount = [dMech, dPartners, dCatch, dRoutes, dDomain, dLabel.trim()].filter(Boolean).length;

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (fMech) out = out.filter((r) => r.redirectMechanism === fMech);
    if (fPartners) out = out.filter((r) => r.showToPartners === (fPartners === 'yes'));
    if (fCatch) out = out.filter((r) => (fCatch === '__none__' ? !r.catchAllOfferId : r.catchAllOfferId === fCatch));
    if (fRoutes) out = out.filter((r) => (itemsByLink[r.id] ?? []).some((it) => it.offerId === fRoutes));
    if (fDomain) out = out.filter((r) => r.trackingDomainId === fDomain);
    if (fLabel.trim()) { const s = fLabel.trim().toLowerCase(); out = out.filter((r) => (r.labels ?? '').toLowerCase().includes(s)); }
    return out;
  }, [data, status, q, fMech, fPartners, fCatch, fRoutes, fDomain, fLabel, itemsByLink]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Manage Smart Links" subtitle="Offers › Smart Links › Manage" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <button className="btn-primary max-sm:w-full" onClick={() => nav('/app/smart-links/add')}><Plus size={15} /> Smart Link</button>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <div className="relative max-sm:w-full">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-full sm:!w-56 !pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="input !w-auto">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button type="button" className="btn-ghost relative" onClick={openDrawer}>
            <SlidersHorizontal size={15} /> Filters
            {appliedFilterCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-tiny font-bold text-white">{appliedFilterCount}</span>
            )}
          </button>
          <TableActionsMenu rows={rows} offerName={offerName} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No smart links yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No smart links match your filters.</StateBlock>
        : (
          <>
            <TableScroll>
              <table className="w-full min-w-[1100px] text-left text-body">
                <thead className="sticky top-0 z-20 border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Offers</th>
                    <th className="px-4 py-3 font-semibold">Catch-All Offer</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Show to Partners</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Today's Revenue</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Created</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Modified</th>
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => {
                    const items = itemsByLink[r.id];
                    return (
                      <tr key={r.id} className="group">
                        <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button className="font-medium text-accent-text hover:underline" onClick={() => nav(`/app/smart-links/${r.id}`)}>{r.name}</button>
                            {r.showToPartners && (
                              <a href={`${base}/sl?id=${r.id}`} target="_blank" rel="noreferrer" title="Open Smart Link"
                                className="text-fg-muted opacity-0 hover:text-accent-text group-hover:opacity-100"><ExternalLink size={13} /></a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-small text-fg-secondary">
                          {!items ? '—' : items.length === 0 ? '—' : (
                            <div className="space-y-0.5">
                              {items.slice(0, 2).map((it) => (
                                <p key={it.id} className="flex items-center gap-1 text-tiny text-fg">
                                  - {offerLabel(it.offerId)}
                                  {r.showToPartners && <a href={`${base}/sl?id=${r.id}`} target="_blank" rel="noreferrer" className="text-fg-muted hover:text-accent-text"><ExternalLink size={11} /></a>}
                                </p>
                              ))}
                              {items.length > 2 && (
                                <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => nav(`/app/smart-links/${r.id}`)}>View all ({items.length})</button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-small text-fg-secondary">{offerName(r.catchAllOfferId)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-small font-medium ${r.showToPartners ? 'text-success-text' : 'text-danger-text'}`}>{r.showToPartners ? 'YES' : 'NO'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-small tabular-nums">{fmtMoney(r.todayRevenue)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-small"><DateTimeCell iso={r.createdAt} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-small"><DateTimeCell iso={r.updatedAt} /></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <RowMenu onEdit={() => nav(`/app/smart-links/${r.id}/edit`)}
                              onCopy={async () => { await copy.run(r.id); refetch(); }}
                              onReport={() => nav(`/app/reports/smartlink?smartLinkId=${r.id}`)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

          <FieldBlock label="Redirect Mechanism">
            <select className="input" value={dMech} onChange={(e) => setDMech(e.target.value)}>
              <option value="">All Mechanisms</option>
              {REDIRECT_MECHANISMS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Show to Partners">
            <select className="input" value={dPartners} onChange={(e) => setDPartners(e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Yes — exposed in the Partner Portal</option>
              <option value="no">No</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Routes to Offer">
            <select className="input" value={dRoutes} onChange={(e) => setDRoutes(e.target.value)}>
              <option value="">Any Offer</option>
              {routedOfferOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">Smart Links with this offer in their rotation — useful when auditing where an offer gets traffic.</p>
          </FieldBlock>

          <FieldBlock label="Catch-All Offer">
            <select className="input" value={dCatch} onChange={(e) => setDCatch(e.target.value)}>
              <option value="">Any</option>
              <option value="__none__">— No catch-all configured</option>
              {catchAllOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Tracking Domain">
            <select className="input" value={dDomain} onChange={(e) => setDDomain(e.target.value)}>
              <option value="">All Tracking Domains</option>
              {(domains ?? []).filter((d) => d.status === 'active').map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Label contains">
            <input className="input" placeholder="e.g. nutrition" value={dLabel} onChange={(e) => setDLabel(e.target.value)} />
            <p className="mt-1 text-[11px] text-fg-muted">Substring match against a Smart Link's free-text Labels.</p>
          </FieldBlock>
        </SearchFilterDrawer>
      )}
    </>
  );
}
