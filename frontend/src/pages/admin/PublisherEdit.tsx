/**
 * Edit Partner (Everflow-style multi-tab edit form). General maps to real Publisher columns.
 * Partner Manager / Account Executive / Referred By / Partner Tier / Labels (General) and Billing
 * Frequency / Payment Method (Billing) are real too — wired to the same columns Manage Partners'
 * columns/filters read (see publisher-manage-parity migration). Everything else on Address/Billing
 * (bank details, invoice automation, …) has no backing field on Publisher at all, so those stay
 * real, full-color, interactive controls that simply aren't wired to persist.
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
import type { Publisher, DashboardUser } from '../../types';

const TABS = ['General', 'Address', 'Billing'] as const;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', tone: 'success' }, { value: 'pending', label: 'Pending', tone: 'warning' }, { value: 'inactive', label: 'Inactive', tone: 'danger' },
] as const;


interface FormState {
  name: string; status: string; contactEmail: string; trafficSource: string; payoutTerms: string; defaultAttributionWindowS: string;
  country: string; paymentMethod: string; billingFrequency: string; tier: string; partnerManagerId: string; accountExecutiveId: string; referredById: string;
  /** Control Center channel id ('' = none). */
  channelId: string;
  contactName: string; taxId: string; website: string; notes: string;
}

