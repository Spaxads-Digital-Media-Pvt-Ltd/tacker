/**
 * Super Admin › Settings, in tabs (?tab=…). Billing — how the platform bills its tenants: invoice numbering,
 * when an invoice is due, how long after that an unpaid one suspends its network (and whether it does), the
 * tax rate, who bills (printed on invoices) and how to pay (no payment gateway yet — shown on invoices and the
 * tenant's Billing page; the Super Admin then marks the invoice paid). Support — first-reply targets,
 * auto-assignment and auto-close (support/SupportSettings.tsx). Email — the platform's SMTP, notifications
 * and its email log (platform/EmailSettings.tsx).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock, Tabs } from '../../shared-components/primitives/ui';
import { usePlatformMe } from '../../lib/platformMe';
import type { BillingSettings } from '../../lib/platformBilling';
import { SupportSettings } from './support/SupportSettings';
import { EmailSettings } from './platform/EmailSettings';
import { SecuritySettings } from './platform/SecuritySettings';

const TABS = ['Billing', 'Support', 'Email', 'Security'];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab') ?? '') ? params.get('tab')! : 'Billing';
  return (
    <>
      <PageHeader title="Settings" subtitle="How the platform bills its networks, runs its help desk and sends email." />
      <div className="mx-auto max-w-3xl"><Tabs tabs={TABS} active={tab} onChange={(t) => setParams(t === 'Billing' ? {} : { tab: t }, { replace: true })} /></div>
      {tab === 'Billing' ? <BillingSettingsForm /> : tab === 'Support' ? <SupportSettings /> : tab === 'Email' ? <EmailSettings /> : <SecuritySettings />}
    </>
  );
}

function BillingSettingsForm() {
  const current = useQuery<BillingSettings>('/platform/settings/billing');
  const [f, setF] = useState<BillingSettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (current.data) setF(current.data); }, [current.data]);
  const m = useMutation((b: BillingSettings) => api.put<BillingSettings>('/platform/settings/billing', b));
  const canEdit = usePlatformMe().can('settings', 'full');

  if (current.loading || (!f && !current.error)) return <StateBlock><Spinner /></StateBlock>;
  if (current.error || !f) return <StateBlock>{current.error ?? 'Could not load the settings'}</StateBlock>;
  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => { setSaved(false); setF((s) => (s ? { ...s, [k]: v } : s)); };
  const setSeller = (k: keyof BillingSettings['seller'], v: string) => { setSaved(false); setF((s) => (s ? { ...s, seller: { ...s.seller, [k]: v } } : s)); };
  const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.run({ ...f, invoicePrefix: f.invoicePrefix.trim().toUpperCase() });
    if (r) { setF(r); setSaved(true); }
  };

  return (
    <>
      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4">
        <fieldset disabled={!canEdit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        {saved && <p className="text-small text-success-text">Saved — applies to invoices issued from now on (and suspensions from the next billing run).</p>}

        <div className="card space-y-4">
          <h3 className="text-h3 font-medium text-fg">Invoices</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Number prefix" hint={`e.g. ${f.invoicePrefix || 'INV'}-${new Date().getFullYear()}-00042`}>
              <input className="input uppercase" required maxLength={12} value={f.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} />
            </Field>
            <Field label="Due after (days)" hint="From the issue date">
              <input className="input" inputMode="numeric" required value={Number.isNaN(f.dueDays) ? '' : String(f.dueDays)} onChange={(e) => set('dueDays', num(e.target.value))} />
            </Field>
            <Field label="Tax rate (%)" hint="Added to every invoice; 0 = none">
              <input className="input" inputMode="decimal" required value={f.taxRate} onChange={(e) => set('taxRate', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="card space-y-4">
          <h3 className="text-h3 font-medium text-fg">Unpaid invoices</h3>
          <p className="text-small text-fg-secondary">
            At its due date an unpaid invoice flags the network’s subscription <strong>past due</strong> (shown to you and to the network’s staff).
          </p>
          <label className="flex items-start gap-3 text-small text-fg">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={f.autoSuspend} onChange={(e) => set('autoSuspend', e.target.checked)} />
            <span>Suspend the network automatically when an invoice is still unpaid after the grace period — tracking, its dashboard and API stop until it’s paid or you give more time.</span>
          </label>
          <Field label="Grace period (days after the due date)">
            <input className="input max-w-[10rem]" inputMode="numeric" required disabled={!f.autoSuspend}
              value={Number.isNaN(f.graceDays) ? '' : String(f.graceDays)} onChange={(e) => set('graceDays', num(e.target.value))} />
          </Field>
        </div>

        <div className="card space-y-4">
          <h3 className="text-h3 font-medium text-fg">Billed by <span className="text-small font-normal text-fg-secondary">— printed on every invoice</span></h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Company name"><input className="input" maxLength={200} value={f.seller.name} onChange={(e) => setSeller('name', e.target.value)} /></Field>
            <Field label="Billing email"><input className="input" type="email" maxLength={200} value={f.seller.email} onChange={(e) => setSeller('email', e.target.value)} /></Field>
            <Field label="Tax ID" hint="e.g. GSTIN / VAT number"><input className="input" maxLength={100} value={f.seller.taxId} onChange={(e) => setSeller('taxId', e.target.value)} /></Field>
          </div>
          <Field label="Address"><textarea className="input min-h-[70px]" maxLength={1000} value={f.seller.address} onChange={(e) => setSeller('address', e.target.value)} /></Field>
        </div>

        <div className="card space-y-3">
          <h3 className="text-h3 font-medium text-fg">How to pay</h3>
          <p className="text-small text-fg-secondary">Shown on open invoices and on each network’s Billing page — bank account, UPI id, etc. When a payment arrives, mark the invoice paid in Billing.</p>
          <textarea className="input min-h-[100px]" maxLength={2000} value={f.paymentInstructions} onChange={(e) => set('paymentInstructions', e.target.value)}
            placeholder={'Bank transfer to …\nAccount: …  IFSC / SWIFT: …\nPlease quote the invoice number.'} />
        </div>

        {canEdit && <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Save settings'}</button></div>}
        </fieldset>
      </form>
    </>
  );
}
