/**
 * Add Conversion — full page (Everflow-style), verified against the live reference's dedicated
 * `/reporting/imports/conversions/add` page: Offer/Event/Partner selects, a "Number of Conversions"
 * count, then a set of "No/Yes" toggle rows that reveal a field when switched on.
 *
 * Field scope is limited to what `POST /api/offline/conversions` actually accepts
 * (api-backend/src/surfaces/dashboard/offline/routes.ts): offerId, publisherId, event, payout,
 * revenue, currency, status, txnId. There is no currency control: the request omits `currency`, so the
 * backend records the conversion in the SELECTED OFFER's currency (shown under the amounts). Payout
 * and revenue are checked as you type with the backend's rule (lib/moneyInput.ts — non-negative,
 * ≤ 4 decimals, no thousands separators); a 422 the backend still returns is shown with its field
 * details. The reference's Timezone/Now/Internal Notes/Sale Amount/Source
 * ID/Sub Parameters/Adv Parameters/Email/Coupon Code toggles have no backing field on this app's
 * `conversions` table for a manually-recorded row, so they're omitted rather than shown as inert
 * controls that would silently do nothing on submit. "Number of Conversions" IS real — it fires the
 * same create call N times, since there's no dedicated bulk endpoint.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { checkMoneyInput } from '../../lib/moneyInput';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Field } from '../../shared-components/primitives/ui';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import type { Offer, Publisher } from '../../types';

function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
      <button type="button" onClick={() => onChange(false)}
        className={`px-3 py-1.5 text-small font-medium ${!value ? 'bg-page text-fg' : 'text-fg-secondary hover:bg-page'}`}>No</button>
      <button type="button" onClick={() => onChange(true)}
        className={`px-3 py-1.5 text-small font-medium ${value ? 'bg-success/15 text-success-text' : 'text-fg-secondary hover:bg-page'}`}>Yes</button>
    </div>
  );
}

interface FormState {
  offerId: string; event: string; publisherId: string; count: string; status: string;
  revenueOn: boolean; revenue: string;
  payoutOn: boolean; payout: string;
  txnOn: boolean; txnId: string;
}
/** An API error's message plus its per-field details (a 422 from zod: `{ payout: ['…'] }`). */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return 'Request failed';
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== 'object') return err.message;
  const parts = Object.entries(err.details as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => `${k === '_errors' ? '' : `${k}: `}${(v as unknown[]).join(', ')}`);
  return parts.length ? `${err.message} — ${parts.join('; ')}` : err.message;
}

const INITIAL: FormState = {
  offerId: '', event: '', publisherId: '', count: '1', status: 'approved',
  revenueOn: false, revenue: '', payoutOn: false, payout: '', txnOn: false, txnId: '',
};

