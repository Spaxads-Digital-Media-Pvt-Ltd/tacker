/**
 * Edit Advertiser (Everflow-style multi-tab edit form). General maps to real Advertiser columns the
 * backend's PATCH /api/advertisers/:id accepts — advertiserDetail/GeneralTab.tsx previously only
 * showed these fields read-only. Account Manager / Sales Manager / Labels / Verification token
 * (General) and Billing Frequency (Billing) are real too — wired to the same columns Manage
 * Advertisers' columns/filters read (see advertiser-manage-parity migration). Address and the rest
 * of Additional Information have no backing fields on Advertiser at all, so those stay real,
 * full-color, interactive controls that just aren't wired to persist.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Tabs, Spinner, StateBlock, Segmented } from '../../shared-components/primitives/ui';
import { LabelsEditor } from '../../shared-components/panels/LabelsEditor';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormSection } from '../../shared-components/forms/FormSection';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import { StatusChoice } from '../../shared-components/forms/ChoiceCards';
import type { Advertiser, DashboardUser } from '../../types';

const TABS = ['General', 'Address', 'Billing', 'Additional Information'] as const;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', tone: 'success' }, { value: 'pending', label: 'Pending', tone: 'warning' }, { value: 'inactive', label: 'Inactive', tone: 'danger' },
] as const;
const BILLING_FREQUENCIES = ['Weekly', 'Bimonthly', 'Monthly'];

interface FormState {
  name: string; status: string; contactEmail: string; defaultCurrency: string; billingTerms: string;
  accountManagerId: string; salesManagerId: string; billingFrequency: string; verificationToken: string;
}

// ── General (extra fields beyond Name/Status/Contact/Currency/Billing Terms) ────
function GeneralExtras({
  form, set, users, base,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void; users: DashboardUser[]; base: string }) {
  const [variables, setVariables] = useState(false);
  const [attribution, setAttribution] = useState('Last Touch');
  const [priority, setPriority] = useState('Click');
  const [emailAttribution, setEmailAttribution] = useState('Last Partner Attribution');
  return (
    <div className="grid grid-cols-1 gap-5 border-t border-border pt-6 md:grid-cols-2 md:items-start">
      <Field label="Account Manager">
        <select className="input" value={form.accountManagerId} onChange={(e) => set('accountManagerId', e.target.value)}>
          <option value="">None</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <Field label="Sales Manager">
        <select className="input" value={form.salesManagerId} onChange={(e) => set('salesManagerId', e.target.value)}>
          <option value="">None</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <div className="md:col-span-2"><LabelsEditor base={base} /></div>
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
      <div className="md:col-span-2"><ToggleRow label="Enable Variables exposed in the Advertiser UI" checked={variables} onChange={setVariables} /></div>
      {/* Optional fields — open on load when one already has a value. */}
      <FormSection id="advertiser-edit-optional" title="Optional details" collapsible className="md:col-span-2"
        summary="Verification token · Internal Notes" defaultOpen={Boolean(form.verificationToken.trim())} filledCount={form.verificationToken.trim() ? 1 : 0}>
        <div className="space-y-4 pt-2">
          <Field label="Verification token"><input className="input" value={form.verificationToken} onChange={(e) => set('verificationToken', e.target.value)} /></Field>
          <Field label="Internal Notes"><textarea className="input min-h-[80px]" /></Field>
        </div>
      </FormSection>
    </div>
  );
}

