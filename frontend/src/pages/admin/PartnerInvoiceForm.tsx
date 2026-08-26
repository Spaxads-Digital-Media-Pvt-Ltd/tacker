/**
 * Add/Edit Invoice — matches the reference's Add Invoice form: Partner, Payment Period (billed
 * amount is computed server-side from the real ledger for that partner/period at creation, not
 * entered manually), Invoice Hidden From Partner, Payment Terms, Public/Internal Notes. Edit only
 * allows changing the partner-facing/administrative fields, not the period or amount — matching how
 * a real invoice, once generated, keeps its billed snapshot.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { PartnerInvoice, Publisher } from '../../types';

const PAYMENT_TERMS_OPTIONS = ['None', 'Net 7', 'Net 15', 'Net 30', 'Net 60'];

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

interface FormState {
  publisherId: string; periodStart: string; periodEnd: string; hidden: boolean; paymentTerms: string; publicNotes: string; internalNotes: string;
}
const INITIAL: FormState = { publisherId: '', periodStart: '', periodEnd: '', hidden: false, paymentTerms: '', publicNotes: '', internalNotes: '' };

export default function PartnerInvoiceForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<PartnerInvoice>(isEdit ? `/api/partner-invoices/${id}` : null);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/partner-invoices', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/partner-invoices/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      publisherId: existing.publisherId, periodStart: existing.periodStart, periodEnd: existing.periodEnd,
      hidden: !existing.visibleToPartner, paymentTerms: existing.paymentTerms ?? '',
      publicNotes: existing.publicNotes ?? '', internalNotes: existing.internalNotes ?? '',
    });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isEdit) {
      const res = await update.run({
        visibleToPartner: !form.hidden, paymentTerms: form.paymentTerms || null,
        publicNotes: form.publicNotes || null, internalNotes: form.internalNotes || null,
      });
      if (res) nav('/app/aff-invoices');
      return;
    }
    const res = await create.run({
      publisherId: form.publisherId, periodStart: form.periodStart, periodEnd: form.periodEnd,
      visibleToPartner: !form.hidden, paymentTerms: form.paymentTerms || null,
      publicNotes: form.publicNotes || null, internalNotes: form.internalNotes || null,
    });
    if (res) nav('/app/aff-invoices');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Invoice' : 'Add Invoice'} subtitle={`Partners › Invoices › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <Field label="Partner *">
            {isEdit ? (
              <input className="input" disabled value={existing?.publisherName ?? ''} />
            ) : (
              <select className="input" required value={form.publisherId} onChange={(e) => setForm((f) => ({ ...f, publisherId: e.target.value }))}>
                <option value="">Select Partner…</option>
                {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Start Date *">
              {isEdit ? <input className="input" disabled value={existing?.periodStart ?? ''} />
                : <input type="date" className="input" required value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />}
            </Field>
            <Field label="End Date *">
              {isEdit ? <input className="input" disabled value={existing?.periodEnd ?? ''} />
                : <input type="date" className="input" required min={form.periodStart || undefined} value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />}
            </Field>
          </div>
          {!isEdit && <p className="-mt-4 text-tiny text-fg-secondary">Billed amount is calculated automatically from this Partner's ledger activity within the payment period.</p>}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="label mb-2 block">Invoice Hidden From Partner</label>
              <YesNoToggle value={form.hidden} onChange={(v) => setForm((f) => ({ ...f, hidden: v }))} />
            </div>
            <Field label="Payment Terms">
              <select className="input" value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}>
                <option value="">Select Payment Terms…</option>
                {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Public Notes">
            <textarea className="input min-h-[70px]" value={form.publicNotes} onChange={(e) => setForm((f) => ({ ...f, publicNotes: e.target.value }))} />
          </Field>
          <Field label="Internal Notes">
            <textarea className="input min-h-[70px]" value={form.internalNotes} onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))} />
          </Field>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-invoices" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
