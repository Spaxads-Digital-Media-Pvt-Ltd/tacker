/**
 * Offers › Bulk Edit — full-page flow (Everflow-style: dual-list offer picker + a dynamic list of
 * field changes, reviewed before applying). Real: loops PATCH /api/offers/:id per selected offer
 * with the merged set of changes, after a review step.
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Plus, Trash2, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import type { Offer, Advertiser } from '../../types';

const STATUS_DOT: Record<string, string> = { active: 'bg-success', paused: 'bg-fg-muted', draft: 'bg-warning', archived: 'bg-danger' };

type FieldType = 'status' | 'category' | 'visibility' | 'currency' | 'payoutModel' | 'defaultPayout' | 'defaultRevenue' | 'advertiserId';

const FIELD_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'category', label: 'Category' },
  { value: 'visibility', label: 'Visibility' },
  { value: 'currency', label: 'Currency' },
  { value: 'payoutModel', label: 'Payout Model' },
  { value: 'defaultPayout', label: 'Payout Per Action' },
  { value: 'defaultRevenue', label: 'Revenue Per Action' },
  { value: 'advertiserId', label: 'Advertiser' },
];

interface Change { id: string; field: FieldType | ''; value: string }

function ChangeRow({
  change, advertisers, onChange, onRemove,
}: { change: Change; advertisers: Advertiser[]; onChange: (c: Change) => void; onRemove: () => void }) {
  const renderValueInput = () => {
    if (change.field === 'status') {
      return (
        <select className="input" value={change.value} onChange={(e) => onChange({ ...change, value: e.target.value })}>
          <option value="">Select…</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="draft">Pending</option>
          <option value="archived">Deleted</option>
        </select>
      );
    }
    if (change.field === 'visibility') {
      return (
        <select className="input" value={change.value} onChange={(e) => onChange({ ...change, value: e.target.value })}>
          <option value="">Select…</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="ask">Ask</option>
        </select>
      );
    }
    if (change.field === 'payoutModel') {
      return (
        <select className="input" value={change.value} onChange={(e) => onChange({ ...change, value: e.target.value })}>
          <option value="">Select…</option>
          {['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      );
    }
    if (change.field === 'advertiserId') {
      return (
        <select className="input" value={change.value} onChange={(e) => onChange({ ...change, value: e.target.value })}>
          <option value="">Select…</option>
          {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      );
    }
    if (change.field === '') return <input className="input" disabled placeholder="Select a field type first" />;
    return <input className="input" value={change.value} onChange={(e) => onChange({ ...change, value: e.target.value })} />;
  };

  return (
    <div className="rounded-card border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-3">
          <div>
            <label className="label">Field Type <span className="text-danger-text">*</span></label>
            <select className="input" value={change.field} onChange={(e) => onChange({ ...change, field: e.target.value as FieldType, value: '' })}>
              <option value="">Select…</option>
              {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          {change.field && (
            <div>
              <label className="label">New Value <span className="text-danger-text">*</span></label>
              {renderValueInput()}
            </div>
          )}
        </div>
        <button type="button" title="Remove change" onClick={onRemove} className="mt-6 text-fg-muted hover:text-danger-text">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export default function OffersBulkEdit() {
  const nav = useNavigate();
  const location = useLocation();
  const initialIds = (location.state as { selectedIds?: string[] } | null)?.selectedIds ?? [];
  const { data: offers, loading } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [q, setQ] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialIds));
  const [changes, setChanges] = useState<Change[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const advName = (id: string) => advertisers?.find((a) => a.id === id)?.name ?? id.slice(0, 8) + '…';
  const filteredOffers = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return offers ?? [];
    return (offers ?? []).filter((o) => o.name.toLowerCase().includes(qq) || advName(o.advertiserId).toLowerCase().includes(qq));
  }, [offers, q, advertisers]);
  const available = filteredOffers.filter((o) => !selectedIds.has(o.id));
  const selected = (offers ?? []).filter((o) => selectedIds.has(o.id));

  const toggleSelect = (id: string) => setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllAvailable = () => setSelectedIds((s) => new Set([...s, ...available.map((o) => o.id)]));
  const clearAllSelected = () => setSelectedIds(new Set());

  const addChange = () => setChanges((c) => [...c, { id: crypto.randomUUID(), field: '', value: '' }]);
  const updateChange = (id: string, next: Change) => setChanges((c) => c.map((x) => (x.id === id ? next : x)));
  const removeChange = (id: string) => setChanges((c) => c.filter((x) => x.id !== id));

  const validChanges = changes.filter((c) => c.field && c.value !== '');
  const canReview = selectedIds.size > 0 && validChanges.length > 0;

  const { run, busy, error } = useMutation(async () => {
    const patch: Record<string, unknown> = {};
    for (const c of validChanges) {
      if (c.field === 'defaultPayout' || c.field === 'defaultRevenue') patch[c.field] = c.value;
      else patch[c.field] = c.value;
    }
    for (const id of selectedIds) await api.patch(`/api/offers/${id}`, patch);
  });

  const apply = async () => {
    await run(undefined);
    nav('/app/offers');
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;

  return (
    <>
      <PageHeader title="Bulk Edit" subtitle="Offers › Bulk Edit" />
      {!reviewing ? (
        <div className="space-y-4">
          <div className="card">
            <h3 className="mb-3 text-h3 font-medium text-fg">Offer Selection</h3>
            <div className="relative mb-3">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !pl-8" placeholder="Search in both, available and selected" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-card border border-border sm:grid-cols-2">
              <div className="border-b border-border sm:border-b-0 sm:border-r">
                <div className="flex items-center justify-between border-b border-border bg-page px-3 py-2">
                  <span className="text-small font-semibold text-fg">Available</span>
                  <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={selectAllAvailable}>Select All</button>
                </div>
                <div className="max-h-72 overflow-y-auto p-2">
                  {available.map((o) => (
                    <button key={o.id} type="button" onClick={() => toggleSelect(o.id)}
                      className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[o.status] ?? 'bg-fg-muted'}`} />
                      ({o.ref}) {o.name}
                    </button>
                  ))}
                  {available.length === 0 && <p className="px-2 py-3 text-small text-fg-muted">No offers.</p>}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between border-b border-border bg-page px-3 py-2">
                  <span className="text-small font-semibold text-fg">Selected</span>
                  <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearAllSelected}>Clear All</button>
                </div>
                <div className="max-h-72 overflow-y-auto p-2">
                  {selected.map((o) => (
                    <button key={o.id} type="button" onClick={() => toggleSelect(o.id)}
                      className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[o.status] ?? 'bg-fg-muted'}`} />
                      ({o.ref}) {o.name}
                    </button>
                  ))}
                  {selected.length === 0 && <p className="px-2 py-3 text-small text-fg-muted">No offers selected.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-h3 font-medium text-fg">Changes</h3>
              <button type="button" title="Add change" onClick={addChange}
                className="grid h-7 w-7 place-items-center rounded-full border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                <Plus size={15} />
              </button>
            </div>
            <div className="space-y-3">
              {changes.map((c) => (
                <ChangeRow key={c.id} change={c} advertisers={advertisers ?? []}
                  onChange={(next) => updateChange(c.id, next)} onRemove={() => removeChange(c.id)} />
              ))}
              {changes.length === 0 && <p className="text-small text-fg-muted">No changes yet. Click + to add one.</p>}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Link to="/app/offers" className="btn-ghost">Cancel</Link>
            <button type="button" className="btn-primary" disabled={!canReview} onClick={() => setReviewing(true)}>Review</button>
          </div>
        </div>
      ) : (
        <div className="card space-y-4">
          <h3 className="text-h3 font-medium text-fg">Review Changes</h3>
          {error && <p className="text-small text-danger-text">{error}</p>}
          <p className="text-small text-fg-secondary">
            Applying <strong>{validChanges.length}</strong> change{validChanges.length === 1 ? '' : 's'} to <strong>{selectedIds.size}</strong> offer{selectedIds.size === 1 ? '' : 's'}.
          </p>
          <ul className="space-y-1 text-small text-fg">
            {validChanges.map((c) => (
              <li key={c.id}>{FIELD_OPTIONS.find((f) => f.value === c.field)?.label}: <strong>{c.field === 'advertiserId' ? advName(c.value) : c.value}</strong></li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className="btn-ghost" onClick={() => setReviewing(false)}>Back</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Confirm & Apply'}</button>
          </div>
        </div>
      )}
    </>
  );
}
