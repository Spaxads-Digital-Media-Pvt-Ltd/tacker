/**
 * Add/Edit Coupon Code — matches the reference: Coupon Code, Status (Active/Paused — Paused maps
 * onto this table's existing 'disabled' value, see coupon-codes/routes.ts), Offer, Partner,
 * Set Start/End Date toggles that reveal a date input, Description, Internal Notes.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormSection } from '../../shared-components/forms/FormSection';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import { StatusChoice } from '../../shared-components/forms/ChoiceCards';
import type { CouponCode, Offer, Publisher } from '../../types';

// Paused maps onto this table's existing 'disabled' value (the value sent is unchanged).
const STATUS_OPTIONS = [{ value: 'active', label: 'Active', tone: 'success' }, { value: 'disabled', label: 'Paused', tone: 'warning' }] as const;

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
      <form onSubmit={submit}>
        <FormLayout requiredNote="Fields with an asterisk (*) are mandatory.">
          <div className="space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
            <Field label="Coupon Code *">
              <input className="input" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </Field>
            <div>
              <span id="coupon-status-label" className="label">Status *</span>
              <StatusChoice options={STATUS_OPTIONS} value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} ariaLabelledby="coupon-status-label" />
            </div>
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

          {/* Optional — create: collapsed; edit: open when the saved coupon has a value (keyed so it
              re-mounts once the record arrives — the form state is copied in by an effect). */}
          <FormSection key={`schedule-${existing?.id ?? 'new'}`} id="coupon-schedule" title="Schedule" collapsible summary="Set Start Date · Set End Date"
            defaultOpen={Boolean(existing?.startsAt || existing?.endsAt)} filledCount={(form.setStart ? 1 : 0) + (form.setEnd ? 1 : 0)}>
            <div className="grid grid-cols-1 gap-5 pt-2 md:grid-cols-2 md:items-start">
              <div className="space-y-2">
                <ToggleRow label="Set Start Date" checked={form.setStart} onChange={(v) => setForm((f) => ({ ...f, setStart: v }))} />
                {form.setStart && (
                  <input type="date" className="input" aria-label="Start date" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
                )}
              </div>
              <div className="space-y-2">
                <ToggleRow label="Set End Date" checked={form.setEnd} onChange={(v) => setForm((f) => ({ ...f, setEnd: v }))} />
                {form.setEnd && (
                  <input type="date" className="input" aria-label="End date" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
                )}
              </div>
            </div>
          </FormSection>

          <FormSection key={`notes-${existing?.id ?? 'new'}`} id="coupon-notes" title="Notes" collapsible summary="Description · Internal Notes"
            defaultOpen={Boolean(existing?.description || existing?.notes)} filledCount={[form.description, form.notes].filter((v) => v.trim()).length}>
            <div className="space-y-4 pt-2">
              <Field label="Description">
                <textarea className="input min-h-[90px]" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
              <Field label="Internal Notes">
                <input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
          </FormSection>
          </div>
        </FormLayout>
        <FormFooter cancel={<Link to="/app/aff-coupons" className="btn-ghost">Cancel</Link>}
          primary={{ label: busy ? 'Saving…' : isEdit ? 'Save' : 'Add', disabled: busy }} />
      </form>
    </>
  );
}
