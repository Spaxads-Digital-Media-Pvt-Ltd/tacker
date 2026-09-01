/**
 * Offers › Creatives — matches the reference's real "Manage Creatives" (verified live at
 * /offers/creatives): a network-wide, modal-driven catalog (no dedicated Add/Edit/Detail pages,
 * unlike Offer Templates/Smart Links/Groups) — "+ Creative" opens a type picker (Archive/Email or
 * HTML/Image/Link/Text/Thumbnail/Video), each opening its own "Add {Type} Creative" modal built
 * around the same Select Offer dual-list picker used by Offer Groups. A creative can target several
 * offers at once — the reference stores that as one row per offer, which is what Add fans out into.
 * Row kebab is Edit / Set as Paused / Set as Deleted (no hard delete, no Name-click navigation) —
 * verified against the live reference exactly.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, MoreVertical, ChevronRight, ExternalLink, Filter, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock, TableScroll } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { DualListPicker } from '../../components/DualListPicker';
import {
  ADD_MENU, FILE_ACCEPT, TYPE_LABEL, MACROS,
  readFileAsDataUrl, typeToMenuKey, type Creative, type CreativeType, type MenuKey,
} from '../../data/creatives';
import type { Offer } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'paused', 'deleted'] as const;
const ALL_COLUMNS = ['Name', 'Offer'] as const;

function AddMenu({ onPick }: { onPick: (key: MenuKey) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="btn-primary" onClick={() => setOpen((o) => !o)}><Plus size={15} /> Creative</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-80 rounded-card border border-border bg-elevated p-2 shadow-elevated">
            {ADD_MENU.map((m) => (
              <button key={m.key} type="button" onClick={() => { setOpen(false); onPick(m.key); }}
                className="block w-full rounded-[var(--radius)] px-2 py-2 text-left hover:bg-page">
                <p className="text-small font-semibold text-fg">{m.label}</p>
                <p className="text-tiny text-fg-secondary">{m.desc}</p>
              </button>
            ))}
            <div className="mt-1 border-t border-border pt-1">
              <button type="button" title="Not available yet" onClick={() => setOpen(false)}
                className="block w-full rounded-[var(--radius)] px-2 py-2 text-left hover:bg-page">
                <p className="text-small font-semibold text-fg">Bulk Add</p>
                <p className="text-tiny text-fg-secondary">Upload multiple images or thumbnail creatives in one step</p>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TableActionsMenu({ order, hidden, onApply }: { order: string[]; hidden: Set<string>; onApply: (o: string[], h: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-card border border-border bg-elevated p-1 shadow-elevated">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <button type="button" onClick={() => { setOpen(false); setColumnsOpen(true); }} className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Columns Customization <ChevronRight size={13} /></button>
            <button type="button" onClick={() => { setOpen(false); setApiOpen(true); }} className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">Show API Request</button>
          </div>
        </>
      )}
      {columnsOpen && <ColumnsModal allColumns={ALL_COLUMNS} order={order} hidden={hidden} onClose={() => setColumnsOpen(false)} onApply={onApply} />}
      {apiOpen && <ApiRequestModal onClose={() => setApiOpen(false)} path="/api/creatives" appliedFilters={{}} />}
    </div>
  );
}

function RowMenu({ onEdit, onSetStatus }: { onEdit: () => void; onSetStatus: (s: 'paused' | 'deleted') => void }) {
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
          <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-44 rounded-card border border-border bg-elevated py-1 shadow-elevated">
            <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Edit</button>
            <button type="button" onClick={() => { setOpen(false); onSetStatus('paused'); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Set as Paused</button>
            <button type="button" onClick={() => { setOpen(false); onSetStatus('deleted'); }} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-danger-bg">Set as Deleted</button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function StatusToggle({ value, onChange, includeDeleted }: { value: string; onChange: (s: 'active' | 'paused' | 'deleted') => void; includeDeleted: boolean }) {
  const opts = (includeDeleted ? STATUSES : STATUSES.slice(0, 2)) as readonly ('active' | 'paused' | 'deleted')[];
  return (
    <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
      {opts.map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-small capitalize ${value === s ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>
          <span className={`h-2 w-2 rounded-full ${s === 'active' ? 'bg-success' : s === 'paused' ? 'bg-warning' : 'bg-danger'}`} />{s}
        </button>
      ))}
    </div>
  );
}

function PrivacyToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
      <button type="button" onClick={() => onChange(true)} className={`flex-1 py-2 text-small ${value ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>Visible to Partners</button>
      <button type="button" onClick={() => onChange(false)} className={`flex-1 py-2 text-small ${!value ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>Not Visible to Partners</button>
    </div>
  );
}

function UploadBox({ accept, fileName, error, onFile }: { accept?: string; fileName: string | null; error: string | null; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="rounded-card border border-dashed border-border bg-page p-6 text-center">
        {fileName ? (
          <p className="text-small text-fg">{fileName} <button type="button" className="ml-2 text-tiny font-medium text-accent-text hover:underline" onClick={() => inputRef.current?.click()}>Replace</button></p>
        ) : (
          <p className="text-small text-fg-secondary">Drag and drop or <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => inputRef.current?.click()}>Browse</button></p>
        )}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>
      {error && <p className="mt-1 text-tiny text-danger-text">{error}</p>}
    </div>
  );
}

function MacroMenu({ onPick }: { onPick: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-ghost !py-1.5 !px-3 text-tiny">{'{ }'} Add Macro</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-card border border-border bg-elevated p-1 shadow-elevated">
            {MACROS.map((m) => (
              <button key={m.token} type="button" onClick={() => { onPick(m.token); setOpen(false); }} className="block w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">{m.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ModalProps { menuKey: MenuKey; existing?: Creative; offers: Offer[]; onClose: () => void; onSaved: () => void }

function CreativeModal({ menuKey, existing, offers, onClose, onSaved }: ModalProps) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [subKind, setSubKind] = useState<'email' | 'html'>(existing?.type === 'html' ? 'html' : 'email');
  const includeDeleted = menuKey === 'emailOrHtml';
  const [status, setStatus] = useState<'active' | 'paused' | 'deleted'>(existing?.status ?? 'active');
  const [visibleToPartners, setVisibleToPartners] = useState(existing?.visibleToPartners ?? true);
  const [offerIds, setOfferIds] = useState<string[]>(existing ? [existing.offerId] : []);
  const [linkValue, setLinkValue] = useState(existing?.url ?? '');
  const [htmlValue, setHtmlValue] = useState(existing?.html ?? '');
  const [emailFrom, setEmailFrom] = useState(existing?.emailFrom ?? '');
  const [emailSubject, setEmailSubject] = useState(existing?.emailSubject ?? '');
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(existing?.url ?? null);
  const [fileName, setFileName] = useState<string | null>(existing?.url ? 'Current file attached' : null);
  const [fileError, setFileError] = useState<string | null>(null);

  const offerOptions = offers.map((o) => ({ value: o.id, label: o.ref != null ? `${o.name} (${o.ref})` : o.name, active: o.status === 'active' }));
  const menu = ADD_MENU.find((m) => m.key === menuKey)!;
  const isFile = menuKey !== 'link' && menuKey !== 'emailOrHtml';
  const type: CreativeType = menuKey === 'emailOrHtml' ? subKind : (menuKey as CreativeType);

  const onFile = async (f: File) => {
    setFileError(null);
    try { setFileDataUrl(await readFileAsDataUrl(f)); setFileName(f.name); }
    catch (e) { setFileError(e instanceof Error ? e.message : 'Could not read file.'); }
  };

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/creatives/${existing.id}`, body) : api.post('/api/creatives', body));

  const submit = async () => {
    const body: Record<string, unknown> = { name, type, status, visibleToPartners, offerIds };
    if (menuKey === 'link') body['url'] = linkValue;
    else if (menuKey === 'emailOrHtml') {
      if (subKind === 'html') body['html'] = htmlValue;
      else { body['emailFrom'] = emailFrom || null; body['emailSubject'] = emailSubject || null; }
    } else {
      body['url'] = fileDataUrl;
    }
    const res = await run(body);
    if (res !== null) onSaved();
  };

  const valid = name.trim() && offerIds.length > 0 &&
    (menuKey === 'link' ? linkValue.trim() : menuKey === 'emailOrHtml' ? (subKind === 'html' ? htmlValue.trim() : true) : !!fileDataUrl);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">{isEdit ? `Edit ${TYPE_LABEL[type]} Creative` : `Add ${menu.label} Creative`}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          {error && <p className="text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
          <Field label="Creative Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Status *"><StatusToggle value={status} onChange={setStatus} includeDeleted={includeDeleted} /></Field>
          <Field label="Privacy *"><PrivacyToggle value={visibleToPartners} onChange={setVisibleToPartners} /></Field>

          {menuKey === 'emailOrHtml' && (
            <Field label="Creative Type *">
              <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
                {(['email', 'html'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setSubKind(k)} className={`flex-1 py-2 text-small capitalize ${subKind === k ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>{k}</button>
                ))}
              </div>
            </Field>
          )}

          {menuKey === 'emailOrHtml' && subKind === 'email' && (
            <div className="rounded-card border border-border bg-page p-4">
              <Field label="From (Optional)"><textarea className="input min-h-[70px]" placeholder="Enter one value per line" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} /></Field>
              <div className="h-3" />
              <Field label="Subject (Optional)"><textarea className="input min-h-[70px]" placeholder="Enter one value per line" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} /></Field>
            </div>
          )}
          {menuKey === 'emailOrHtml' && subKind === 'html' && (
            <Field label="HTML *"><textarea className="input min-h-[140px] font-mono text-tiny" value={htmlValue} onChange={(e) => setHtmlValue(e.target.value)} /></Field>
          )}

          <Field label="Select Offer *"><DualListPicker options={offerOptions} selected={offerIds} onChange={setOfferIds} /></Field>

          {menuKey === 'link' && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="label">Enter Link *</label>
                <MacroMenu onPick={(t) => setLinkValue((v) => v + t)} />
              </div>
              <textarea className="input min-h-[90px]" value={linkValue} onChange={(e) => setLinkValue(e.target.value)} />
            </div>
          )}

          {isFile && (
            <Field label={`Upload ${menu.label} File *`}>
              <UploadBox accept={FILE_ACCEPT[menuKey]} fileName={fileName} error={fileError} onFile={onFile} />
            </Field>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || !valid} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Creatives() {
  const { data, loading, error, refetch } = useQuery<Creative[]>('/api/creatives');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [addKey, setAddKey] = useState<MenuKey | null>(null);
  const [editRow, setEditRow] = useState<Creative | null>(null);
  const setStatusMutation = useMutation(({ id, status: s }: { id: string; status: string }) => api.patch(`/api/creatives/${id}`, { status: s }));

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    return out;
  }, [data, status, q]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showCol = (c: string) => !hiddenColumns.has(c);

  return (
    <>
      <PageHeader title="Manage Creatives" subtitle="Offers › Creatives › Manage" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <AddMenu onPick={setAddKey} />
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <div className="relative max-sm:w-full">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !w-full sm:!w-56 !pl-8" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="input !w-auto">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
          <button type="button" title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Filter size={15} /></button>
          <TableActionsMenu order={columnOrder} hidden={hiddenColumns} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No creatives yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No creatives match your filters.</StateBlock>
        : (
          <>
            <TableScroll>
              <table className="w-full min-w-[700px] text-left text-body">
                <thead className="sticky top-0 z-20 border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr className="divide-x divide-border">
                    <th className="px-4 py-3 font-semibold">ID</th>
                    {columnOrder.filter(showCol).map((c) => <th key={c} className="px-4 py-3 font-semibold">{c}</th>)}
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <tr key={r.id} className="group">
                      <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.ref}</td>
                      {columnOrder.filter(showCol).map((c) => (
                        <td key={c} className="px-4 py-3">
                          {c === 'Name' ? (
                            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${r.status === 'active' ? 'bg-success' : r.status === 'paused' ? 'bg-warning' : 'bg-danger'}`} />{r.name}</span>
                          ) : (
                            <span className="flex items-center gap-1 text-accent-text">
                              {r.offerName ? `${r.offerName} (${r.offerRef})` : r.offerId.slice(0, 8) + '…'}
                              {r.visibleToPartners && <ExternalLink size={11} className="text-fg-muted" />}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowMenu onEdit={() => setEditRow(r)}
                            onSetStatus={async (s) => { await setStatusMutation.run({ id: r.id, status: s }); refetch(); }} />
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

      {addKey && <CreativeModal menuKey={addKey} offers={offers ?? []} onClose={() => setAddKey(null)} onSaved={() => { setAddKey(null); refetch(); }} />}
      {editRow && <CreativeModal menuKey={typeToMenuKey(editRow.type)} existing={editRow} offers={offers ?? []} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); refetch(); }} />}
    </>
  );
}
