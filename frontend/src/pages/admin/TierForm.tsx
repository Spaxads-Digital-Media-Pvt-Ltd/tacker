/**
 * Add/Edit Tier — full page matching the reference's General section (Name/Status/Description/
 * Labels/Margin with a live Revenue & Payout Example preview) plus a dual-list Partner Selection
 * picker. The preview is illustrative only (fixed $1.00 example revenue, like the reference) —
 * Payout = Revenue * (1 - margin/100), nothing here is persisted server-side.
 */
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock, Segmented } from '../../components/ui';
import type { PartnerTier, Publisher } from '../../types';

const STATUSES = ['active', 'paused', 'deleted'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', paused: 'Paused', deleted: 'Deleted' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', paused: 'bg-warning', deleted: 'bg-danger' };

function LabelsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && value.length > 0) onChange(value.slice(0, -1));
  };
  return (
    <div className="input flex min-h-[42px] flex-wrap items-center gap-1.5 !py-1.5">
      {value.map((l) => (
        <span key={l} className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-tiny text-accent-text">
          {l}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== l))}><X size={11} /></button>
        </span>
      ))}
      <input className="min-w-[80px] flex-1 border-0 bg-transparent p-0.5 text-small outline-none" value={draft}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={commit} placeholder={value.length === 0 ? 'Add a label…' : ''} />
    </div>
  );
}

function PartnerSelection({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [q, setQ] = useState('');
  const all = publishers ?? [];
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const qq = q.trim().toLowerCase();
  const available = all.filter((p) => !selectedSet.has(p.id) && (!qq || p.name.toLowerCase().includes(qq)));
  const chosen = all.filter((p) => selectedSet.has(p.id) && (!qq || p.name.toLowerCase().includes(qq)));

  return (
    <div>
      <div className="relative mb-2">
        <input className="input" placeholder="Search in both, available and selected" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-card border border-border">
        <div className="border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-tiny">
            <span className="font-semibold text-fg">Available</span>
            <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange([...selected, ...available.map((p) => p.id)])}>Select All</button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {available.map((p) => (
              <button key={p.id} type="button" onClick={() => onChange([...selected, p.id])}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                <span className="h-2 w-2 rounded-full bg-success" /> {p.name}
              </button>
            ))}
            {available.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No partners.</p>}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-tiny">
            <span className="font-semibold text-fg">Selected</span>
            <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange([])}>Clear All</button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {chosen.map((p) => (
              <button key={p.id} type="button" onClick={() => onChange(selected.filter((id) => id !== p.id))}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                <span className="h-2 w-2 rounded-full bg-success" /> {p.name}
              </button>
            ))}
            {chosen.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No partners selected.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface FormState { name: string; status: string; description: string; marginPct: string; labels: string[]; partnerIds: string[] }
const INITIAL: FormState = { name: '', status: 'active', description: '', marginPct: '', labels: [], partnerIds: [] };

export default function TierForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<PartnerTier>(isEdit ? `/api/partner-tiers/${id}` : null);
  const { data: members } = useQuery<{ id: string }[]>(isEdit ? `/api/partner-tiers/${id}/members?status=all` : null);
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/partner-tiers', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/partner-tiers/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm((f) => ({ ...f, name: existing.name, status: existing.status, description: existing.description ?? '', marginPct: String(existing.marginPct), labels: existing.labels }));
  }, [existing]);
  useEffect(() => {
    if (members) setForm((f) => ({ ...f, partnerIds: members.map((m) => m.id) }));
  }, [members]);

  if (isEdit && (loading || !members)) return <StateBlock><Spinner /></StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const marginNum = Number(form.marginPct);
  const validMargin = form.marginPct !== '' && !Number.isNaN(marginNum);
  const payout = validMargin ? (1 * (1 - marginNum / 100)).toFixed(2) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, description: form.description || null,
      marginPct: marginNum, labels: form.labels, partnerIds: form.partnerIds,
    };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-tiers');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Tier' : 'Add Tier'} subtitle={`Partners › Tiers › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <h3 className="text-h3 font-medium text-fg">General</h3>

          <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>

          <div>
            <label className="label mb-2 block">Status *</label>
            <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} labels={STATUS_LABEL} dots={STATUS_DOT} />
          </div>

          <Field label="Description"><textarea className="input min-h-[70px]" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>

          <Field label="Labels"><LabelsInput value={form.labels} onChange={(v) => set('labels', v)} /></Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Margin *">
              <div className="relative">
                <input className="input pr-7" required type="number" min={0} max={100} step="0.1" value={form.marginPct} onChange={(e) => set('marginPct', e.target.value)} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted">%</span>
              </div>
            </Field>
            <div className="rounded-card border border-border bg-page p-3 text-tiny">
              <p className="mb-1 font-semibold text-fg">Revenue &amp; Payout Example</p>
              <div className="flex justify-between text-fg-secondary"><span>Revenue</span><span className="font-medium text-fg">RPA: $1.00</span></div>
              <div className="flex justify-between text-fg-secondary"><span>Payout</span><span className="font-medium text-fg">CPA: {payout ? `$${payout}` : '—'}</span></div>
              <div className="flex justify-between text-fg-secondary"><span>Margin</span><span className="font-medium text-fg">{validMargin ? `${marginNum}%` : '—'}</span></div>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <h3 className="mb-3 text-h3 font-medium text-fg">Partner Selection</h3>
            <PartnerSelection selected={form.partnerIds} onChange={(v) => set('partnerIds', v)} />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-tiers" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
