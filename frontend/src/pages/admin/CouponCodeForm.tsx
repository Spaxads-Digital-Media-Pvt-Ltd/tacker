/**
 * Add/Edit Coupon Code — matches the reference: Coupon Code, Status (Active/Paused — Paused maps
 * onto this table's existing 'disabled' value, see coupon-codes/routes.ts), Offer, Partner,
 * Set Start/End Date toggles that reveal a date input, Description, Internal Notes.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { CouponCode, Offer, Publisher } from '../../types';

function Segmented({ options, value, onChange, labels, dots }: { options: readonly string[]; value: string; onChange: (v: string) => void; labels?: Record<string, string>; dots?: Record<string, string> }) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`flex items-center gap-1.5 px-4 py-2 text-small font-medium transition-colors ${value === o ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
          {dots && <span className={`h-2 w-2 rounded-full ${dots[o] ?? 'bg-fg-muted'}`} />}
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}
      className={`relative inline-flex h-8 w-16 items-center rounded-full border transition-colors ${value ? 'border-success bg-success/10 justify-end' : 'border-border bg-surface justify-start'} px-1`}>
      <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny font-medium shadow ${value ? 'bg-success text-white' : 'bg-white text-fg-secondary'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    </button>
  );
}

const STATUSES = ['active', 'disabled'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', disabled: 'Paused' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', disabled: 'bg-warning' };

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

interface FormState {
  code: string; status: 'active' | 'disabled'; offerId: string; publisherId: string;
  setStart: boolean; startsAt: string; setEnd: boolean; endsAt: string;
  description: string; notes: string;
}
const INITIAL: FormState = { code: '', status: 'active', offerId: '', publisherId: '', setStart: false, startsAt: '', setEnd: false, endsAt: '', description: '', notes: '' };

export default function CouponCodeForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<CouponCode>(isEdit ? `/api/coupon-codes/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/coupon-codes', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/coupon-codes/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      code: existing.code,
      status: existing.status === 'active' ? 'active' : 'disabled',
      offerId: existing.offerId, publisherId: existing.publisherId ?? '',
      setStart: Boolean(existing.startsAt), startsAt: toDateInput(existing.startsAt),
      setEnd: Boolean(existing.endsAt), endsAt: toDateInput(existing.endsAt),
      description: existing.description ?? '', notes: existing.notes ?? '',
    });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      code: form.code,
      status: form.status,
      offerId: form.offerId,
      publisherId: form.publisherId || null,
      startsAt: form.setStart && form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.setEnd && form.endsAt ? new Date(form.endsAt).toISOString() : null,
      description: form.description || null,
      notes: form.notes || null,
    };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-coupons');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Coupon Code' : 'Add Coupon Code'} subtitle={`Partners › Coupon Codes › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Coupon Code *">
              <input className="input" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </Field>
            <div>
              <label className="label mb-2 block">Status *</label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v as FormState['status'] }))} labels={STATUS_LABEL} dots={STATUS_DOT} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Offer *">
              <select className="input" required value={form.offerId} onChange={(e) => setForm((f) => ({ ...f, offerId: e.target.value }))}>
                <option value="">Select an offer…</option>
                {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Partner">
              <select className="input" value={form.publisherId} onChange={(e) => setForm((f) => ({ ...f, publisherId: e.target.value }))}>
                <option value="">None</option>
                {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="label mb-2 block">Set Start Date</label>
              <div className="flex items-center gap-3">
                <YesNoToggle value={form.setStart} onChange={(v) => setForm((f) => ({ ...f, setStart: v }))} />
                {form.setStart && (
                  <input type="date" className="input" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
                )}
              </div>
            </div>
            <div>
              <label className="label mb-2 block">Set End Date</label>
              <div className="flex items-center gap-3">
                <YesNoToggle value={form.setEnd} onChange={(v) => setForm((f) => ({ ...f, setEnd: v }))} />
                {form.setEnd && (
                  <input type="date" className="input" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
                )}
              </div>
            </div>
          </div>

          <Field label="Description">
            <textarea className="input min-h-[90px]" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>

          <Field label="Internal Notes">
            <input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-coupons" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
