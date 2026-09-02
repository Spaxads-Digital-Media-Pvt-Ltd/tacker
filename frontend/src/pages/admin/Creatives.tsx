/**
 * Offers › Creatives — matches the reference's real "Manage Creatives" (verified live at
 * /offers/creatives): a network-wide, modal-driven catalog (no dedicated Add/Edit/Detail pages,
 * unlike Offer Templates/Smart Links/Groups) — "+ Creative" opens a type picker (Archive/Email or
 * HTML/Image/Link/Text/Thumbnail/Video), each opening its own "Add {Type} Creative" modal built
 * around the same Select Offer dual-list picker used by Offer Groups. A creative can target several
 * offers at once — the reference stores that as one row per offer, which is what Add fans out into.
 * Row kebab is Edit / Preview / Set as Paused / Set as Deleted (no hard delete, no Name-click
 * navigation) — verified against the live reference exactly.
 *
 * All four dropdowns (Add / Table Actions / row kebab / Add Macro) use the shared MenuPopover so a
 * menu open never eats the first click on another trigger. Filter is a real SearchFilterDrawer
 * (Type / Offer / Partner visibility / Language / Size) over the fetched list. File "upload" is a
 * genuine drag-or-browse that stores the bytes inline as a data: URI (no asset host in this build);
 * Bulk Add fans several files into one creative each; Preview renders the stored asset.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, MoreVertical, Eye, SlidersHorizontal, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock, TableScroll, Modal, Segmented, MenuPopover, MenuItem } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { SearchFilterDrawer, FieldBlock } from '../../components/SearchFilterDrawer';
import { DualListPicker } from '../../components/DualListPicker';
import {
  ADD_MENU, FILE_ACCEPT, TYPE_LABEL, MACROS,
  readFileAsDataUrl, typeToMenuKey, type Creative, type CreativeType, type MenuKey,
} from '../../data/creatives';
import type { Offer } from '../../types';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'paused', 'deleted'] as const;
const ALL_COLUMNS = ['Name', 'Offer'] as const;
const UPLOAD_HINT = 'Stored inline in the creative record (max 2 MB). This build has no external asset host — for a hosted asset, use a Link creative instead.';

function AddMenu({ onPick }: { onPick: (key: MenuKey | 'bulk') => void }) {
  return (
    <MenuPopover
      ariaLabel="Add a creative" align="start" width="w-80"
      triggerClassName="btn-primary"
      button={<><Plus size={15} /> Creative</>}
    >
      {({ close }) => (
        <div className="p-1">
          {ADD_MENU.map((m) => (
            <button key={m.key} type="button" onClick={() => { close(); onPick(m.key); }}
              className="block w-full rounded-[var(--radius)] px-2 py-2 text-left hover:bg-page">
              <p className="text-small font-semibold text-fg">{m.label}</p>
              <p className="text-tiny text-fg-secondary">{m.desc}</p>
            </button>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <button type="button" onClick={() => { close(); onPick('bulk'); }}
              className="block w-full rounded-[var(--radius)] px-2 py-2 text-left hover:bg-page">
              <p className="text-small font-semibold text-fg">Bulk Add</p>
              <p className="text-tiny text-fg-secondary">Upload several image or thumbnail files at once — one creative per file</p>
            </button>
          </div>
        </div>
      )}
    </MenuPopover>
  );
}

function TableActionsMenu({
  order, hidden, onApply, appliedFilters,
}: {
  order: string[]; hidden: Set<string>; onApply: (o: string[], h: Set<string>) => void;
  appliedFilters: Record<string, string | undefined>;
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  return (
    <>
      <MenuPopover
        ariaLabel="Table Actions" align="end" width="w-52"
        triggerClassName="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"
        button={<MoreVertical size={15} />}
      >
        {({ close }) => (
          <>
            <p className="px-3 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <MenuItem onSelect={() => { close(); setColumnsOpen(true); }}>Columns Customization</MenuItem>
            <MenuItem onSelect={() => { close(); setApiOpen(true); }}>Show API Request</MenuItem>
          </>
        )}
      </MenuPopover>
      {columnsOpen && <ColumnsModal allColumns={ALL_COLUMNS} order={order} hidden={hidden} onClose={() => setColumnsOpen(false)} onApply={onApply} />}
      {apiOpen && <ApiRequestModal onClose={() => setApiOpen(false)} path="/api/creatives" appliedFilters={appliedFilters} />}
    </>
  );
}

function RowMenu({
  onEdit, onPreview, onSetStatus, canPreview,
}: {
  onEdit: () => void; onPreview: () => void; onSetStatus: (s: 'paused' | 'deleted') => void; canPreview: boolean;
}) {
  return (
    <MenuPopover
      ariaLabel="Creative actions" align="end" width="w-44"
      triggerClassName="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
    >
      {({ close }) => (
        <>
          <MenuItem onSelect={() => { close(); onEdit(); }}>Edit</MenuItem>
          {canPreview && <MenuItem onSelect={() => { close(); onPreview(); }}>Preview</MenuItem>}
          <MenuItem onSelect={() => { close(); onSetStatus('paused'); }}>Set as Paused</MenuItem>
          <MenuItem tone="danger" onSelect={() => { close(); onSetStatus('deleted'); }}>Set as Deleted</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

function MacroMenu({ onPick }: { onPick: (token: string) => void }) {
  return (
    <MenuPopover
      ariaLabel="Insert a macro token" align="end" width="w-44"
      triggerClassName="btn-ghost !py-1.5 !px-3 text-tiny"
      button={<>{'{ }'} Add Macro</>}
    >
      {({ close }) => (
        <>
          {MACROS.map((m) => (
            <MenuItem key={m.token} onSelect={() => { onPick(m.token); close(); }}>
              <span className="font-mono text-tiny text-fg-muted">{m.token}</span>
              <span className="ml-auto text-tiny text-fg-secondary">{m.label}</span>
            </MenuItem>
          ))}
        </>
      )}
    </MenuPopover>
  );
}

function PrivacyToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Segmented
      options={[{ value: 'yes', label: 'Visible to Partners' }, { value: 'no', label: 'Not Visible' }]}
      value={value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
    />
  );
}

function StatusToggle({ value, onChange, includeDeleted }: { value: string; onChange: (s: 'active' | 'paused' | 'deleted') => void; includeDeleted: boolean }) {
  return (
    <Segmented
      options={includeDeleted ? ['active', 'paused', 'deleted'] : ['active', 'paused']}
      value={value}
      onChange={(v) => onChange(v as 'active' | 'paused' | 'deleted')}
      dots={{ active: 'bg-success', paused: 'bg-warning', deleted: 'bg-danger' }}
    />
  );
}

function UploadBox({ accept, fileName, error, onFile }: { accept?: string; fileName: string | null; error: string | null; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className={`rounded-card border border-dashed p-6 text-center transition-colors ${drag ? 'border-accent bg-accent-subtle' : 'border-border bg-page'}`}
      >
        {fileName ? (
          <p className="text-small text-fg">{fileName} <button type="button" className="ml-2 text-tiny font-medium text-accent-text hover:underline" onClick={() => inputRef.current?.click()}>Replace</button></p>
        ) : (
          <p className="text-small text-fg-secondary">Drag a file here, or <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => inputRef.current?.click()}>Browse</button></p>
        )}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">{UPLOAD_HINT}</p>
      {error && <p className="mt-1 text-tiny text-danger-text">{error}</p>}
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

  // Escape closes the modal — but only when a nested popover (the Add Macro menu) isn't the thing
  // being dismissed, so hitting Esc to close that menu doesn't also blow away the whole form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="menu"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          {error && <p className="text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
          <Field label="Creative Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Status *"><StatusToggle value={status} onChange={setStatus} includeDeleted={includeDeleted} /></Field>
          <Field label="Privacy *"><PrivacyToggle value={visibleToPartners} onChange={setVisibleToPartners} /></Field>

          {menuKey === 'emailOrHtml' && (
            <Field label="Creative Type *">
              <Segmented options={['email', 'html']} value={subKind} onChange={(v) => setSubKind(v as 'email' | 'html')} />
            </Field>
          )}

          {menuKey === 'emailOrHtml' && subKind === 'email' && (
            <div className="space-y-3 rounded-card border border-border bg-page p-4">
              <Field label="From (Optional)"><textarea className="input min-h-[70px]" placeholder="Enter one value per line" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} /></Field>
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
              <textarea className="input min-h-[90px] font-mono text-tiny" value={linkValue} onChange={(e) => setLinkValue(e.target.value)} />
              <p className="mt-1 text-[11px] text-fg-muted">Macro tokens are inserted as literal text for partners to use in their own tools — this app does not substitute them into the creative.</p>
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

function BulkAddModal({ offers, onClose, onSaved }: { offers: Offer[]; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'image' | 'thumbnail'>('image');
  const [status, setStatus] = useState<'active' | 'paused' | 'deleted'>('active');
  const [visibleToPartners, setVisibleToPartners] = useState(true);
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const offerOptions = offers.map((o) => ({ value: o.id, label: o.ref != null ? `${o.name} (${o.ref})` : o.name, active: o.status === 'active' }));
  const valid = offerIds.length > 0 && files.length > 0 && !busy;

  const submit = async () => {
    setBusy(true); setErr(null); setDone(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const url = await readFileAsDataUrl(f);
        await api.post('/api/creatives', {
          name: f.name.replace(/\.[^.]+$/, ''), type, status, visibleToPartners, offerIds, url,
        });
        setDone(i + 1);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Bulk add failed.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Bulk Add Creatives" size="xl">
      <div className="space-y-4">
        <p className="text-tiny text-fg-secondary">Each selected file becomes its own creative (named after the file), fanned across every selected offer. {UPLOAD_HINT}</p>
        <Field label="Creative Type *">
          <Segmented options={[{ value: 'image', label: 'Image' }, { value: 'thumbnail', label: 'Thumbnail' }]} value={type} onChange={(v) => setType(v as 'image' | 'thumbnail')} />
        </Field>
        <Field label="Status *"><StatusToggle value={status} onChange={setStatus} includeDeleted={false} /></Field>
        <Field label="Privacy *"><PrivacyToggle value={visibleToPartners} onChange={setVisibleToPartners} /></Field>
        <Field label="Select Offer *"><DualListPicker options={offerOptions} selected={offerIds} onChange={setOfferIds} /></Field>
        <Field label="Files *">
          <div className="rounded-card border border-dashed border-border bg-page p-6 text-center">
            <p className="text-small text-fg-secondary">
              {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : 'No files selected'} —{' '}
              <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => inputRef.current?.click()}>Browse</button>
            </p>
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </div>
          {files.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-tiny text-fg-secondary">
              {files.map((f) => <li key={f.name}>{f.name} <span className="text-fg-muted">({(f.size / 1024).toFixed(0)} KB)</span></li>)}
            </ul>
          )}
        </Field>
        {err && <p className="text-small text-danger-text">{err}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          {busy && <span className="mr-auto text-tiny text-fg-secondary tabular-nums">{done}/{files.length} created…</span>}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid} onClick={submit}>{busy ? 'Adding…' : `Add ${files.length || ''} Creative${files.length === 1 ? '' : 's'}`.trim()}</button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewModal({ creative, onClose }: { creative: Creative; onClose: () => void }) {
  const { type, url, html, emailFrom, emailSubject, name, width, height, language, visibleToPartners } = creative;
  const isInlineData = !!url && url.startsWith('data:');
  return (
    <Modal open onClose={onClose} title={`Preview — ${name}`} size="xl">
      <div className="max-h-[75vh] space-y-3 overflow-y-auto">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-tiny text-fg-secondary">
          <span>Type: <span className="text-fg">{TYPE_LABEL[type]}</span></span>
          {width ? <span>Size: <span className="tabular-nums text-fg">{width}×{height}</span></span> : null}
          {language ? <span>Language: <span className="text-fg">{language}</span></span> : null}
          <span>Partners: <span className="text-fg">{visibleToPartners ? 'Visible' : 'Hidden'}</span></span>
        </div>

        {(type === 'image' || type === 'thumbnail') && url && (
          <img src={url} alt={name} className="max-h-[45vh] w-auto rounded-card border border-border bg-page" />
        )}
        {type === 'video' && url && (
          <video src={url} controls className="max-h-[45vh] w-full rounded-card border border-border bg-black" />
        )}
        {type === 'html' && html && (
          <>
            <iframe title="HTML preview" srcDoc={html} sandbox="" className="h-56 w-full rounded-card border border-border bg-white" />
            <pre className="max-h-40 overflow-auto rounded-card border border-border bg-page p-3 text-tiny text-fg">{html}</pre>
          </>
        )}
        {type === 'email' && (
          <div className="space-y-1 rounded-card border border-border bg-page p-3 text-small">
            <p><span className="text-fg-secondary">From:</span> {emailFrom || '—'}</p>
            <p><span className="text-fg-secondary">Subject:</span> {emailSubject || '—'}</p>
          </div>
        )}
        {(type === 'link' || type === 'archive' || type === 'text') && url && (
          <div className="space-y-2 rounded-card border border-border bg-page p-3">
            <p className="break-all text-small text-fg">{isInlineData ? `${url.slice(0, 72)}…  (inline data URI)` : url}</p>
            {!isInlineData && (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-tiny font-medium text-accent-text hover:underline">
                Open in new tab <Eye size={12} />
              </a>
            )}
          </div>
        )}
        {!url && !html && type !== 'email' && <p className="text-small text-fg-muted">No asset stored on this creative.</p>}

        <div className="flex justify-end border-t border-border pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

const canPreview = (r: Creative) => !!(r.url || r.html || r.type === 'email');

export default function Creatives() {
  const { data, loading, error, refetch } = useQuery<Creative[]>('/api/creatives');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('active');
  const [page, setPage] = useState(1);
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [addKey, setAddKey] = useState<MenuKey | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editRow, setEditRow] = useState<Creative | null>(null);
  const [previewRow, setPreviewRow] = useState<Creative | null>(null);
  const setStatusMutation = useMutation(({ id, status: s }: { id: string; status: string }) => api.patch(`/api/creatives/${id}`, { status: s }));

  // ── Filter drawer (client-side, over the fetched list — same pattern as Manage Offers /
  //    Smart Links / Offer Groups). Status + Search stay in the toolbar as quick filters. ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fType, setFType] = useState('');
  const [fOffer, setFOffer] = useState('');
  const [fVis, setFVis] = useState('');     // '' | 'yes' | 'no'
  const [fLang, setFLang] = useState('');
  const [fSize, setFSize] = useState('');
  const [dType, setDType] = useState('');
  const [dOffer, setDOffer] = useState('');
  const [dVis, setDVis] = useState('');
  const [dLang, setDLang] = useState('');
  const [dSize, setDSize] = useState('');

  const offerLabel = useCallback((id: string) => {
    const o = offers?.find((x) => x.id === id);
    return o ? (o.ref != null ? `${o.name} (${o.ref})` : o.name) : id.slice(0, 8) + '…';
  }, [offers]);

  const typeOptions = useMemo(
    () => Array.from(new Set((data ?? []).map((r) => r.type))).sort(),
    [data],
  );
  const offerOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of data ?? []) {
      if (byId.has(r.offerId)) continue;
      byId.set(r.offerId, r.offerName ? `${r.offerName} (${r.offerRef})` : offerLabel(r.offerId));
    }
    return [...byId].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data, offerLabel]);
  const langOptions = useMemo(
    () => Array.from(new Set((data ?? []).map((r) => r.language).filter((x): x is string => Boolean(x)))).sort(),
    [data],
  );
  const sizeOptions = useMemo(
    () => Array.from(new Set((data ?? []).filter((r) => r.width && r.height).map((r) => `${r.width}×${r.height}`))).sort(),
    [data],
  );

  const openDrawer = () => {
    setDType(fType); setDOffer(fOffer); setDVis(fVis); setDLang(fLang); setDSize(fSize);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setFType(dType); setFOffer(dOffer); setFVis(dVis); setFLang(dLang); setFSize(dSize);
    setDrawerOpen(false); setPage(1);
  };
  const clearDraft = () => { setDType(''); setDOffer(''); setDVis(''); setDLang(''); setDSize(''); };

  const appliedFilterCount = [fType, fOffer, fVis, fLang, fSize].filter(Boolean).length;
  const draftFilterCount = [dType, dOffer, dVis, dLang, dSize].filter(Boolean).length;

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status !== 'all') out = out.filter((r) => r.status === status);
    if (q.trim()) out = out.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (fType) out = out.filter((r) => r.type === fType);
    if (fOffer) out = out.filter((r) => r.offerId === fOffer);
    if (fVis) out = out.filter((r) => r.visibleToPartners === (fVis === 'yes'));
    if (fLang) out = out.filter((r) => r.language === fLang);
    if (fSize) out = out.filter((r) => r.width && r.height && `${r.width}×${r.height}` === fSize);
    return out;
  }, [data, status, q, fType, fOffer, fVis, fLang, fSize]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showCol = (c: string) => !hiddenColumns.has(c);

  const appliedFilters: Record<string, string | undefined> = {
    Status: status !== 'all' ? status : undefined,
    Search: q.trim() || undefined,
    Type: fType ? TYPE_LABEL[fType as CreativeType] : undefined,
    Offer: fOffer ? offerLabel(fOffer) : undefined,
    'Visible to partners': fVis || undefined,
    Language: fLang || undefined,
    Size: fSize || undefined,
  };

  return (
    <>
      <PageHeader title="Manage Creatives" subtitle="Offers › Creatives › Manage" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <AddMenu onPick={(k) => (k === 'bulk' ? setBulkOpen(true) : setAddKey(k))} />
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
          <TableActionsMenu order={columnOrder} hidden={hiddenColumns} appliedFilters={appliedFilters}
            onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No creatives yet.</StateBlock>
        : rows.length === 0 ? <StateBlock>No creatives match your filters.</StateBlock>
        : (
          <>
            <TableScroll>
              <table className="w-full min-w-[720px] text-left text-body">
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
                            <span className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${r.status === 'active' ? 'bg-success' : r.status === 'paused' ? 'bg-warning' : 'bg-danger'}`} />
                              {r.name}
                              <span className="rounded bg-page px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-secondary">{TYPE_LABEL[r.type]}</span>
                            </span>
                          ) : (
                            <button type="button" onClick={() => nav(`/app/offers/${r.offerId}`)}
                              className="text-accent-text hover:underline">
                              {r.offerName ? `${r.offerName} (${r.offerRef})` : r.offerId.slice(0, 8) + '…'}
                            </button>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canPreview(r) && (
                            <button type="button" title="Preview creative" onClick={() => setPreviewRow(r)}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Eye size={15} /></button>
                          )}
                          <RowMenu
                            canPreview={canPreview(r)}
                            onEdit={() => setEditRow(r)}
                            onPreview={() => setPreviewRow(r)}
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
      {bulkOpen && <BulkAddModal offers={offers ?? []} onClose={() => setBulkOpen(false)} onSaved={() => { setBulkOpen(false); refetch(); }} />}
      {previewRow && <PreviewModal creative={previewRow} onClose={() => setPreviewRow(null)} />}

      {drawerOpen && (
        <SearchFilterDrawer appliedCount={draftFilterCount} onClose={() => setDrawerOpen(false)} onApply={applyDrawer}>
          <div className="mb-3 flex justify-end">
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearDraft}>Clear</button>
          </div>
          <p className="mb-3 text-[11px] text-fg-muted">Status and Search stay in the toolbar as quick filters — this panel narrows the list further.</p>

          <FieldBlock label="Type">
            <select className="input" value={dType} onChange={(e) => setDType(e.target.value)}>
              <option value="">All Types</option>
              {typeOptions.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Offer">
            <select className="input" value={dOffer} onChange={(e) => setDOffer(e.target.value)}>
              <option value="">Any Offer</option>
              {offerOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">Creatives attached to this offer — useful when auditing an offer's asset set.</p>
          </FieldBlock>

          <FieldBlock label="Partner Visibility">
            <select className="input" value={dVis} onChange={(e) => setDVis(e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Visible to Partners</option>
              <option value="no">Not visible</option>
            </select>
          </FieldBlock>

          <FieldBlock label="Language">
            <select className="input" value={dLang} onChange={(e) => setDLang(e.target.value)}>
              <option value="">All Languages</option>
              {langOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </FieldBlock>

          <FieldBlock label="Size">
            <select className="input" value={dSize} onChange={(e) => setDSize(e.target.value)}>
              <option value="">Any Size</option>
              {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">Width×height in pixels — set on Image and HTML creatives.</p>
          </FieldBlock>
        </SearchFilterDrawer>
      )}
    </>
  );
}
