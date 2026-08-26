/**
 * Offers › Templates — reusable pre-filled field sets for the Add Offer wizard. Verified live
 * against the reference's own Manage Templates page: sortable Default column, bulleted Offer
 * Fields preview + "View all (N)" opening a grouped "Pre-filled field(s)" modal, real search +
 * Table Actions (Export) toolbar, a real "Use Template" action that prefills the Add Offer wizard,
 * a per-row kebab (Edit / Set as Default / Delete), and — matching the reference exactly — Name and
 * "+ Offer Template" navigate to real dedicated pages (Template Details, Add/Edit Template) rather
 * than opening a modal in place.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Modal, Spinner, StateBlock } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { useFieldSpecs, valueLabel, fmtDateTime, type Template, type FieldSpec } from '../../data/offerTemplateFields';

const PAGE_SIZE = 25;

function DateTimeCell({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return (
    <>
      <div>{date}</div>
      <div className="text-tiny text-fg-secondary">{time}</div>
    </>
  );
}

/** Matches the reference's own "Pre-filled field(s)" modal — a Field/Value table grouped into
 * section headers (same group names as the Add Offer wizard's own steps). */
function PreFilledFieldsModal({ template, specs, onClose }: { template: Template; specs: FieldSpec[]; onClose: () => void }) {
  const groups = Array.from(new Set(specs.map((s) => s.group)));
  return (
    <Modal open onClose={onClose} title="Pre-filled field(s)">
      <div className="overflow-hidden rounded-card border border-border">
        <div className="grid grid-cols-2 gap-2 border-b border-border bg-page px-4 py-2 text-tiny font-semibold uppercase text-fg-secondary">
          <span>Field</span><span>Value</span>
        </div>
        {groups.map((g) => {
          const rows = specs.filter((s) => s.group === g && template.fieldValues[s.key]);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="border-b border-border bg-page px-4 py-2 text-small font-semibold text-fg">{g}</div>
              {rows.map((s) => (
                <div key={s.key} className="grid grid-cols-2 gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span className="text-small text-fg-secondary">{s.label}</span>
                  <span className="text-small text-fg">{valueLabel(s, template.fieldValues[s.key])}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function TableActionsMenu({ rows }: { rows: Template[] }) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({ ID: r.ref, Name: r.name, Default: r.isDefault ? 'YES' : 'NO', Created: r.createdAt, Modified: r.updatedAt }));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSubOpen(false); }} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-card border border-border bg-surface p-1 shadow-lg">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <div className="relative">
              <button type="button" onClick={() => setSubOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
                Export <ChevronRight size={13} />
              </button>
              {subOpen && (
                <div className="absolute left-full top-0 z-30 ml-1 w-36 rounded-card border border-border bg-surface p-1 shadow-lg">
                  <button type="button" onClick={() => { downloadCsv('offer-templates.csv', exportRows()); setOpen(false); setSubOpen(false); }}
                    className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">CSV</button>
                  <button type="button" onClick={() => { downloadXlsx('offer-templates.xlsx', exportRows()); setOpen(false); setSubOpen(false); }}
                    className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Excel</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Portaled to `document.body` (not just `position: fixed` in place) — the row lives inside the
 * table's `overflow-x-auto` wrapper, and some ancestor between here and the viewport establishes a
 * containing block for fixed-position descendants (a transform/animation utility class further up
 * the tree), which silently confines a plain `fixed` popover to that ancestor's box instead of the
 * real viewport. Rendering through a portal sidesteps that entirely. */
function RowMenu({ onEdit, onSetDefault, onDelete, isDefault }: { onEdit: () => void; onSetDefault: () => void; onDelete: () => void; isDefault: boolean }) {
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
          <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-40 rounded-card border border-border bg-surface py-1 shadow-lg">
            <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Edit</button>
            {!isDefault && <button type="button" onClick={() => { setOpen(false); onSetDefault(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Set as Default</button>}
            <button type="button" onClick={() => { setOpen(false); onDelete(); }} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-danger-bg">Delete</button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

export default function OfferTemplates() {
  const { data, loading, error, refetch } = useQuery<Template[]>('/api/offer-templates');
  const specs = useFieldSpecs();
  const nav = useNavigate();
  const [viewRow, setViewRow] = useState<Template | null>(null);
  const [q, setQ] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const del = useMutation((id: string) => api.del(`/api/offer-templates/${id}`));
  const setDefault = useMutation((id: string) => api.patch(`/api/offer-templates/${id}`, { isDefault: true }));

  const rows = useMemo(() => {
    let out = data ?? [];
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    out = [...out].sort((a, b) => (sortAsc ? Number(a.isDefault) - Number(b.isDefault) : Number(b.isDefault) - Number(a.isDefault)));
    return out;
  }, [data, q, sortAsc]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const useTemplate = (t: Template) => {
    sessionStorage.setItem('offerTemplatePrefill', JSON.stringify(t.fieldValues));
    nav('/app/offers/new');
  };

  return (
    <>
      <PageHeader title="Manage Templates" subtitle="Offers › Offer Templates › Manage" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-primary" onClick={() => nav('/app/offers-templates/add')}><Plus size={15} /> Offer Template</button>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-56 !pl-8" />
          </div>
          <TableActionsMenu rows={rows} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No offer templates yet.</StateBlock>
        : (
          <>
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[900px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">
                      <button type="button" onClick={() => setSortAsc((a) => !a)} className="flex items-center gap-1 hover:text-fg">
                        Default {sortAsc ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Offer Fields</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Created</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Modified</th>
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 text-small text-fg-secondary">{r.isDefault ? 'YES' : '—'}</td>
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                      <td className="px-4 py-3">
                        <button className="font-medium text-accent-text hover:underline" onClick={() => nav(`/app/offers-templates/${r.id}`)}>{r.name}</button>
                      </td>
                      <td className="px-4 py-3 text-small text-fg-secondary">
                        {r.offerFields.length === 0 ? '—' : (
                          <>
                            {specs.filter((s) => r.offerFields.includes(s.key)).slice(0, 2).map((s) => (
                              <p key={s.key}>- {s.label}: {valueLabel(s, r.fieldValues[s.key])}</p>
                            ))}
                            {r.offerFields.length > 2 && (
                              <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setViewRow(r)}>View all ({r.offerFields.length})</button>
                            )}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-small"><DateTimeCell iso={r.createdAt} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-small"><DateTimeCell iso={r.updatedAt} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button className="btn-primary !py-1.5 !px-3 text-tiny" onClick={() => useTemplate(r)}>Use Template</button>
                          <RowMenu isDefault={r.isDefault} onEdit={() => nav(`/app/offers-templates/${r.id}/edit`)}
                            onSetDefault={async () => { await setDefault.run(r.id); refetch(); }}
                            onDelete={async () => { if (confirm('Delete this template?')) { await del.run(r.id); refetch(); } }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          </>
        )}

      {viewRow && <PreFilledFieldsModal template={viewRow} specs={specs} onClose={() => setViewRow(null)} />}
    </>
  );
}