// ── General (real fields backed by publisher-manage-parity columns, plus a few genuinely
// unbacked toggles kept interactive-but-not-persisted) ──────────────────────
function GeneralExtras({
  base, publisherId, form, set, users, publishers, currentChannelName,
}: {
  base: string; publisherId: string; form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  users: DashboardUser[]; publishers: Publisher[]; currentChannelName?: string | null;
}) {
  const { data: channels } = useQuery<Array<{ id: string; name: string }>>('/api/control-center/channels?status=active');
  const channelList = channels ?? [];
  // Keep a currently-assigned channel selectable even if it has since been deactivated.
  const missingCurrent = Boolean(form.channelId) && !channelList.some((c) => c.id === form.channelId);
  const [notify, setNotify] = useState(true);
  const [dynamicPayouts, setDynamicPayouts] = useState(false);
  const [macroVisibility, setMacroVisibility] = useState('None');
  return (
    <div className="grid grid-cols-1 gap-5 border-t border-border pt-6 md:grid-cols-2 md:items-start">
      <Field label="Partner Manager">
        <select className="input" value={form.partnerManagerId} onChange={(e) => set('partnerManagerId', e.target.value)}>
          <option value="">—</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <Field label="Channel">
        <select className="input" value={form.channelId} onChange={(e) => set('channelId', e.target.value)}>
          <option value="">None</option>
          {missingCurrent && <option value={form.channelId}>{currentChannelName ?? 'Current channel'} (inactive)</option>}
          {channelList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Account Executive">
        <select className="input" value={form.accountExecutiveId} onChange={(e) => set('accountExecutiveId', e.target.value)}>
          <option value="">—</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <Field label="Referred By">
        <select className="input" value={form.referredById} onChange={(e) => set('referredById', e.target.value)}>
          <option value="">—</option>
          {publishers.filter((p) => p.id !== publisherId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Partner Tier"><input className="input" value={form.tier} onChange={(e) => set('tier', e.target.value)} placeholder="e.g. Gold, Silver, Bronze" /></Field>
      <div className="md:col-span-2"><LabelsEditor base={base} /></div>
      <label className="flex items-center gap-3 text-small text-fg">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded border-border" />
        Allow partner to receive notifications
      </label>
      <label className="flex items-center gap-3 text-small text-fg">
        <input type="checkbox" checked={dynamicPayouts} onChange={(e) => setDynamicPayouts(e.target.checked)} className="h-4 w-4 rounded border-border" />
        Enable CPC/CPM Dynamic Payouts for Partner
      </label>
      {/* Optional fields — open on load when one already has a value. */}
      <FormSection id="partner-edit-optional" title="Optional details" collapsible className="md:col-span-2"
        summary="Internal Notes · Set Macro Parameter Visibility" defaultOpen={Boolean(form.notes.trim())} filledCount={form.notes.trim() ? 1 : 0}>
        <div className="space-y-4 pt-2">
          <Field label="Internal Notes"><textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <div>
            <label className="label">Set Macro Parameter Visibility</label>
            <Segmented options={['None', 'Custom', 'Full access']} value={macroVisibility} onChange={setMacroVisibility} />
          </div>
        </div>
      </FormSection>
    </div>
  );
}

// ── Address (Country is real; the rest has no backing field on Publisher) ──
function AddressTab({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="space-y-4">
      <Field label="Country"><input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="United States" /></Field>
      <ToggleRow label="Enable Address" checked={enabled} onChange={setEnabled} />
      {enabled && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Address Line 1"><input className="input" /></Field>
          <Field label="Address Line 2"><input className="input" /></Field>
          <Field label="City"><input className="input" /></Field>
          <Field label="State / Region"><input className="input" /></Field>
          <Field label="ZIP / Postal Code"><input className="input" /></Field>
        </div>
      )}
    </div>
  );
}

// ── Billing (Frequency + Payment Method are real; the rest has no backing field) ──
function BillingTab({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const [autoInvoice, setAutoInvoice] = useState(true);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Billing Frequency">
          <select className="input" value={form.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value)}>
            <option value="">—</option>
            {['Weekly', 'Bi-Weekly', 'Monthly', 'Net 15', 'Net 30'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Day *"><select className="input" defaultValue="Monday">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => <option key={d}>{d}</option>)}</select></Field>
      </div>
      <Field label="Payment Method">
        <select className="input md:!w-auto" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
          <option value="">—</option>
          {['Wire', 'Paypal', 'Webmoney', 'Direct Deposit', 'None'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      {form.paymentMethod && form.paymentMethod !== 'None' && (
        <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 md:grid-cols-2">
          <Field label="Bank Name *"><input className="input" /></Field>
          <Field label="Bank Address *"><input className="input" /></Field>
          <Field label="Account Name *"><input className="input" /></Field>
          <Field label="Account Number *"><input className="input" /></Field>
          <Field label="Routing Number / IBAN / Sort Code *"><input className="input" /></Field>
          <Field label="Swift Code"><input className="input" /></Field>
        </div>
      )}
      <Field label="Tax ID / VAT or SSN"><input className="input" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
      <Field label="VAT Percentage"><input className="input" /></Field>
      <ToggleRow label="Automatic Invoice Creation" checked={autoInvoice} onChange={setAutoInvoice} />
      {autoInvoice && (
        <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 md:grid-cols-2">
          <Field label="Auto Invoice Start Date"><input type="date" className="input" defaultValue="2019-01-01" /></Field>
          <Field label="Invoice Generation Delay *"><select className="input" defaultValue="No Delay">{['No Delay', '5 Days', '10 Days', '15 Days'].map((d) => <option key={d}>{d}</option>)}</select></Field>
        </div>
      )}
    </div>
  );
}

export default function PublisherEdit() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const base = `/api/publishers/${id}`;
  const { data: publisher, loading, error } = useQuery<Publisher>(base);
  const { data: users } = useQuery<DashboardUser[]>('/api/users');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [tab, setTab] = useState<string>('General');
  const [form, setForm] = useState<FormState | null>(null);
  const { run, busy, error: saveError } = useMutation((body: Record<string, unknown>) => api.patch(base, body));

  useEffect(() => {
    if (!publisher) return;
    setForm({
      name: publisher.name, status: publisher.status, contactEmail: publisher.contactEmail ?? '',
      trafficSource: publisher.trafficSource ?? '', payoutTerms: publisher.payoutTerms ?? '',
      defaultAttributionWindowS: publisher.defaultAttributionWindowS != null ? String(publisher.defaultAttributionWindowS) : '',
      country: publisher.country ?? '', paymentMethod: publisher.paymentMethod ?? '', billingFrequency: publisher.billingFrequency ?? '',
      tier: publisher.tier ?? '', partnerManagerId: publisher.partnerManagerId ?? '', accountExecutiveId: publisher.accountExecutiveId ?? '',
      referredById: publisher.referredById ?? '', channelId: publisher.channelId ?? '',
      contactName: publisher.contactName ?? '', taxId: publisher.taxId ?? '', website: publisher.website ?? '', notes: publisher.notes ?? '',
    });
  }, [publisher]);

  if (error) return <StateBlock>{error}</StateBlock>;
  if (loading || !form) return <StateBlock><Spinner /></StateBlock>;
  if (!publisher) return <StateBlock>Partner not found</StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, contactEmail: form.contactEmail.trim() || null, payoutTerms: form.payoutTerms.trim() || null,
      country: form.country || null, paymentMethod: form.paymentMethod || null, billingFrequency: form.billingFrequency || null,
      tier: form.tier || null, partnerManagerId: form.partnerManagerId || null, accountExecutiveId: form.accountExecutiveId || null,
      referredById: form.referredById || null, channelId: form.channelId || null,
      contactName: form.contactName || null, taxId: form.taxId || null, website: form.website || null, notes: form.notes || null,
    };
    body.trafficSource = form.trafficSource || null; // empty clears it
    if (form.defaultAttributionWindowS) body.defaultAttributionWindowS = Number(form.defaultAttributionWindowS);
    if (await run(body)) nav(`/app/publishers/${id}`);
  };

  return (
    <>
      <PageHeader title={`Edit Partner: ${publisher.name}`} subtitle={`Partners › ${publisher.name} › Edit`} />
      <div className="mx-auto max-w-[880px]"><Tabs tabs={[...TABS]} active={tab} onChange={setTab} /></div>
      <form onSubmit={submit}>
      {/* One hinted field only — centred card on every tab; the hint stays as the field's (?) tooltip. */}
      <FormLayout title={tab} requiredNote="Fields with an asterisk (*) are mandatory." layout="centered">
        <div className="space-y-6">
        {saveError && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{saveError}</p>}

        {tab === 'General' && (
          <div className="space-y-6">
            <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div>
              <span id="partner-edit-status-label" className="label">Status *</span>
              <StatusChoice options={STATUS_OPTIONS} value={form.status as (typeof STATUS_OPTIONS)[number]['value']} onChange={(v) => set('status', v)} ariaLabelledby="partner-edit-status-label" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Contact Email"><input type="email" className="input" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
              <Field label="User Name"><input className="input" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="The contact person's name" /></Field>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Traffic Source"><input className="input" value={form.trafficSource} onChange={(e) => set('trafficSource', e.target.value)} placeholder="Social, Display, SEO…" /></Field>
              <Field label="Website"><input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></Field>
            </div>
            <Field label="Default Attribution Window (seconds)" hint="Saved for reference — the attribution window that applies is the offer's own."><input type="number" min={0} className="input" value={form.defaultAttributionWindowS} onChange={(e) => set('defaultAttributionWindowS', e.target.value)} placeholder="2592000" /></Field>
            <Field label="Payout Terms"><textarea className="input min-h-[80px]" value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} /></Field>
            <GeneralExtras base={base} publisherId={id} form={form} set={set} users={users ?? []} publishers={publishers ?? []} currentChannelName={publisher.channelName} />
          </div>
        )}

        {tab === 'Address' && <AddressTab form={form} set={set} />}
        {tab === 'Billing' && <BillingTab form={form} set={set} />}
        </div>
      </FormLayout>
      <FormFooter cancel={<Link to={`/app/publishers/${id}`} className="btn-ghost">Cancel</Link>}
        primary={{ label: busy ? 'Saving…' : 'Save', disabled: busy }} />
      </form>
    </>
  );
}
