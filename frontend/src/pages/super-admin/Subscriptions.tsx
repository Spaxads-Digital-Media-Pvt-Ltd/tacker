import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import type { NetworkRow } from '../../types';

interface Plan {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  limits: Record<string, number | string | boolean>;
}

export default function Subscriptions() {
  const plans = useQuery<Plan[]>('/platform/plans');
  const networks = useQuery<NetworkRow[]>('/platform/networks');
  const [newPlan, setNewPlan] = useState(false);
  const [assignTo, setAssignTo] = useState<NetworkRow | null>(null);

  const planCols: Column<Plan>[] = [
    { header: 'Plan', cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: 'Code', cell: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { header: 'Price', cell: (p) => `${p.currency} ${(p.price_cents / 100).toFixed(2)}/mo` },
    { header: 'Limits', cell: (p) => <span className="text-tiny text-fg-secondary">{Object.entries(p.limits).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</span> },
  ];

  const netCols: Column<NetworkRow>[] = [
    { header: 'Network', cell: (n) => <span className="font-medium">{n.name}</span> },
    { header: 'Plan', cell: (n) => n.plan_code ?? <span className="text-fg-muted">none</span> },
    { header: 'Status', cell: (n) => (n.subscription_status ? <Badge value={n.subscription_status} /> : <span className="text-fg-muted">—</span>) },
    { header: '', className: 'text-right', cell: (n) => <button className="btn-ghost !py-1 !px-3 text-xs" onClick={() => setAssignTo(n)}>Assign plan</button> },
  ];

  return (
    <>
      <PageHeader title="Subscriptions & plans" subtitle="Define plans and assign them to tenant networks."
        action={<button className="btn-primary" onClick={() => setNewPlan(true)}>New plan</button>} />

      <h2 className="mb-3 text-small font-semibold uppercase tracking-wide text-fg-secondary">Plans</h2>
      {plans.loading ? <StateBlock><Spinner /></StateBlock>
        : plans.error ? <StateBlock>{plans.error}</StateBlock>
        : !plans.data || plans.data.length === 0 ? <StateBlock>No plans yet.</StateBlock>
        : <Table columns={planCols} rows={plans.data} rowKey={(p) => p.id} />}

      <h2 className="mb-3 mt-8 text-small font-semibold uppercase tracking-wide text-fg-secondary">Networks</h2>
      {networks.loading ? <StateBlock><Spinner /></StateBlock>
        : networks.error ? <StateBlock>{networks.error}</StateBlock>
        : <Table columns={netCols} rows={networks.data ?? []} rowKey={(n) => n.id} />}

      <NewPlan open={newPlan} onClose={() => setNewPlan(false)} onDone={() => { setNewPlan(false); plans.refetch(); }} />
      <AssignPlan network={assignTo} plans={plans.data ?? []} onClose={() => setAssignTo(null)} onDone={() => { setAssignTo(null); networks.refetch(); }} />
    </>
  );
}

function NewPlan({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', price: '99', clicks: '1000000', offers: '100', seats: '10' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { run, busy, error } = useMutation((b: Record<string, unknown>) => api.post('/platform/plans', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({
      code: f.code, name: f.name, priceCents: Math.round(Number(f.price) * 100),
      limits: { clicks: Number(f.clicks), offers: Number(f.offers), seats: Number(f.seats) },
    });
    if (res) onDone();
  };
  return (
    <Modal open={open} onClose={onClose} title="New plan">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><input className="input" required value={f.code} onChange={set('code')} placeholder="growth" /></Field>
          <Field label="Name"><input className="input" required value={f.name} onChange={set('name')} placeholder="Growth" /></Field>
          <Field label="Price / mo (USD)"><input className="input" value={f.price} onChange={set('price')} /></Field>
          <Field label="Clicks / mo"><input className="input" value={f.clicks} onChange={set('clicks')} /></Field>
          <Field label="Offers limit"><input className="input" value={f.offers} onChange={set('offers')} /></Field>
          <Field label="Seats"><input className="input" value={f.seats} onChange={set('seats')} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create plan'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignPlan({ network, plans, onClose, onDone }: { network: NetworkRow | null; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState('active');
  const { run, busy, error } = useMutation((b: { id: string; body: Record<string, unknown> }) => api.put(`/platform/networks/${b.id}/subscription`, b.body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!network) return;
    const res = await run({ id: network.id, body: { planId, status } });
    if (res) onDone();
  };
  return (
    <Modal open={!!network} onClose={onClose} title={`Assign plan — ${network?.name ?? ''}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Plan">
          <select className="input" required value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="" disabled>Select plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.currency} {(p.price_cents / 100).toFixed(0)}/mo</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['active', 'trialing', 'past_due', 'canceled'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
        </div>
      </form>
    </Modal>
  );
}