export default function AddConversion() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [form, setForm] = useState<FormState>(() => ({ ...INITIAL, offerId: searchParams.get('offerId') ?? '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // The backend records the conversion in the selected offer's currency (the request sends none).
  const offerCurrency = (offers ?? []).find((o) => o.id === form.offerId)?.currency?.trim().toUpperCase() || null;
  // An amount switched on but left empty is simply not sent (as before); a typed one must be valid.
  const revenueCheck = form.revenueOn && form.revenue.trim() !== '' ? checkMoneyInput(form.revenue) : null;
  const payoutCheck = form.payoutOn && form.payout.trim() !== '' ? checkMoneyInput(form.payout) : null;
  const amountsInvalid = revenueCheck?.ok === false || payoutCheck?.ok === false;
  const amountHint = offerCurrency ? `In ${offerCurrency} — the offer's currency` : "In the selected offer's currency";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (amountsInvalid) return;
    setBusy(true);
    setError(null);
    const base: Record<string, unknown> = {
      offerId: form.offerId,
      publisherId: form.publisherId || null,
      event: form.event || null,
      status: form.status,
      // No `currency`: the backend uses the selected offer's currency.
      ...(revenueCheck?.ok ? { revenue: revenueCheck.value } : {}),
      ...(payoutCheck?.ok ? { payout: payoutCheck.value } : {}),
    };
    const n = Math.max(1, Math.min(500, Number(form.count) || 1));
    // Transaction ID is unique per offer (real DB constraint) — a real user creating N conversions
    // at once means N distinct real-world transactions, so each gets its own suffixed ID rather than
    // colliding on the same one.
    try {
      for (let i = 0; i < n; i++) {
        const body = { ...base, ...(form.txnOn && form.txnId ? { txnId: n > 1 ? `${form.txnId}-${i + 1}` : form.txnId } : {}) };
        await api.post('/api/offline/conversions', body);
      }
      nav('/app/reports/offline');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Add Conversion" subtitle="Reporting › Conversion Imports › Add" action={
        <Link to="/app/reports/offline" className="btn-ghost">Back</Link>
      } />
      <form onSubmit={submit}>
        <FormLayout requiredNote="Fields with an asterisk (*) are mandatory.">
          <div className="space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Offer *">
              <select className="input" required value={form.offerId} onChange={(e) => set('offerId', e.target.value)}>
                <option value="" disabled>Select Offer…</option>
                {(offers ?? []).map((o) => <option key={o.id} value={o.id}>({o.ref ?? '—'}) {o.name}</option>)}
              </select>
            </Field>
            <Field label="Event">
              <input className="input" value={form.event} onChange={(e) => set('event', e.target.value)} placeholder="e.g. purchase" />
            </Field>
            <Field label="Partner">
              <select className="input" value={form.publisherId} onChange={(e) => set('publisherId', e.target.value)}>
                <option value="">Select Partner…</option>
                {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>({p.ref ?? '—'}) {p.name}</option>)}
              </select>
            </Field>
            <Field label="Number of Conversions">
              <input type="number" min={1} max={500} className="input" value={form.count} onChange={(e) => set('count', e.target.value)} />
            </Field>
          </div>

          <div className="divide-y divide-border border-y border-border">
            <div className="flex items-center justify-between py-3">
              <span className="text-small text-fg">Revenue Amount per Conversion</span>
              <YesNoToggle value={form.revenueOn} onChange={(v) => set('revenueOn', v)} />
            </div>
            {form.revenueOn && (
              <div className="pb-3">
                <input className="input" inputMode="decimal" placeholder="8.00" value={form.revenue} onChange={(e) => set('revenue', e.target.value)}
                  aria-invalid={revenueCheck?.ok === false} aria-describedby="revenue-help" />
                <p id="revenue-help" className={`mt-1 text-tiny ${revenueCheck?.ok === false ? 'text-danger-text' : 'text-fg-muted'}`}>
                  {revenueCheck?.ok === false ? revenueCheck.error : amountHint}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between py-3">
              <span className="text-small text-fg">Payout Amount per Conversion</span>
              <YesNoToggle value={form.payoutOn} onChange={(v) => set('payoutOn', v)} />
            </div>
            {form.payoutOn && (
              <div className="pb-3">
                <input className="input" inputMode="decimal" placeholder="5.00" value={form.payout} onChange={(e) => set('payout', e.target.value)}
                  aria-invalid={payoutCheck?.ok === false} aria-describedby="payout-help" />
                <p id="payout-help" className={`mt-1 text-tiny ${payoutCheck?.ok === false ? 'text-danger-text' : 'text-fg-muted'}`}>
                  {payoutCheck?.ok === false ? payoutCheck.error : amountHint}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between py-3">
              <span className="text-small text-fg">Transaction ID</span>
              <YesNoToggle value={form.txnOn} onChange={(v) => set('txnOn', v)} />
            </div>
            {form.txnOn && <div className="pb-3"><input className="input" placeholder="txn-12345" value={form.txnId} onChange={(e) => set('txnId', e.target.value)} /></div>}
          </div>

          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {['approved', 'pending', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="mt-1 text-tiny text-fg-muted">
              On offers with Manually Approve Conversions on, "approved" is saved as pending until someone approves it. A partner
              must be active and allowed on the offer (approved on private or request-access offers). No partner postback fires.
            </p>
          </Field>

          </div>
        </FormLayout>
        <FormFooter cancel={<Link to="/app/reports/offline" className="btn-ghost">Cancel</Link>}
          primary={{ label: busy ? 'Adding…' : 'Add', disabled: busy || !form.offerId || amountsInvalid }} />
      </form>
    </>
  );
}
