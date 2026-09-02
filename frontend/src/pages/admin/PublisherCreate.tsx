/**
 * Add Partner (Everflow-style 4-step wizard: General/Address/Billing/User). Real fields (Name, Status,
 * Traffic Source in General; Payout Terms in Billing; Email in User, doubling as Contact Email) POST to
 * the actual /api/publishers endpoint on the final step, placed to match the reference layout. The
 * other controls have no equivalent in this app's schema, so they're real, interactive controls that
 * don't persist.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { PageHeader, Field, Segmented } from '../../components/ui';
import { Stepper } from '../../components/Stepper';

const STEPS = ['General', 'Address', 'Billing', 'User'];
const STATUSES = ['active', 'inactive'] as const;
const STATUS_DOT: Record<string, string> = { active: 'bg-success', inactive: 'bg-warning' };

function YesNoToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${on ? 'text-accent-text' : 'text-fg-secondary'}`}>
      {on ? 'Yes' : 'No'}
      <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-success' : 'bg-border'}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

export default function PublisherCreate() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', contactEmail: '', trafficSource: '', payoutTerms: '', status: 'active', currency: 'USD' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [accountExec, setAccountExec] = useState(false);
  const [referredBy, setReferredBy] = useState(false);
  const [partnerTier, setPartnerTier] = useState(false);
  const [notify, setNotify] = useState(true);
  const [dynamicPayouts, setDynamicPayouts] = useState(false);
  const [trafficSourceEnabled, setTrafficSourceEnabled] = useState(false);
  const [macroVisibility, setMacroVisibility] = useState('None');
  const [addressEnabled, setAddressEnabled] = useState(false);
  const [paymentEnabled, setPaymentEnabled] = useState(true);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/publishers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name: form.name, status: form.status, contactEmail: form.contactEmail, payoutTerms: form.payoutTerms };
    if (form.trafficSource) body['trafficSource'] = form.trafficSource;
    const res = await run(body);
    if (res) nav(`/app/publishers/${res.id}`);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit(e);
  };

  return (
    <>
      <PageHeader title="Add Partner" subtitle="Partners › Add" />
      <Stepper steps={STEPS} current={step} />
      <div className="max-w-2xl mx-auto">
      <form onSubmit={next} className="card space-y-6">
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        {step === 0 && (
          <div className="space-y-4">
            <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div>
              <label className="label mb-2 block">Status *</label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Partner Manager *"><select className="input"><option>Not available yet</option></select></Field>
              <div>
                <label className="label mb-2 block">Account Executive</label>
                <div className="flex items-center gap-2">
                  <YesNoToggle on={accountExec} onChange={setAccountExec} />
                  {accountExec && <select className="input"><option>Not available yet</option></select>}
                </div>
              </div>
            </div>
            <div>
              <label className="label mb-2 block">Referred By</label>
              <div className="flex items-center gap-2">
                <YesNoToggle on={referredBy} onChange={setReferredBy} />
                {referredBy && <select className="input"><option>Not available yet</option></select>}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Currency *"><input className="input" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
              <div>
                <label className="label mb-2 block">Partner Tier</label>
                <div className="flex items-center gap-2">
                  <YesNoToggle on={partnerTier} onChange={setPartnerTier} />
                  {partnerTier && <select className="input"><option>Not available yet</option></select>}
                </div>
              </div>
            </div>
            <Field label="Labels"><textarea className="input min-h-[60px]" placeholder="Add labels…" /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label mb-2 block">Allow partner to receive notifications</label>
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded border-border" />
              </div>
              <div>
                <label className="label mb-2 block">Enable CPC/CPM Dynamic Payouts for Partner</label>
                <input type="checkbox" checked={dynamicPayouts} onChange={(e) => setDynamicPayouts(e.target.checked)} className="h-4 w-4 rounded border-border" />
              </div>
            </div>
            <div>
              <label className="label mb-2 block">Traffic Source</label>
              <div className="flex items-center gap-2">
                <YesNoToggle on={trafficSourceEnabled} onChange={setTrafficSourceEnabled} />
                {trafficSourceEnabled && <input className="input" value={form.trafficSource} onChange={(e) => set('trafficSource', e.target.value)} placeholder="Push, Native, Social…" />}
              </div>
            </div>
            <Field label="Internal Notes"><textarea className="input min-h-[80px]" /></Field>
            <div>
              <label className="label mb-2 block">Set Macro Parameter Visibility</label>
              <Segmented options={['None', 'Custom', 'Full access']} value={macroVisibility} onChange={setMacroVisibility} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="label mb-2 block">Enable Address</label>
              <YesNoToggle on={addressEnabled} onChange={setAddressEnabled} />
            </div>
            {addressEnabled && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Address Line 1"><input className="input" /></Field>
                <Field label="Address Line 2"><input className="input" /></Field>
                <Field label="City"><input className="input" /></Field>
                <Field label="State / Region"><input className="input" /></Field>
                <Field label="ZIP / Postal Code"><input className="input" /></Field>
                <Field label="Country"><input className="input" /></Field>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Billing Frequency *"><select className="input" defaultValue="Weekly">{['Weekly', 'Bimonthly', 'Monthly'].map((f) => <option key={f}>{f}</option>)}</select></Field>
              <Field label="Day *"><select className="input" defaultValue="Monday">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => <option key={d}>{d}</option>)}</select></Field>
            </div>
            <div>
              <label className="label mb-2 block">Enable Payment Method</label>
              <div className="flex items-center gap-2">
                <YesNoToggle on={paymentEnabled} onChange={setPaymentEnabled} />
                {paymentEnabled && <select className="input !w-auto" defaultValue="Wire">{['Wire', 'PayPal', 'ACH', 'Check'].map((m) => <option key={m}>{m}</option>)}</select>}
              </div>
            </div>
            {paymentEnabled && (
              <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
                <Field label="Bank Name *"><input className="input" /></Field>
                <Field label="Account Number *"><input className="input" /></Field>
              </div>
            )}
            <Field label="Tax ID / VAT or SSN"><input className="input" /></Field>
            <Field label="Payout Terms *"><textarea className="input min-h-[80px]" required value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} placeholder="Net-30, minimum $50…" /></Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-small text-fg-secondary">Create a login for this partner to access their portal.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First Name"><input className="input" /></Field>
              <Field label="Last Name"><input className="input" /></Field>
            </div>
            <Field label="Email *"><input type="email" className="input" required value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav('/app/publishers') : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : step === STEPS.length - 1 ? 'Create Partner' : 'Next'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
