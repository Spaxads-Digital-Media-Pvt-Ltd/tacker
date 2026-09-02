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
import { PageHeader, Field, Tabs, Spinner, StateBlock, Segmented } from '../../components/ui';
import { LabelsEditor } from '../../components/LabelsEditor';
import type { Advertiser, DashboardUser } from '../../types';

const TABS = ['General', 'Address', 'Billing', 'Additional Information'] as const;
const STATUSES = ['active', 'pending', 'inactive'] as const;
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', inactive: 'bg-danger' };
const BILLING_FREQUENCIES = ['Weekly', 'Bimonthly', 'Monthly'];

interface FormState {
  name: string; status: string; contactEmail: string; defaultCurrency: string; billingTerms: string;
  accountManagerId: string; salesManagerId: string; billingFrequency: string; verificationToken: string;
}

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

// ── General (extra fields beyond Name/Status/Contact/Currency/Billing Terms) ────
function GeneralExtras({
  form, set, users, base,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void; users: DashboardUser[]; base: string }) {
  const [variables, setVariables] = useState(false);
  const [attribution, setAttribution] = useState('Last Touch');
  const [priority, setPriority] = useState('Click');
  const [emailAttribution, setEmailAttribution] = useState('Last Partner Attribution');
  return (
    <div className="space-y-4 border-t border-border pt-4">
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
      <LabelsEditor base={base} />
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
  );
}

// ── Address ──────────────────────────────────────────────────────────────
function AddressTab() {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <label className="label mb-2 block">Enable Address</label>
        <YesNoToggle on={enabled} onChange={setEnabled} />
      </div>
      {enabled && (
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
  );
}

// ── Billing ──────────────────────────────────────────────────────────────
function BillingTab({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const [autoInvoice, setAutoInvoice] = useState(true);
  const [paymentTerms, setPaymentTerms] = useState(true);
  return (
    <div className="space-y-5">
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
      <div>
        <label className="label mb-2 flex items-center gap-1 block">Automatic Invoice Creation</label>
        <YesNoToggle on={autoInvoice} onChange={setAutoInvoice} />
      </div>
      {autoInvoice && (
        <div className="space-y-4 rounded-card border border-border bg-page p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Auto Invoice Start Date"><input type="date" className="input" defaultValue="2019-06-01" /></Field>
            <Field label="Invoice Generation Delay *"><select className="input" defaultValue="No Delay">{['No Delay', '5 Days', '10 Days', '15 Days'].map((d) => <option key={d}>{d}</option>)}</select></Field>
          </div>
          <Field label="Auto Invoice Creation Amount Threshold"><input type="number" className="input" defaultValue={0} /></Field>
        </div>
      )}

      <h3 className="text-h3 font-medium text-fg">Default Invoice Settings</h3>
      <div>
        <label className="label mb-2 block">Enable Payment Terms</label>
        <div className="flex items-center gap-2">
          <YesNoToggle on={paymentTerms} onChange={setPaymentTerms} />
          {paymentTerms && <select className="input !w-auto" defaultValue="Net 30">{['Net 15', 'Net 30', 'Net 60'].map((t) => <option key={t}>{t}</option>)}</select>}
        </div>
      </div>
      <div>
        <label className="label mb-2 block">Hide Invoices from Advertisers</label>
        <input type="checkbox" className="h-4 w-4 rounded border-border" />
      </div>
    </div>
  );
}

// ── Additional Information ──────────────────────────────────────────────
function AdditionalInfoTab() {
  return (
    <div className="space-y-5">
      <h3 className="text-h3 font-medium text-fg">Platform</h3>
      <Field label="Platform Name"><input className="input" /></Field>
      <Field label="Platform URL"><input className="input" /></Field>
      <Field label="Platform Username"><input className="input" /></Field>
      <Field label="Timezone *"><select className="input"><option>(GMT+00:00) UTC</option></select></Field>
      <Field label="Accounting Contact Email Address"><input type="email" className="input" /></Field>
      <h3 className="text-h3 font-medium text-fg">Direct Linking</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Offer ID Parameter"><input className="input" defaultValue="oid" /></Field>
        <Field label="Partner ID Parameter"><input className="input" defaultValue="affid" /></Field>
      </div>
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

  if (loading || !form) return <StateBlock><Spinner /></StateBlock>;
  if (error || !advertiser) return <StateBlock>{error ?? 'Advertiser not found'}</StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, contactEmail: form.contactEmail,
      defaultCurrency: form.defaultCurrency, billingTerms: form.billingTerms,
      accountManagerId: form.accountManagerId || null, salesManagerId: form.salesManagerId || null,
      billingFrequency: form.billingFrequency || null, verificationToken: form.verificationToken || null,
    };
    if (await run(body)) nav(`/app/advertisers/${id}`);
  };

  return (
    <>
      <PageHeader title={`Edit Advertiser: ${advertiser.name}`} subtitle={`Advertisers › ${advertiser.name} › Edit`} />
      <div className="max-w-2xl mx-auto">
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      <form onSubmit={submit} className="card space-y-6">
        {saveError && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{saveError}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        {tab === 'General' && (
          <div className="space-y-4">
            <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div>
              <label className="label mb-2 block">Status *</label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact Email *"><input type="email" className="input" required value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
              <Field label="Default Currency *"><input className="input" maxLength={3} required value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())} /></Field>
            </div>
            <Field label="Billing Terms *"><textarea className="input min-h-[80px]" required value={form.billingTerms} onChange={(e) => set('billingTerms', e.target.value)} /></Field>
            <GeneralExtras form={form} set={set} users={users ?? []} base={base} />
          </div>
        )}

        {tab === 'Address' && <AddressTab />}
        {tab === 'Billing' && <BillingTab form={form} set={set} />}
        {tab === 'Additional Information' && <AdditionalInfoTab />}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Link to={`/app/advertisers/${id}`} className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
