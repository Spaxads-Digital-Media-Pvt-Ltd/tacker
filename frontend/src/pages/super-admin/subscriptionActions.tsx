/**
 * A network's subscription, from its page: assign a plan (a free trial — the plan's own or one you give —
 * or paying from now, invoiced at once) or change a live one (now; billed at the new price from the next
 * period, no proration); extend a trial.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { Modal, Field } from '../../shared-components/primitives/ui';
import { planPrice, type PlatformPlan, type PlatformInvoice } from '../../lib/platformBilling';

export function AssignPlanModal({ networkId, networkName, live, currentPlanId, onClose, onDone }: {
  networkId: string; networkName: string; live: boolean; currentPlanId: string | null;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const plans = useQuery<PlatformPlan[]>('/platform/plans');
  const [planId, setPlanId] = useState('');
  const [trial, setTrial] = useState<string | null>(null); // null = the plan's own
  const m = useMutation((body: Record<string, unknown>) =>
    api.put<{ invoice: PlatformInvoice | null; changed: boolean; subscription: { status: string } }>(`/platform/networks/${networkId}/subscription`, body));
  const plan = (plans.data ?? []).find((p) => p.id === planId);
  const trialDays = trial === null ? plan?.trial_days ?? 0 : Number(trial);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!plan) return;
    const r = await m.run({ planId, ...(live ? {} : { trialDays }) });
    if (!r) return;
    onDone(r.changed ? `${networkName} is now on ${plan.name} — billed at the new price from the next period.`
      : r.subscription.status === 'trialing' ? `${networkName} started a ${trialDays}-day trial of ${plan.name}.`
      : r.invoice ? `${networkName} is on ${plan.name}; invoice ${r.invoice.number} was issued.` : `${networkName} is on ${plan.name}.`);
  };
  return (
    <Modal open onClose={onClose} title={live ? `Change ${networkName}’s plan` : `Assign a plan to ${networkName}`}>
      <form onSubmit={submit} className="space-y-4">
        {(m.error || plans.error) && <p className="text-small text-danger-text">{m.error ?? plans.error}</p>}
        <Field label="Plan">
          <select className="input" required value={planId} onChange={(e) => { setPlanId(e.target.value); setTrial(null); }}>
            <option value="" disabled>{plans.loading ? 'Loading…' : (plans.data ?? []).length ? 'Choose a plan…' : 'No plans — create one in Plans'}</option>
            {(plans.data ?? []).map((p) => <option key={p.id} value={p.id} disabled={p.id === currentPlanId}>{p.name} — {planPrice(p)}{p.id === currentPlanId ? ' (current)' : ''}</option>)}
          </select>
        </Field>
        {plan && (live ? (
          <p className="text-small text-fg-secondary">The change applies now; the next invoice (at the end of the current period) is at {planPrice(plan)}. Nothing is prorated.</p>
        ) : (
          <>
            <Field label="Free trial (days)" hint={`The plan’s own: ${plan.trial_days || 'none'} · 0 = start paying now`}>
              <input className="input max-w-[10rem]" inputMode="numeric" value={trial ?? String(plan.trial_days)} onChange={(e) => setTrial(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <p className="text-small text-fg-secondary">
              {trialDays > 0 ? `No invoice until the trial ends (in ${trialDays} days); then ${planPrice(plan)}.`
                : plan.price_cents > 0 ? `Invoiced now for the first period (${planPrice(plan)}), then at every renewal.` : 'A free plan — no invoices.'}
            </p>
          </>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !plan}>{m.busy ? 'Saving…' : live ? 'Change plan' : 'Assign plan'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ExtendTrialModal({ networkId, onClose, onDone }: { networkId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [days, setDays] = useState('7');
  const m = useMutation((b: { days: number }) => api.post<{ trial_ends_at: string }>(`/platform/networks/${networkId}/subscription/extend-trial`, b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.run({ days: Number(days) });
    if (r) onDone(`The trial now ends on ${new Date(r.trial_ends_at).toLocaleDateString()}.`);
  };
  return (
    <Modal open onClose={onClose} title="Extend the trial">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <Field label="Extra days"><input className="input max-w-[10rem]" required inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !days}>{m.busy ? 'Saving…' : 'Extend trial'}</button>
        </div>
      </form>
    </Modal>
  );
}
