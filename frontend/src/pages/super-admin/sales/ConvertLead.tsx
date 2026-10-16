/**
 * Convert a lead into a customer: a network with its owner login (a temporary password, shown once — they
 * choose their own at first sign-in) and optionally a plan with its trial. The lead is won and linked.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { Modal, Field } from '../../../shared-components/primitives/ui';
import { CopyBox } from '../../../shared-components/panels/CopyBox';
import { useStaff, type Lead } from '../../../lib/platformSales';
import { planPrice, type PlatformPlan } from '../../../lib/platformBilling';
import { StaffSelect } from './parts';

interface ConvertResult {
  network: { id: string; name: string; slug: string };
  owner: { email: string; temporaryPassword: string };
  subscription: { status: string; trial_ends_at: string | null } | null;
  planError: string | null;
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export function ConvertLead({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const { can } = usePlatformMe();
  const staff = useStaff();
  const plans = useQuery<PlatformPlan[]>(can('plans') ? '/platform/plans' : null);
  const [f, setF] = useState({
    name: lead.company, slug: slugify(lead.company), defaultCurrency: lead.currency || 'USD', ownerEmail: lead.email ?? '', ownerName: lead.contact_name ?? '',
    planId: lead.plan_id ?? '', trialDays: '', accountManagerId: '', provisionSubdomain: true,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const m = useMutation((b: Record<string, unknown>) => api.post<ConvertResult>(`/platform/sales/leads/${lead.id}/convert`, b));
  const [done, setDone] = useState<ConvertResult | null>(null);
  const plan = (plans.data ?? []).find((p) => p.id === f.planId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await m.run({
      name: f.name.trim(), slug: f.slug, defaultCurrency: f.defaultCurrency.trim().toUpperCase(), ownerEmail: f.ownerEmail.trim(),
      ownerName: f.ownerName.trim(), planId: f.planId || null, trialDays: f.trialDays === '' ? null : Number(f.trialDays),
      accountManagerId: f.accountManagerId || null, provisionSubdomain: f.provisionSubdomain,
    });
    if (out) { setDone(out); onDone(); }
  };

  if (done) {
    return (
      <Modal open onClose={onClose} title={`${done.network.name} is a customer`}>
        <div className="space-y-4 text-small">
          <p className="text-success-text">The network was created and the lead is won.</p>
          {done.planError && <p className="rounded-[var(--radius)] bg-warning-bg px-3 py-2 text-warning-text">The plan couldn’t be assigned: {done.planError} — assign it on the network’s page.</p>}
          {done.subscription && <p className="text-fg-secondary">Subscription: <strong className="text-fg">{done.subscription.status}</strong>{done.subscription.trial_ends_at ? ` until ${new Date(done.subscription.trial_ends_at).toLocaleDateString()}` : ''}.</p>}
          <div>
            <p className="mb-1 font-medium text-fg">The owner’s sign-in — shown only now</p>
            <p className="mb-2 text-fg-secondary">{done.owner.email} signs in with this temporary password and chooses their own at once. Pass it to them securely.</p>
            <CopyBox value={done.owner.temporaryPassword} />
          </div>
          <div className="flex justify-end gap-2">
            {can('networks') && <Link to={`/admin/networks/${done.network.id}`} className="btn-ghost">Open the network</Link>}
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open size="xl" onClose={onClose} title={`Convert ${lead.company} to a customer`}>
      <form onSubmit={submit} className="space-y-5">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <section className="space-y-3">
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-fg-secondary">The network</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name"><input className="input" required maxLength={200} value={f.name}
              onChange={(e) => setF((s) => ({ ...s, name: e.target.value, slug: slugTouched ? s.slug : slugify(e.target.value) }))} /></Field>
            <Field label="Slug" hint="Its address: <slug>.your-tracking-domain — lowercase letters, digits, hyphens">
              <input className="input font-mono" required maxLength={63} pattern="[a-z0-9-]+" value={f.slug} onChange={(e) => { setSlugTouched(true); setF((s) => ({ ...s, slug: e.target.value })); }} />
            </Field>
            <Field label="Currency"><input className="input uppercase" required maxLength={3} value={f.defaultCurrency} onChange={(e) => setF((s) => ({ ...s, defaultCurrency: e.target.value }))} /></Field>
          </div>
          <label className="flex items-center gap-2 text-small text-fg">
            <input type="checkbox" checked={f.provisionSubdomain} onChange={(e) => setF((s) => ({ ...s, provisionSubdomain: e.target.checked }))} />
            Give it a tracking subdomain now
          </label>
        </section>
        <section className="space-y-3">
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-fg-secondary">Its owner (first admin)</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Email"><input className="input" type="email" required maxLength={200} value={f.ownerEmail} onChange={(e) => setF((s) => ({ ...s, ownerEmail: e.target.value }))} /></Field>
            <Field label="Name" hint="Optional"><input className="input" maxLength={200} value={f.ownerName} onChange={(e) => setF((s) => ({ ...s, ownerName: e.target.value }))} /></Field>
          </div>
        </section>
        <section className="space-y-3">
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-fg-secondary">Plan &amp; account manager</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {plans.data ? (
              <Field label="Plan">
                <select className="input" value={f.planId} onChange={(e) => setF((s) => ({ ...s, planId: e.target.value }))}>
                  <option value="">No plan yet</option>
                  {plans.data.map((p) => <option key={p.id} value={p.id}>{p.name} — {planPrice(p)}</option>)}
                </select>
              </Field>
            ) : <p className="text-small text-fg-secondary sm:col-span-1">Your role can’t see plans — assign one on the network’s page later.</p>}
            <Field label="Trial days" hint={plan ? `Empty = the plan’s own (${plan.trial_days} days); 0 = no trial, invoiced now` : 'With a plan'}>
              <input className="input" inputMode="numeric" disabled={!f.planId} value={f.trialDays} onChange={(e) => setF((s) => ({ ...s, trialDays: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
            </Field>
            <Field label="Account manager" hint="Looks after the customer from now on">
              <StaffSelect staff={staff.data} value={f.accountManagerId} onChange={(v) => setF((s) => ({ ...s, accountManagerId: v }))} noneLabel="None yet" />
            </Field>
          </div>
        </section>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Creating the network…' : 'Create the network'}</button>
        </div>
      </form>
    </Modal>
  );
}
