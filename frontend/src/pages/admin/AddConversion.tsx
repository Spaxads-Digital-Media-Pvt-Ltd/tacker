/**
 * Add Conversion — full page (Everflow-style), verified against the live reference's dedicated
 * `/reporting/imports/conversions/add` page: Offer/Event/Partner selects, a "Number of Conversions"
 * count, then a set of "No/Yes" toggle rows that reveal a field when switched on.
 *
 * Field scope is limited to what `POST /api/offline/conversions` actually accepts
 * (api-backend/src/surfaces/dashboard/offline/routes.ts): offerId, publisherId, event, payout,
 * revenue, currency, status, txnId. The reference's Timezone/Now/Internal Notes/Sale Amount/Source
 * ID/Sub Parameters/Adv Parameters/Email/Coupon Code toggles have no backing field on this app's
 * `conversions` table for a manually-recorded row, so they're omitted rather than shown as inert
 * controls that would silently do nothing on submit. "Number of Conversions" IS real — it fires the
 * same create call N times, since there's no dedicated bulk endpoint.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
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
  offerId: string; event: string; publisherId: string; count: string; status: string; currency: string;
  revenueOn: boolean; revenue: string;
  payoutOn: boolean; payout: string;
  txnOn: boolean; txnId: string;
}
const INITIAL: FormState = {
  offerId: '', event: '', publisherId: '', count: '1', status: 'approved', currency: 'USD',
  revenueOn: false, revenue: '', payoutOn: false, payout: '', txnOn: false, txnId: '',
};

export default function AddConversion() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const [form, setForm] = useState<FormState>(() => ({ ...INITIAL, offerId: searchParams.get('offerId') ?? '', currency: settings?.general?.defaultCurrency ?? 'USD' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const base: Record<string, unknown> = {
      offerId: form.offerId,
      publisherId: form.publisherId || null,
      event: form.event || null,
      status: form.status,
      currency: form.currency,
      ...(form.revenueOn && form.revenue ? { revenue: form.revenue } : {}),
      ...(form.payoutOn && form.payout ? { payout: form.payout } : {}),
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
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Add Conversion" subtitle="Reporting › Conversion Imports › Add" action={
        <Link to="/app/reports/offline" className="btn-ghost">Back</Link>
      } />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {form.revenueOn && <div className="pb-3"><input className="input" placeholder="8.00" value={form.revenue} onChange={(e) => set('revenue', e.target.value)} /></div>}

            <div className="flex items-center justify-between py-3">
              <span className="text-small text-fg">Payout Amount per Conversion</span>
              <YesNoToggle value={form.payoutOn} onChange={(v) => set('payoutOn', v)} />
            </div>
            {form.payoutOn && <div className="pb-3"><input className="input" placeholder="5.00" value={form.payout} onChange={(e) => set('payout', e.target.value)} /></div>}

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
          </Field>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/reports/offline" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy || !form.offerId}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
