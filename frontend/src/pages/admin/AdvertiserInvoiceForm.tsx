/**
 * Add/Edit Invoice (Advertisers) — matches the reference: Advertiser, Payment Terms, Payment
 * Period, Invoice Hidden From Advertiser, Notes. Billed amount is computed server-side from the
 * real ledger for that advertiser/period at creation — not entered manually. Edit only allows
 * changing the advertiser-facing/administrative fields, not the period or amount.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { AdvertiserInvoice, Advertiser } from '../../types';

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
  advertiserId: string; periodStart: string; periodEnd: string; hidden: boolean; paymentTerms: string; notes: string;
}
const INITIAL: FormState = { advertiserId: '', periodStart: '', periodEnd: '', hidden: false, paymentTerms: '', notes: '' };

export default function AdvertiserInvoiceForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<AdvertiserInvoice>(isEdit ? `/api/advertiser-invoices/${id}` : null);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/advertiser-invoices', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/advertiser-invoices/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      advertiserId: existing.advertiserId, periodStart: existing.periodStart, periodEnd: existing.periodEnd,
      hidden: !existing.visibleToAdvertiser, paymentTerms: existing.paymentTerms ?? '', notes: existing.notes ?? '',
    });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isEdit) {
      const res = await update.run({
        visibleToAdvertiser: !form.hidden, paymentTerms: form.paymentTerms || null, notes: form.notes || null,
      });
      if (res) nav('/app/adv-invoices');
      return;
    }
    const res = await create.run({
      advertiserId: form.advertiserId, periodStart: form.periodStart, periodEnd: form.periodEnd,
      visibleToAdvertiser: !form.hidden, paymentTerms: form.paymentTerms || null, notes: form.notes || null,
    });
    if (res) nav('/app/adv-invoices');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Invoice' : 'Add Invoice'} subtitle={`Advertisers › Invoices › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <Field label="Advertiser *">
            {isEdit ? (
              <input className="input" disabled value={existing?.advertiserName ?? ''} />
            ) : (
              <select className="input" required value={form.advertiserId} onChange={(e) => setForm((f) => ({ ...f, advertiserId: e.target.value }))}>
                <option value="">Select Advertiser…</option>
                {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </Field>

          <Field label="Payment Terms *">
            <select className="input" required value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}>
              <option value="">Select Payment Terms…</option>
              {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
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
          {!isEdit && <p className="-mt-4 text-tiny text-fg-secondary">Billed amount is calculated automatically from this Advertiser's ledger activity within the payment period.</p>}

          <div>
            <label className="label mb-2 block">Invoice Hidden From Advertiser</label>
            <YesNoToggle value={form.hidden} onChange={(v) => setForm((f) => ({ ...f, hidden: v }))} />
          </div>

          <Field label="Notes">
            <textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/adv-invoices" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
