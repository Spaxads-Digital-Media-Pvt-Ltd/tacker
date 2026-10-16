/** New lead / edit a lead (Super Admin › Sales). Amounts are typed as text and sent as text. */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { Modal, Field } from '../../../shared-components/primitives/ui';
import { OPEN_STAGES, SOURCES, stageOf, useStaff, toLocalInput, fromLocalInput, type Lead, type Stage } from '../../../lib/platformSales';
import { StaffSelect } from './parts';

export function LeadForm({ lead, initialStage = 'new', onClose, onSaved }: {
  lead: Lead | null; initialStage?: Stage; onClose: () => void; onSaved: (lead: Lead) => void;
}) {
  const { me, can } = usePlatformMe();
  const staff = useStaff();
  const plans = useQuery<{ id: string; name: string; currency: string }[]>(can('plans') ? '/platform/plans' : null);
  const [f, setF] = useState({
    company: lead?.company ?? '', contactName: lead?.contact_name ?? '', email: lead?.email ?? '', phone: lead?.phone ?? '',
    website: lead?.website ?? '', country: lead?.country ?? '', source: lead?.source ?? 'manual', stage: (lead?.stage ?? initialStage) as Stage,
    ownerId: lead ? (lead.owner_id ?? '') : (me?.id ?? ''), planId: lead?.plan_id ?? '', expectedMrr: lead?.expected_mrr ?? '',
    currency: lead?.currency ?? 'USD', monthlyClicks: lead?.monthly_clicks != null ? String(lead.monthly_clicks) : '',
    nextStep: lead?.next_step ?? '', nextStepAt: toLocalInput(lead?.next_step_at), tags: (lead?.tags ?? []).join(', '), notes: lead?.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation((b: Record<string, unknown>) => (lead ? api.patch<Lead>(`/platform/sales/leads/${lead.id}`, b) : api.post<Lead>('/platform/sales/leads', b)));
  const [clientError, setClientError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setClientError(null);
    const clicks = f.monthlyClicks.replace(/[,\s]/g, '');
    if (clicks && !/^\d+$/.test(clicks)) { setClientError('Monthly clicks must be a whole number.'); return; }
    const body: Record<string, unknown> = {
      company: f.company, contactName: f.contactName, email: f.email, phone: f.phone, website: f.website, country: f.country,
      source: f.source, ownerId: f.ownerId || null, planId: f.planId || null, expectedMrr: f.expectedMrr.trim(), currency: f.currency,
      monthlyClicks: clicks ? Number(clicks) : null, nextStep: f.nextStep, nextStepAt: fromLocalInput(f.nextStepAt) ?? '',
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: f.notes,
    };
    if (!lead) body['stage'] = f.stage;
    const saved = await m.run(body);
    if (saved) onSaved(saved);
  };

  return (
    <Modal open size="xl" onClose={onClose} title={lead ? `Edit ${lead.company}` : 'New lead'}>
      <form onSubmit={submit} className="space-y-5">
        {(clientError || m.error) && <p className="text-small text-danger-text">{clientError ?? m.error}</p>}
        <section className="space-y-3">
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-fg-secondary">Company &amp; contact</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Company"><input className="input" required maxLength={200} value={f.company} onChange={set('company')} autoFocus /></Field>
            <Field label="Website"><input className="input" maxLength={300} value={f.website} onChange={set('website')} placeholder="acme-media.com" /></Field>
            <Field label="Contact name"><input className="input" maxLength={200} value={f.contactName} onChange={set('contactName')} /></Field>
            <Field label="Email"><input className="input" type="email" maxLength={200} value={f.email} onChange={set('email')} /></Field>
            <Field label="Phone"><input className="input" maxLength={50} value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Country"><input className="input" maxLength={100} value={f.country} onChange={set('country')} /></Field>
          </div>
        </section>
        <section className="space-y-3">
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-fg-secondary">Deal</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {!lead && (
              <Field label="Stage">
                <select className="input" value={f.stage} onChange={set('stage')}>{OPEN_STAGES.map((s) => <option key={s} value={s}>{stageOf(s).label}</option>)}</select>
              </Field>
            )}
            <Field label="Source">
              <select className="input" value={f.source} onChange={set('source')}>{SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            </Field>
            <Field label="Owner"><StaffSelect staff={staff.data} value={f.ownerId} onChange={(v) => setF((s) => ({ ...s, ownerId: v }))} /></Field>
            <Field label="Expected MRR" hint="Monthly recurring revenue if won, e.g. 499 or 499.50">
              <div className="flex gap-2">
                <input className="input" inputMode="decimal" maxLength={16} value={f.expectedMrr} onChange={set('expectedMrr')} placeholder="0.00" />
                <input className="input w-20 uppercase" maxLength={3} value={f.currency} onChange={set('currency')} aria-label="Currency" />
              </div>
            </Field>
            <Field label="Monthly clicks" hint="Their expected traffic — sizes the deal"><input className="input" inputMode="numeric" value={f.monthlyClicks} onChange={set('monthlyClicks')} placeholder="e.g. 5,000,000" /></Field>
            {plans.data && (
              <Field label="Likely plan">
                <select className="input" value={f.planId} onChange={set('planId')}>
                  <option value="">Not decided</option>
                  {plans.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Next step"><input className="input" maxLength={300} value={f.nextStep} onChange={set('nextStep')} placeholder="e.g. Send the proposal" /></Field></div>
            <Field label="Next step on"><input className="input" type="datetime-local" value={f.nextStepAt} onChange={set('nextStepAt')} /></Field>
          </div>
          <Field label="Tags" hint="Comma-separated, e.g. enterprise, india"><input className="input" value={f.tags} onChange={set('tags')} /></Field>
          <Field label="Notes"><textarea className="input min-h-[80px]" maxLength={5000} value={f.notes} onChange={set('notes')} /></Field>
        </section>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : lead ? 'Save' : 'Add lead'}</button>
        </div>
      </form>
    </Modal>
  );
}
