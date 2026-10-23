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
import { PageHeader, Field, Segmented } from '../../shared-components/primitives/ui';
import { Stepper } from '../../shared-components/panels/Stepper';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormSection } from '../../shared-components/forms/FormSection';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import { UpNextCard } from '../../shared-components/forms/UpNextCard';
import { StatusChoice } from '../../shared-components/forms/ChoiceCards';
import type { DashboardUser } from '../../types';

const BILLING_FREQUENCIES = ['Weekly', 'Bimonthly', 'Monthly'];

const STEPS = ['General', 'Address', 'Billing', 'Additional Information', 'User'];
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', tone: 'success' }, { value: 'inactive', label: 'Inactive', tone: 'warning' },
] as const;
/** Steps with a required (*) field — the Up next card's Required badge. */
const REQUIRED_STEPS = new Set([2, 3]);

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
      // Optional fields: omit when blank (an empty string would fail the API's email check).
      contactEmail: form.contactEmail.trim() || undefined, billingTerms: form.billingTerms.trim() || undefined,
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

  const isLast = step === STEPS.length - 1;

  return (
    <>
      <PageHeader title="Add Advertiser" subtitle="Advertisers › Add" />
      <Stepper steps={STEPS} current={step} />
      <form onSubmit={next}>
      <FormLayout caption={`Step ${step + 1}`} title={STEPS[step]} requiredNote="Fields with an asterisk (*) are mandatory." layout="centered"
        upNext={isLast ? undefined : <UpNextCard number={step + 2} name={STEPS[step + 1]!} required={REQUIRED_STEPS.has(step + 1)} />}>
        <div className="space-y-6">
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}

        {step === 0 && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
            <div className="md:col-span-2"><Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field></div>
            <div className="md:col-span-2">
              <span id="advertiser-status-label" className="label">Status *</span>
              <StatusChoice options={STATUS_OPTIONS} value={form.status as (typeof STATUS_OPTIONS)[number]['value']} onChange={(v) => set('status', v)} ariaLabelledby="advertiser-status-label" />
            </div>
            <Field label="Advertiser Manager">
              <select className="input" value={form.accountManagerId} onChange={(e) => set('accountManagerId', e.target.value)}>
                <option value="">None</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Default Currency *"><input className="input" maxLength={3} required value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())} /></Field>
            <Field label="Sales Manager">
              <select className="input" value={form.salesManagerId} onChange={(e) => set('salesManagerId', e.target.value)}>
                <option value="">None</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <p className="self-end text-tiny text-fg-secondary md:pb-3">Labels can be added once the advertiser is created (Edit → General).</p>
            <div className="md:col-span-2">
              <label className="label">Attribution Method *</label>
              <Segmented options={['Last Touch', 'First Touch']} value={attribution} onChange={setAttribution} />
            </div>
            <div>
              <label className="label">Attribution Priority *</label>
              <Segmented options={['Click', 'Coupon Code']} value={priority} onChange={setPriority} />
            </div>
            <div>
              <label className="label">Email Attribution Method *</label>
              <Segmented options={['Last Partner Attribution', 'First Partner Attribution']} value={emailAttribution} onChange={setEmailAttribution} />
            </div>
            <div className="md:col-span-2">
              <ToggleRow label="Enable Variables exposed in the Advertiser UI" checked={variables} onChange={setVariables} />
            </div>
            {/* Optional fields only — collapsed by default, kept mounted while collapsed. */}
            <FormSection id="advertiser-optional" title="Optional details" collapsible summary="Verification token · Internal Notes"
              filledCount={form.verificationToken.trim() ? 1 : 0} className="md:col-span-2">
              <div className="space-y-4 pt-2">
                <Field label="Verification token"><input className="input" value={form.verificationToken} onChange={(e) => set('verificationToken', e.target.value)} /></Field>
                <Field label="Internal Notes"><textarea className="input min-h-[80px]" /></Field>
              </div>
            </FormSection>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <ToggleRow label="Enable Address" checked={addressEnabled} onChange={setAddressEnabled} />
            {addressEnabled && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Billing Frequency *">
                <select className="input" value={form.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value)}>
                  <option value="">Select…</option>
                  {BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Day *"><select className="input" defaultValue="Monday">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => <option key={d}>{d}</option>)}</select></Field>
            </div>
            <Field label="Tax ID / VAT or SSN"><input className="input" /></Field>
            <Field label="Billing Terms"><textarea className="input min-h-[80px]" value={form.billingTerms} onChange={(e) => set('billingTerms', e.target.value)} placeholder="Net-30, prepay…" /></Field>
            <ToggleRow label="Automatic Invoice Creation" checked={autoInvoice} onChange={setAutoInvoice} />
            {autoInvoice && (
              <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 md:grid-cols-2">
                <Field label="Auto Invoice Start Date"><input type="date" className="input" /></Field>
                <Field label="Invoice Generation Delay *"><select className="input" defaultValue="No Delay">{['No Delay', '5 Days', '10 Days'].map((d) => <option key={d}>{d}</option>)}</select></Field>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <FormSection id="advertiser-platform" title="Platform">
              <div className="space-y-4">
                <Field label="Platform Name"><input className="input" /></Field>
                <Field label="Platform URL"><input className="input" /></Field>
                <Field label="Timezone *"><select className="input"><option>(GMT+00:00) UTC</option></select></Field>
              </div>
            </FormSection>
            <FormSection id="advertiser-direct-linking" title="Direct Linking" className="border-t border-border pt-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Offer ID Parameter"><input className="input" defaultValue="oid" /></Field>
                <Field label="Partner ID Parameter"><input className="input" defaultValue="affid" /></Field>
              </div>
            </FormSection>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-small text-fg-secondary">Create a login for this advertiser to access their portal.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="First Name"><input className="input" /></Field>
              <Field label="Last Name"><input className="input" /></Field>
            </div>
            <Field label="Email"><input type="email" className="input" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
          </div>
        )}
        </div>
      </FormLayout>

      <FormFooter
        stepText={`Step ${step + 1} of ${STEPS.length}`}
        cancel={<button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav('/app/advertisers') : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</button>}
        primary={{
          label: busy ? 'Creating…' : isLast ? 'Create Advertiser' : `Next: ${STEPS[step + 1]}`,
          shortLabel: busy || isLast ? undefined : 'Next',
          disabled: busy,
        }} />
      </form>
    </>
  );
}
