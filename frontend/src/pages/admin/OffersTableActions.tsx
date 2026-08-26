/**
 * Manage Offers > Table Actions (the "⋮" toolbar kebab, Everflow-style). Bulk Edit routes to a
 * real full-page flow (see OffersBulkEdit.tsx). Add Offer from Template pulls from the real
 * offer_templates.fieldValues snapshot (see OfferTemplates.tsx). Export is real (CSV/JSON, client
 * side). Columns Customization is real (visibility + drag-to-reorder, backed by Offers.tsx's own
 * column state). Show API Request shows the ACTUAL request this page makes (GET /api/offers +
 * pagination — filtering happens client-side today, called out honestly rather than faked as a
 * server-side query). Share Offer(s) Details lists real partners (publishers) — this app has no
 * outbound-email infrastructure so it can't literally send mail, but picking a partner writes a
 * real audit_log entry (visible on the offer's own History tab), which is the honest equivalent of
 * "this got shared with them" given what's actually available.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { Modal, Field } from '../../components/ui';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import type { Advertiser, Publisher } from '../../types';

interface Template { id: string; name: string; fieldValues: Record<string, string> }

const FIELD_LABELS: Record<string, string> = {
  advertiserId: 'Advertiser', category: 'Category', currency: 'Currency', payoutModel: 'Payout Model',
  defaultRevenue: 'Revenue Per Action', defaultPayout: 'Payout Per Action', visibility: 'Visibility',
  destinationUrl: 'Default Landing Page URL',
};

export const ALL_COLUMNS = [
  'ID', 'Thumbnail', 'Name', 'Visibility', 'Advertiser', 'Sales Manager', 'Category', 'Labels',
  'Countries', 'Revenue', 'Payout', "Today's Clicks", "Today's Revenue", 'Created', 'Modified',
] as const;

function AddFromTemplateModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { data: templates } = useQuery<Template[]>('/api/offer-templates');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const template = (templates ?? []).find((t) => t.id === templateId);
  const fv = template?.fieldValues ?? {};
  const needsAdvertiser = !fv.advertiserId;
  const needsDestination = !fv.destinationUrl;
  const [advertiserId, setAdvertiserId] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');

  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/offers', body));

  const submit = async () => {
    const body: Record<string, unknown> = {
      name,
      advertiserId: fv.advertiserId || advertiserId,
      destinationUrl: fv.destinationUrl || destinationUrl,
      category: fv.category || undefined,
      currency: fv.currency || 'USD',
      payoutModel: fv.payoutModel || 'CPA',
      defaultPayout: fv.defaultPayout || '0',
      defaultRevenue: fv.defaultRevenue || '0',
      visibility: fv.visibility || 'public',
    };
    const res = await run(body);
    if (res) nav(`/app/offers/${res.id}/edit`);
  };

  return (
    <Modal open onClose={onClose} title="Add Offer from Template">
      <div className="space-y-3">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Template">
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Select…</option>
            {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {templateId && (
          <>
            <Field label="Offer Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            {needsAdvertiser && (
              <Field label="Advertiser (not set on this template)">
                <select className="input" value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)}>
                  <option value="">Select…</option>
                  {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            )}
            {needsDestination && (
              <Field label="Destination URL (not set on this template)">
                <input className="input" value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} placeholder="https://…" />
              </Field>
            )}
            <div className="rounded-card border border-border">
              <div className="grid grid-cols-2 gap-2 border-b border-border bg-page px-3 py-2 text-tiny font-semibold uppercase text-fg-secondary">
                <span>Field</span><span>Value</span>
              </div>
              {Object.keys(fv).length === 0
                ? <p className="px-3 py-3 text-small text-fg-muted">This template has no pre-filled fields.</p>
                : Object.entries(fv).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-2 gap-2 border-b border-border px-3 py-2 text-small last:border-b-0">
                    <span className="text-fg-secondary">{FIELD_LABELS[k] ?? k}</span><span className="text-fg">{v}</span>
                  </div>
                ))}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!templateId || !name || busy} onClick={submit}>
            {busy ? 'Adding…' : 'Add Offer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** "Share Offer(s) Details" — real partner list, records a real audit_log entry per offer (via
 * POST /api/offers/share-details) when a partner is picked. Shown as a hover submenu, matching the
 * reference's own layout. */
