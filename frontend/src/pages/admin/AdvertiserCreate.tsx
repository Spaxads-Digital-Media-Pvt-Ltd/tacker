/**
 * Add Advertiser (Everflow-style 5-step wizard: General/Address/Billing/Additional Information/User).
 * Real fields (Name, Status, Default Currency, Account Manager, Sales Manager, Verification token in
 * General; Billing Frequency, Billing Terms in Billing; Email in User, doubling as Contact Email)
 * POST to the actual /api/advertisers endpoint on the final step, placed to match the reference
 * layout. Labels can't be assigned until the advertiser exists (Edit has the real tag editor). The
 * remaining controls have no equivalent in this app's schema, so they're real, interactive controls
 * that don't persist.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Segmented } from '../../components/ui';
import { Stepper } from '../../components/Stepper';
import type { DashboardUser } from '../../types';

const BILLING_FREQUENCIES = ['Weekly', 'Bimonthly', 'Monthly'];

const STEPS = ['General', 'Address', 'Billing', 'Additional Information', 'User'];
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

export default function AdvertiserCreate() {
  const nav = useNavigate();
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '', contactEmail: '', billingTerms: '', status: 'active', defaultCurrency: 'USD',
    accountManagerId: '', salesManagerId: '', billingFrequency: '', verificationToken: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [variables, setVariables] = useState(false);
  const [attribution, setAttribution] = useState('Last Touch');
  const [priority, setPriority] = useState('Click');
  const [emailAttribution, setEmailAttribution] = useState('Last Partner Attribution');
  const [addressEnabled, setAddressEnabled] = useState(false);
  const [autoInvoice, setAutoInvoice] = useState(true);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/advertisers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, defaultCurrency: form.defaultCurrency,
      contactEmail: form.contactEmail, billingTerms: form.billingTerms,
      accountManagerId: form.accountManagerId || null, salesManagerId: form.salesManagerId || null,
      billingFrequency: form.billingFrequency || null, verificationToken: form.verificationToken || null,
    };
    const res = await run(body);
    if (res) nav(`/app/advertisers/${res.id}`);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit(e);
  };

  return (
    <>
      <PageHeader title="Add Advertiser" subtitle="Advertisers › Add" />
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
              <Field label="Advertiser Manager">
                <select className="input" value={form.accountManagerId} onChange={(e) => set('accountManagerId', e.target.value)}>
                  <option value="">None</option>
                  {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Default Currency *"><input className="input" maxLength={3} required value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())} /></Field>
            </div>
            <Field label="Sales Manager">
              <select className="input" value={form.salesManagerId} onChange={(e) => set('salesManagerId', e.target.value)}>
                <option value="">None</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <p className="text-tiny text-fg-secondary">Labels can be added once the advertiser is created (Edit → General).</p>
            <Field label="Verification token"><input className="input" value={form.verificationToken} onChange={(e) => set('verificationToken', e.target.value)} /></Field>
            <div>
              <label className="label mb-2 block">Attribution Method *</label>
              <Segmented options={['Last Touch', 'First Touch']} value={attribution} onChange={setAttribution} />
            </div>
            <div>
              <label className="label mb-2 block">Attribution Priority *</label>
              <Segmented options={['Click', 'Coupon Code']} value={priority} onChange={setPriority} />
            </div>
            <div>
              <label className="label mb-2 block">Email Attribution Method *</label>
              <Segmented options={['Last Partner Attribution', 'First Partner Attribution']} value={emailAttribution} onChange={setEmailAttribution} />
            </div>
            <div>
              <label className="label mb-2 block">Enable Variables exposed in the Advertiser UI</label>
              <YesNoToggle on={variables} onChange={setVariables} />
            </div>
            <Field label="Internal Notes"><textarea className="input min-h-[80px]" /></Field>
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
              <Field label="Billing Frequency *">
                <select className="input" value={form.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value)}>
                  <option value="">Select…</option>
                  {BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Day *"><select className="input" defaultValue="Monday">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => <option key={d}>{d}</option>)}</select></Field>
            </div>
            <Field label="Tax ID / VAT or SSN"><input className="input" /></Field>
            <Field label="Billing Terms *"><textarea className="input min-h-[80px]" required value={form.billingTerms} onChange={(e) => set('billingTerms', e.target.value)} placeholder="Net-30, prepay…" /></Field>
            <div>
              <label className="label mb-2 block">Automatic Invoice Creation</label>
              <YesNoToggle on={autoInvoice} onChange={setAutoInvoice} />
            </div>
            {autoInvoice && (
              <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
                <Field label="Auto Invoice Start Date"><input type="date" className="input" /></Field>
                <Field label="Invoice Generation Delay *"><select className="input" defaultValue="No Delay">{['No Delay', '5 Days', '10 Days'].map((d) => <option key={d}>{d}</option>)}</select></Field>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-h3 font-medium text-fg">Platform</h3>
            <Field label="Platform Name"><input className="input" /></Field>
            <Field label="Platform URL"><input className="input" /></Field>
            <Field label="Timezone *"><select className="input"><option>(GMT+00:00) UTC</option></select></Field>
            <h3 className="text-h3 font-medium text-fg">Direct Linking</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Offer ID Parameter"><input className="input" defaultValue="oid" /></Field>
              <Field label="Partner ID Parameter"><input className="input" defaultValue="affid" /></Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-small text-fg-secondary">Create a login for this advertiser to access their portal.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First Name"><input className="input" /></Field>
              <Field label="Last Name"><input className="input" /></Field>
            </div>
            <Field label="Email *"><input type="email" className="input" required value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav('/app/advertisers') : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : step === STEPS.length - 1 ? 'Create Advertiser' : 'Next'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