// ── Address ──────────────────────────────────────────────────────────────
function AddressTab() {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="space-y-4">
      <ToggleRow label="Enable Address" checked={enabled} onChange={setEnabled} />
      {enabled && (
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
  );
}

// ── Billing ──────────────────────────────────────────────────────────────
function BillingTab({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const [autoInvoice, setAutoInvoice] = useState(true);
  const [paymentTerms, setPaymentTerms] = useState(true);
  return (
    <div className="space-y-5">
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
      <ToggleRow label="Automatic Invoice Creation" checked={autoInvoice} onChange={setAutoInvoice} />
      {autoInvoice && (
        <div className="space-y-4 rounded-card border border-border bg-page p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Auto Invoice Start Date"><input type="date" className="input" defaultValue="2019-06-01" /></Field>
            <Field label="Invoice Generation Delay *"><select className="input" defaultValue="No Delay">{['No Delay', '5 Days', '10 Days', '15 Days'].map((d) => <option key={d}>{d}</option>)}</select></Field>
          </div>
          <Field label="Auto Invoice Creation Amount Threshold"><input type="number" className="input" defaultValue={0} /></Field>
        </div>
      )}

      <FormSection id="advertiser-edit-invoice-defaults" title="Default Invoice Settings" className="border-t border-border pt-6">
      <div className="space-y-4">
      <div className="space-y-2">
        <ToggleRow label="Enable Payment Terms" checked={paymentTerms} onChange={setPaymentTerms} />
        {paymentTerms && <select className="input md:!w-auto" aria-label="Payment terms" defaultValue="Net 30">{['Net 15', 'Net 30', 'Net 60'].map((t) => <option key={t}>{t}</option>)}</select>}
      </div>
      <label className="flex items-center gap-3 text-small text-fg">
        <input type="checkbox" className="h-4 w-4 rounded border-border" />
        Hide Invoices from Advertisers
      </label>
      </div>
      </FormSection>
    </div>
  );
}

// ── Additional Information ──────────────────────────────────────────────
function AdditionalInfoTab() {
  return (
    <div className="space-y-6">
      <FormSection id="advertiser-edit-platform" title="Platform">
      <div className="space-y-5">
      <Field label="Platform Name"><input className="input" /></Field>
      <Field label="Platform URL"><input className="input" /></Field>
      <Field label="Platform Username"><input className="input" /></Field>
      <Field label="Timezone *"><select className="input"><option>(GMT+00:00) UTC</option></select></Field>
      <Field label="Accounting Contact Email Address"><input type="email" className="input" /></Field>
      </div>
      </FormSection>
      <FormSection id="advertiser-edit-direct-linking" title="Direct Linking" className="border-t border-border pt-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Offer ID Parameter"><input className="input" defaultValue="oid" /></Field>
        <Field label="Partner ID Parameter"><input className="input" defaultValue="affid" /></Field>
      </div>
      </FormSection>
    </div>
  );
}

export default function AdvertiserEdit() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const base = `/api/advertisers/${id}`;
  const { data: advertiser, loading, error } = useQuery<Advertiser>(base);
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const [tab, setTab] = useState<string>('General');
  const [form, setForm] = useState<FormState | null>(null);
  const { run, busy, error: saveError } = useMutation((body: Record<string, unknown>) => api.patch(base, body));

  useEffect(() => {
    if (!advertiser) return;
    setForm({
      name: advertiser.name, status: advertiser.status, contactEmail: advertiser.contactEmail ?? '',
      defaultCurrency: advertiser.defaultCurrency, billingTerms: advertiser.billingTerms ?? '',
      accountManagerId: advertiser.accountManagerId ?? '', salesManagerId: advertiser.salesManagerId ?? '',
      billingFrequency: advertiser.billingFrequency ?? '', verificationToken: advertiser.verificationToken ?? '',
    });
  }, [advertiser]);

  // Error first: a failed load never sets `form`, so checking the spinner first would spin forever.
  if (error) return <StateBlock>{error}</StateBlock>;
  if (loading || !form) return <StateBlock><Spinner /></StateBlock>;
  if (!advertiser) return <StateBlock>Advertiser not found</StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, contactEmail: form.contactEmail.trim() || null,
      defaultCurrency: form.defaultCurrency, billingTerms: form.billingTerms.trim() || null,
      accountManagerId: form.accountManagerId || null, salesManagerId: form.salesManagerId || null,
      billingFrequency: form.billingFrequency || null, verificationToken: form.verificationToken || null,
    };
    if (await run(body)) nav(`/app/advertisers/${id}`);
  };

  return (
    <>
      <PageHeader title={`Edit Advertiser: ${advertiser.name}`} subtitle={`Advertisers › ${advertiser.name} › Edit`} />
      <div className="mx-auto max-w-[880px]"><Tabs tabs={[...TABS]} active={tab} onChange={setTab} /></div>
      <form onSubmit={submit}>
      <FormLayout title={tab} requiredNote="Fields with an asterisk (*) are mandatory." layout="centered">
        <div className="space-y-6">
        {saveError && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{saveError}</p>}

        {tab === 'General' && (
          <div className="space-y-6">
            <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div>
              <span id="advertiser-edit-status-label" className="label">Status *</span>
              <StatusChoice options={STATUS_OPTIONS} value={form.status as (typeof STATUS_OPTIONS)[number]['value']} onChange={(v) => set('status', v)} ariaLabelledby="advertiser-edit-status-label" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Contact Email"><input type="email" className="input" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
              <Field label="Default Currency *"><input className="input" maxLength={3} required value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())} /></Field>
            </div>
            <Field label="Billing Terms"><textarea className="input min-h-[80px]" value={form.billingTerms} onChange={(e) => set('billingTerms', e.target.value)} /></Field>
            <GeneralExtras form={form} set={set} users={users ?? []} base={base} />
          </div>
        )}

        {tab === 'Address' && <AddressTab />}
        {tab === 'Billing' && <BillingTab form={form} set={set} />}
        {tab === 'Additional Information' && <AdditionalInfoTab />}
        </div>
      </FormLayout>
      <FormFooter cancel={<Link to={`/app/advertisers/${id}`} className="btn-ghost">Cancel</Link>}
        primary={{ label: busy ? 'Saving…' : 'Save', disabled: busy }} />
      </form>
    </>
  );
}
