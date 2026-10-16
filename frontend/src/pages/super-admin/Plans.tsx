/**
 * Super Admin › Plans — the plan catalog tenants subscribe to: price per month or year, an optional free
 * trial, and limits (clicks / conversions / events per billing period; offers and team seats as counts —
 * compared with usage on each network's page, flagged at 80 % and 100 %, never blocked). Edit (a new price
 * applies from the next invoice), archive (no new subscriptions; live ones keep it), unarchive.
 * Plans are assigned on a network's page.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import { planPrice, centsToAmount, amountToCents, type PlatformPlan } from '../../lib/platformBilling';

const LIMITS: { key: string; label: string; hint: string }[] = [
  { key: 'clicks', label: 'Clicks / period', hint: 'Blank = unlimited' },
  { key: 'conversions', label: 'Conversions / period', hint: 'Blank = unlimited' },
  { key: 'events', label: 'Events / period', hint: 'Blank = unlimited' },
  { key: 'offers', label: 'Offers', hint: 'Live offers' },
  { key: 'seats', label: 'Team seats', hint: 'Active team members' },
];
const limitsText = (l: PlatformPlan['limits']) =>
  LIMITS.filter((x) => Number(l[x.key]) > 0).map((x) => `${x.label.replace(' / period', '')}: ${Number(l[x.key]).toLocaleString()}`).join(' · ') || 'Unlimited';

export default function Plans() {
  const [showArchived, setShowArchived] = useState(false);
  const plans = useQuery<PlatformPlan[]>(`/platform/plans?status=${showArchived ? 'all' : 'active'}`);
  const [editing, setEditing] = useState<PlatformPlan | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const setArchived = (p: PlatformPlan, archive: boolean) => confirm({
    title: `${archive ? 'Archive' : 'Unarchive'} ${p.name}?`, confirmLabel: archive ? 'Archive' : 'Unarchive', destructive: archive,
    message: archive
      ? `No network can be put on it any more. ${p.subscribers ? `The ${p.subscribers} network(s) on it keep it and keep renewing.` : ''}`
      : 'It can be assigned to networks again.',
    onConfirm: async () => { setError(null); await api.post(`/platform/plans/${p.id}/${archive ? 'archive' : 'unarchive'}`, {}); plans.refetch(); },
  });

  const columns: Column<PlatformPlan>[] = [
    {
      header: 'Plan', cell: (p) => (
        <div>
          <p className="font-medium">{p.name} <span className="ml-1 font-mono text-tiny text-fg-muted">{p.code}</span></p>
          {p.description && <p className="text-tiny text-fg-secondary">{p.description}</p>}
        </div>
      ),
    },
    { header: 'Price', cell: (p) => <span className="whitespace-nowrap">{planPrice(p)}</span> },
    { header: 'Trial', cell: (p) => (p.trial_days ? `${p.trial_days} days` : <span className="text-fg-muted">—</span>) },
    { header: 'Limits', cell: (p) => <span className="text-tiny text-fg-secondary">{limitsText(p.limits)}</span> },
    { header: 'Networks', className: 'text-right', cell: (p) => p.subscribers },
    { header: 'Status', cell: (p) => <Badge value={p.status} /> },
    {
      header: '', className: 'text-right', cell: (p) => (
        <span className="flex justify-end gap-3 whitespace-nowrap">
          <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setEditing(p)}>Edit</button>
          {p.status === 'active'
            ? <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => setArchived(p, true)}>Archive</button>
            : <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setArchived(p, false)}>Unarchive</button>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Plans" subtitle="What tenants subscribe to — price, trial and limits. Assign plans on a network's page."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>New plan</button>} />
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      <label className="mb-3 flex items-center gap-2 text-small text-fg-secondary">
        <input type="checkbox" className="h-4 w-4 rounded border-border" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived plans
      </label>
      {plans.loading ? <StateBlock><Spinner /></StateBlock>
        : plans.error ? <StateBlock>{plans.error}</StateBlock>
        : (plans.data ?? []).length === 0 ? <StateBlock>No plans yet — create one, then assign it on a network’s page.</StateBlock>
        : <Table columns={columns} rows={plans.data ?? []} rowKey={(p) => p.id} />}
      {editing && <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); plans.refetch(); }} />}
    </>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: PlatformPlan | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [price, setPrice] = useState(plan ? centsToAmount(plan.price_cents) : '');
  const [currency, setCurrency] = useState(plan?.currency ?? 'USD');
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>(plan?.billing_interval ?? 'month');
  const [trialDays, setTrialDays] = useState(String(plan?.trial_days ?? 0));
  const [description, setDescription] = useState(plan?.description ?? '');
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(LIMITS.map((l) => [l.key, plan && Number(plan.limits[l.key]) > 0 ? String(plan.limits[l.key]) : ''])));
  const [formError, setFormError] = useState<string | null>(null);
  const m = useMutation((body: Record<string, unknown>) => (plan ? api.patch(`/platform/plans/${plan.id}`, body) : api.post('/platform/plans', body)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = amountToCents(price);
    if (cents === null) { setFormError('Price must be an amount like 99 or 99.50.'); return; }
    const parsedLimits: Record<string, number> = {};
    for (const l of LIMITS) {
      const v = limits[l.key]?.trim();
      if (!v) continue;
      if (!/^\d+$/.test(v) || Number(v) <= 0) { setFormError(`${l.label} must be a whole number above 0 (or blank).`); return; }
      parsedLimits[l.key] = Number(v);
    }
    if (!/^\d+$/.test(trialDays.trim() || '0')) { setFormError('Trial days must be a whole number.'); return; }
    setFormError(null);
    const body: Record<string, unknown> = {
      name: name.trim(), priceCents: cents, currency: currency.trim().toUpperCase(), billingInterval,
      trialDays: Number(trialDays.trim() || '0'), description: description.trim() || null, limits: parsedLimits,
    };
    if (!plan) body['code'] = code.trim();
    if (await m.run(body)) onSaved();
  };

  return (
    <Modal open onClose={onClose} title={plan ? `Edit ${plan.name}` : 'New plan'}>
      <form onSubmit={submit} className="space-y-4">
        {(formError || m.error) && <p className="text-small text-danger-text">{formError ?? m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name"><input className="input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" /></Field>
          <Field label="Code" hint={plan ? 'Fixed once created' : 'lowercase, e.g. growth'}>
            <input className="input font-mono" required disabled={!!plan} maxLength={50} value={code} onChange={(e) => setCode(e.target.value)} placeholder="growth" />
          </Field>
          <Field label="Price" hint={plan ? 'A new price applies from the next invoice' : undefined}>
            <input className="input" required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="99.00" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency"><input className="input uppercase" required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
            <Field label="Billed">
              <select className="input" value={billingInterval} onChange={(e) => setBillingInterval(e.target.value as 'month' | 'year')}>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </Field>
          </div>
          <Field label="Free trial (days)" hint="0 = no trial"><input className="input" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /></Field>
        </div>
        <div>
          <p className="mb-2 text-small font-medium text-fg">Limits <span className="font-normal text-fg-secondary">— flagged at 80 % and 100 %, never blocked</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {LIMITS.map((l) => (
              <Field key={l.key} label={l.label} hint={l.hint}>
                <input className="input" inputMode="numeric" value={limits[l.key] ?? ''} onChange={(e) => setLimits((s) => ({ ...s, [l.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </div>
        <Field label="Description" hint="Optional"><input className="input" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}</button>
        </div>
      </form>
    </Modal>
  );
}
