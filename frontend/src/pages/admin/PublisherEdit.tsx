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
import { PageHeader, Field, Tabs, Spinner, StateBlock, Segmented } from '../../components/ui';
import type { Publisher, DashboardUser } from '../../types';

const TABS = ['General', 'Address', 'Billing'] as const;
const STATUSES = ['active', 'pending', 'inactive'] as const;
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', inactive: 'bg-danger' };

interface FormState {
  name: string; status: string; contactEmail: string; trafficSource: string; payoutTerms: string; defaultAttributionWindowS: string;
  country: string; paymentMethod: string; billingFrequency: string; tier: string; partnerManagerId: string; accountExecutiveId: string; referredById: string;
  contactName: string; taxId: string; website: string; notes: string;
}

interface Tag { id: string; name: string; color: string | null; createdAt: string }

/** Real tags editor — chips + add-by-name, using the same /:id/tags assign/unassign endpoints
 * already wired for offers. */
function LabelsEditor({ base }: { base: string }) {
  const { data: tags, refetch } = useQuery<Tag[]>(`${base}/tags`);
  const [name, setName] = useState('');
  const add = useMutation((n: string) => api.post(`${base}/tags`, { name: n }));
  const remove = useMutation((tagId: string) => api.del(`${base}/tags/${tagId}`));

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setName('');
    await add.run(n);
    refetch();
  };

  return (
    <Field label="Labels">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-surface p-2">
        {(tags ?? []).map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-1 text-tiny font-medium text-accent-text">
            {t.name}
            <button type="button" onClick={async () => { await remove.run(t.id); refetch(); }} className="text-accent-text/70 hover:text-accent-text">×</button>
          </span>
        ))}
        <input
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-small text-fg outline-none"
          placeholder="Add label…" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
      </div>
    </Field>
  );
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

// ── General (real fields backed by publisher-manage-parity columns, plus a few genuinely
// unbacked toggles kept interactive-but-not-persisted) ──────────────────────
function GeneralExtras({
  base, publisherId, form, set, users, publishers,
}: {
  base: string; publisherId: string; form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  users: DashboardUser[]; publishers: Publisher[];
}) {
  const [notify, setNotify] = useState(true);
  const [dynamicPayouts, setDynamicPayouts] = useState(false);
  const [macroVisibility, setMacroVisibility] = useState('None');
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <Field label="Partner Manager">
        <select className="input" value={form.partnerManagerId} onChange={(e) => set('partnerManagerId', e.target.value)}>
          <option value="">—</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
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
      <LabelsEditor base={base} />
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
      <Field label="Internal Notes"><textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <div>
        <label className="label mb-2 block">Set Macro Parameter Visibility</label>
        <Segmented options={['None', 'Custom', 'Full access']} value={macroVisibility} onChange={setMacroVisibility} />
      </div>
    </div>
  );
}

// ── Address (Country is real; the rest has no backing field on Publisher) ──
function AddressTab({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="space-y-4">
      <Field label="Country"><input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="United States" /></Field>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Billing Frequency">
          <select className="input" value={form.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value)}>
            <option value="">—</option>
            {['Weekly', 'Bi-Weekly', 'Monthly', 'Net 15', 'Net 30'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Day *"><select className="input" defaultValue="Monday">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => <option key={d}>{d}</option>)}</select></Field>
      </div>
      <Field label="Payment Method">
        <select className="input !w-auto" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
          <option value="">—</option>
          {['Wire', 'Paypal', 'Webmoney', 'Direct Deposit', 'None'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      {form.paymentMethod && form.paymentMethod !== 'None' && (
        <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
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
      <div>
        <label className="label mb-2 block">Automatic Invoice Creation</label>
        <YesNoToggle on={autoInvoice} onChange={setAutoInvoice} />
      </div>
      {autoInvoice && (
        <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
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
      referredById: publisher.referredById ?? '',
      contactName: publisher.contactName ?? '', taxId: publisher.taxId ?? '', website: publisher.website ?? '', notes: publisher.notes ?? '',
    });
  }, [publisher]);

  if (loading || !form) return <StateBlock><Spinner /></StateBlock>;
  if (error || !publisher) return <StateBlock>{error ?? 'Partner not found'}</StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, contactEmail: form.contactEmail, payoutTerms: form.payoutTerms,
      country: form.country || null, paymentMethod: form.paymentMethod || null, billingFrequency: form.billingFrequency || null,
      tier: form.tier || null, partnerManagerId: form.partnerManagerId || null, accountExecutiveId: form.accountExecutiveId || null,
      referredById: form.referredById || null,
      contactName: form.contactName || null, taxId: form.taxId || null, website: form.website || null, notes: form.notes || null,
    };
    if (form.trafficSource) body.trafficSource = form.trafficSource;
    if (form.defaultAttributionWindowS) body.defaultAttributionWindowS = Number(form.defaultAttributionWindowS);
    if (await run(body)) nav(`/app/publishers/${id}`);
  };

  return (
    <>
      <PageHeader title={`Edit Partner: ${publisher.name}`} subtitle={`Partners › ${publisher.name} › Edit`} />
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
              <Field label="User Name"><input className="input" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="The contact person's name" /></Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Traffic Source"><input className="input" value={form.trafficSource} onChange={(e) => set('trafficSource', e.target.value)} placeholder="Social, Display, SEO…" /></Field>
              <Field label="Website"><input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></Field>
            </div>
            <Field label="Default Attribution Window (seconds)"><input type="number" min={0} className="input" value={form.defaultAttributionWindowS} onChange={(e) => set('defaultAttributionWindowS', e.target.value)} placeholder="2592000" /></Field>
            <Field label="Payout Terms *"><textarea className="input min-h-[80px]" required value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} /></Field>
            <GeneralExtras base={base} publisherId={id} form={form} set={set} users={users ?? []} publishers={publishers ?? []} />
          </div>
        )}

        {tab === 'Address' && <AddressTab form={form} set={set} />}
        {tab === 'Billing' && <BillingTab form={form} set={set} />}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Link to={`/app/publishers/${id}`} className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
