/**
 * Add/Edit Invoice (Advertisers) — matches the reference: Advertiser, Payment Terms, Payment
 * Period, Invoice Hidden From Advertiser, Notes. Billed amount is computed server-side from the
 * real ledger for that advertiser/period at creation — not entered manually. Edit only allows
 * changing the advertiser-facing/administrative fields, not the period or amount.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import type { AdvertiserInvoice, Advertiser } from '../../types';
import { InvoiceCurrencyPicker } from './InvoiceCurrencyPicker';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormSection } from '../../shared-components/forms/FormSection';
import { FormFooter } from '../../shared-components/forms/FormFooter';

const PAYMENT_TERMS_OPTIONS = ['None', 'Net 7', 'Net 15', 'Net 30', 'Net 60'];

interface FormState {
  advertiserId: string; periodStart: string; periodEnd: string; currency: string; hidden: boolean; paymentTerms: string; notes: string;
}
const INITIAL: FormState = { advertiserId: '', periodStart: '', periodEnd: '', currency: '', hidden: false, paymentTerms: '', notes: '' };

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
      advertiserId: existing.advertiserId, periodStart: existing.periodStart, periodEnd: existing.periodEnd, currency: existing.currency,
      hidden: !existing.visibleToAdvertiser, paymentTerms: existing.paymentTerms ?? '', notes: existing.notes ?? '',
    });
  }, [existing]);

  const setCurrency = useCallback((currency: string) => setForm((f) => ({ ...f, currency })), []);
  const previewPath = !isEdit && form.advertiserId && form.periodStart && form.periodEnd && form.periodEnd >= form.periodStart
    ? `/api/advertiser-invoices/preview?advertiserId=${form.advertiserId}&periodStart=${form.periodStart}&periodEnd=${form.periodEnd}`
    : null;

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
      ...(form.currency ? { currency: form.currency } : {}),
      visibleToAdvertiser: !form.hidden, paymentTerms: form.paymentTerms || null, notes: form.notes || null,
    });
    if (res) nav('/app/adv-invoices');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Invoice' : 'Add Invoice'} subtitle={`Advertisers › Invoices › ${isEdit ? 'Edit' : 'Add'}`} />
        <form onSubmit={submit}>
        <FormLayout requiredNote="Fields with an asterisk (*) are mandatory.">
          <div className="space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}

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

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field label="Start Date *">
              {isEdit ? <input className="input" disabled value={existing?.periodStart ?? ''} />
                : <input type="date" className="input" required value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />}
            </Field>
            <Field label="End Date *">
              {isEdit ? <input className="input" disabled value={existing?.periodEnd ?? ''} />
                : <input type="date" className="input" required min={form.periodStart || undefined} value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />}
            </Field>
          </div>
          {isEdit ? (
            <Field label="Currency"><input className="input" disabled value={existing?.currency ?? ''} /></Field>
          ) : (
            <div>
              <label className="label">Currency *</label>
              <InvoiceCurrencyPicker previewPath={previewPath} value={form.currency} onChange={setCurrency} what="billed" />
              <p className="mt-1.5 text-tiny text-fg-secondary">The billed amount is what this advertiser was billed in that currency over the period (from the ledger).</p>
            </div>
          )}

          <div>
            <ToggleRow label="Invoice Hidden From Advertiser" checked={form.hidden} onChange={(v) => setForm((f) => ({ ...f, hidden: v }))} />
            <p className="mt-1 text-[11px] text-fg-muted">Saved on the invoice. The advertiser portal doesn't list invoices yet, so it has no visible effect today.</p>
          </div>

          {/* Optional — create: collapsed; edit: open when the saved invoice has text (keyed so it
              re-mounts once the record arrives — the form state is copied in by an effect). */}
          <FormSection key={existing?.id ?? 'new'} id="adv-invoice-notes" title="Notes" collapsible summary="Notes"
            defaultOpen={Boolean(existing?.notes?.trim())} filledCount={form.notes.trim() ? 1 : 0}>
            <div className="pt-2">
              <Field label="Notes">
                <textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
          </FormSection>

          </div>
        </FormLayout>
        <FormFooter cancel={<Link to="/app/adv-invoices" className="btn-ghost">Cancel</Link>}
          primary={{ label: busy ? 'Saving…' : isEdit ? 'Save' : 'Add', disabled: busy || (!isEdit && previewPath !== null && !form.currency) }} />
        </form>
    </>
  );
}