function ShareDetailsSubmenu({ offerIds, onDone }: { offerIds: string[]; onDone: (message: string) => void }) {
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { run, busy } = useMutation((publisherId: string) => api.post<{ shared: boolean; count: number; publisherName: string }>('/api/offers/share-details', { offerIds, publisherId }));

  const share = async (publisherId: string) => {
    const res = await run(publisherId);
    if (res) onDone(`Recorded: shared ${res.count} offer${res.count === 1 ? '' : 's'} with ${res.publisherName}.`);
  };

  return (
    <div className="absolute right-full top-0 mr-1 w-64 rounded-card border border-border bg-elevated py-1 shadow-elevated">
      <div className="border-b border-border px-3 py-2">
        <p className="text-small font-semibold text-fg">Record Offer Details Shared</p>
        <p className="text-tiny text-fg-secondary">Logs a real record that these offers were shared with a partner (no outbound email in this app).</p>
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {(publishers ?? []).map((p) => (
          <button key={p.id} disabled={busy} onClick={() => share(p.id)}
            className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">
            {p.name}
          </button>
        ))}
        {publishers && publishers.length === 0 && <p className="px-3 py-2 text-small text-fg-muted">No partners yet.</p>}
      </div>
    </div>
  );
}

export function TableActionsMenu({
  selectedIds, columnOrder, hiddenColumns, onApplyColumns, onExport, appliedFilters,
}: {
  selectedIds: string[];
  columnOrder: string[];
  hiddenColumns: Set<string>;
  onApplyColumns: (order: string[], hidden: Set<string>) => void;
  onExport: (format: 'csv' | 'json') => void;
  appliedFilters: Record<string, string | undefined>;
}) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!shareMessage) return;
    const t = setTimeout(() => setShareMessage(null), 5000);
    return () => clearTimeout(t);
  }, [shareMessage]);

  const item = (label: string, onClick: () => void, opts?: { inert?: boolean | string; hasSubmenu?: boolean }) => (
    <button key={label} role="menuitem" title={opts?.inert ? (typeof opts.inert === 'string' ? opts.inert : 'Not available yet') : undefined} onClick={onClick}
      className={`flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${opts?.inert ? 'text-fg-muted' : 'text-fg'}`}>
      {label}
      {opts?.hasSubmenu && <ChevronRight size={13} className="text-fg-muted" />}
    </button>
  );

  return (
    <>
      <button ref={btnRef} title="Table Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-64 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item(`Bulk Edit${selectedIds.length ? ` (${selectedIds.length})` : ''}`, () => {
            setOpen(false);
            nav('/app/offers/bulk-edit', { state: { selectedIds } });
          })}
          {item('Add Offer from Template', () => { setOpen(false); setFromTemplate(true); })}
          <div className="my-1 border-t border-border" />
          <div className="relative" onMouseEnter={() => selectedIds.length > 0 && setShareOpen(true)} onMouseLeave={() => setShareOpen(false)}>
            {item('Share Offer(s) Details', () => selectedIds.length > 0 && setShareOpen((s) => !s),
              { hasSubmenu: selectedIds.length > 0, inert: selectedIds.length === 0 ? 'Select at least one offer first' : false })}
            {shareOpen && selectedIds.length > 0 && (
              <ShareDetailsSubmenu offerIds={selectedIds} onDone={(msg) => { setShareOpen(false); setOpen(false); setShareMessage(msg); }} />
            )}
          </div>
          <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
            {item('Export', () => setExportOpen((s) => !s), { hasSubmenu: true })}
            {exportOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                {item('CSV', () => { setOpen(false); setExportOpen(false); onExport('csv'); })}
                {item('JSON', () => { setOpen(false); setExportOpen(false); onExport('json'); })}
              </div>
            )}
          </div>
          <div className="my-1 border-t border-border" />
          {item('Columns Customization', () => { setOpen(false); setShowColumns(true); })}
          {item('Show API Request', () => { setOpen(false); setShowApiRequest(true); })}
        </div>,
        document.body,
      )}
      {fromTemplate && <AddFromTemplateModal onClose={() => setFromTemplate(false)} />}
      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={onApplyColumns} />}
      {showApiRequest && <ApiRequestModal path="/api/offers?limit=100&offset=0" onClose={() => setShowApiRequest(false)} appliedFilters={appliedFilters} />}
      {shareMessage && createPortal(
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-card border border-border bg-elevated px-4 py-3 text-small text-fg shadow-elevated">
          {shareMessage}
          <button type="button" className="ml-3 text-tiny font-medium text-accent-text hover:underline" onClick={() => setShareMessage(null)}>Dismiss</button>
        </div>,
        document.body,
      )}
    </>
  );
}
