/**
 * Offers › Smart Links — matches the reference's real "Manage Smart Links" (verified live at
 * /offers/campaigns): ID/Name/Offers/Catch-All Offer/Show to Partners/Today's Revenue/Created/
 * Modified columns, a real search + Active status filter + Table Actions (Export) toolbar, a
 * per-row kebab (Edit / Copy / View Smart Link Report), and — matching the reference exactly —
 * "+ Smart Link" and a link's Name navigate to real dedicated pages rather than a modal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, ExternalLink, Filter } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, TableScroll } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { fmtDateTime, fmtMoney, type SmartLink, type SmartLinkItem } from '../../data/smartLinks';
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
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.ref, Name: r.name, 'Catch-All Offer': offerName(r.catchAllOfferId), 'Show to Partners': r.showToPartners ? 'YES' : 'NO',
    "Today's Revenue": fmtMoney(r.todayRevenue), Created: r.createdAt, Modified: r.updatedAt,
  }));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSubOpen(false); }} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-card border border-border bg-elevated p-1 shadow-elevated">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <div className="relative">
              <button type="button" onClick={() => setSubOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
                Export <ChevronRight size={13} />
              </button>
              {subOpen && (
                <div className="absolute left-full top-0 z-30 ml-1 w-36 rounded-card border border-border bg-elevated p-1 shadow-elevated">
                  <button type="button" onClick={() => { downloadCsv('smart-links.csv', exportRows()); setOpen(false); setSubOpen(false); }}
                    className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">CSV</button>
                  <button type="button" onClick={() => { downloadXlsx('smart-links.xlsx', exportRows()); setOpen(false); setSubOpen(false); }}
                    className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Excel</button>
                </div>
              )}
            </div>
            <button type="button" title="Not available yet" onClick={() => setOpen(false)}
              className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Columns Customization</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Portaled to `document.body` — see OfferTemplates.tsx's RowMenu for why (a fixed popover nested
 * inside the table's scroll wrapper can otherwise get silently confined to an ancestor's box). */
function RowMenu({ onEdit, onCopy, onReport }: { onEdit: () => void; onCopy: () => void; onReport: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={openMenu} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-52 rounded-card border border-border bg-elevated py-1 shadow-elevated">
            <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Edit</button>
            <button type="button" onClick={() => { setOpen(false); onCopy(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Copy</button>
            <button type="button" onClick={() => { setOpen(false); onReport(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">View Smart Link Report</button>
          </div>
        </>,
        document.body,
      )}
    </div>
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

  const offerLabel = (id: string) => { const o = offers?.find((x) => x.id === id); return o ? (o.ref != null ? `${o.name} (${o.ref})` : o.name) : id.slice(0, 8) + '…'; };
  const offerName = (id: string | null) => (id ? offerLabel(id) : '—');
  const base = trackBase(domains ?? null);

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    return out;
  }, [data, status, q]);
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
          <button type="button" title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Filter size={15} /></button>
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
                              {items.length > 2 && <p className="text-tiny text-fg-secondary">View all ({items.length})</p>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-small text-fg-secondary">{offerName(r.catchAllOfferId)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-small font-medium ${r.showToPartners ? 'text-success-text' : 'text-danger-text'}`}>{r.showToPartners ? 'YES' : 'NO'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-small">{fmtMoney(r.todayRevenue)}</td>
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
    </>
  );
}
