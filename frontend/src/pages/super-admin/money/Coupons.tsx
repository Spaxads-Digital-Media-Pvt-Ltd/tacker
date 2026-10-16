/**
 * Super Admin › Money › Coupons — discounts for networks' subscriptions: a percent or an amount off, for one
 * invoice, a number of invoices, or forever; a redemption limit; an expiry. Apply one on a network's page
 * (Billing tab); its invoices show the discount as a line.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { day } from '../../../lib/platformBilling';
import { PageHeader, Table, Modal, Field, Segmented, Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';
import { couponFor, couponOff, type Coupon } from '../../../lib/platformRevenue';

export default function Coupons() {
  const canEdit = usePlatformMe().can('billing', 'full');
  const [status, setStatus] = useState('active');
  const coupons = useQuery<Coupon[]>('/platform/coupons', { status });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setCouponStatus = async (c: Coupon, to: 'active' | 'archived') => {
    setError(null);
    try { await api.patch(`/platform/coupons/${c.id}`, { status: to }); coupons.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the coupon'); }
  };
  const expired = (c: Coupon) => !!c.valid_until && new Date(c.valid_until) < new Date();
  const usedUp = (c: Coupon) => c.max_redemptions !== null && c.redeemed >= c.max_redemptions;

  const columns: Column<Coupon>[] = [
    { header: 'Code', cell: (c) => <div><p className="font-mono font-semibold text-fg">{c.code}</p><p className="text-tiny text-fg-muted">{c.name}</p></div> },
    { header: 'Discount', cell: (c) => <span className="font-medium text-fg">{couponOff(c)}</span> },
    { header: 'Applies to', cell: (c) => couponFor(c) },
    { header: 'Used', cell: (c) => <span>{c.redeemed}{c.max_redemptions !== null ? ` / ${c.max_redemptions}` : ''}{c.active_discounts ? <span className="ml-1 text-tiny text-fg-muted">({c.active_discounts} running)</span> : null}</span> },
    { header: 'Valid until', cell: (c) => (c.valid_until ? day(c.valid_until) : <span className="text-fg-muted">no end</span>) },
    {
      header: 'Status', cell: (c) => (c.status === 'archived' ? <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">Archived</Chip>
        : expired(c) ? <Chip className="bg-warning-bg text-warning-text">Expired</Chip>
        : usedUp(c) ? <Chip className="bg-warning-bg text-warning-text">Used up</Chip>
        : <Chip className="bg-success-bg text-success-text">Active</Chip>),
    },
    {
      header: '', className: 'text-right', cell: (c) => (canEdit
        ? <button className={`text-tiny font-medium hover:underline ${c.status === 'active' ? 'text-danger-text' : 'text-accent-text'}`}
          onClick={() => void setCouponStatus(c, c.status === 'active' ? 'archived' : 'active')}>{c.status === 'active' ? 'Archive' : 'Unarchive'}</button> : null),
    },
  ];

  return (
    <>
      <PageHeader title="Coupons" subtitle="Discounts on networks’ subscriptions — apply one on a network’s page (Billing tab)."
        action={canEdit ? <button className="btn-primary" onClick={() => setCreating(true)}>New coupon</button> : undefined} />
      <div className="mb-4 max-w-xs"><Segmented options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} /></div>
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {coupons.loading && !coupons.data ? <StateBlock><Spinner /></StateBlock>
        : coupons.error ? <StateBlock>{coupons.error}</StateBlock>
        : (coupons.data ?? []).length === 0 ? <StateBlock>No coupons here.</StateBlock>
        : <Table columns={columns} rows={coupons.data ?? []} rowKey={(c) => c.id} />}
      {creating && <CouponForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); coupons.refetch(); }} />}
    </>
  );
}

function CouponForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '', kind: 'percent', percentOff: '', amountOff: '', currency: 'USD', duration: 'once', durationCycles: '3', maxRedemptions: '', validUntil: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation((b: Record<string, unknown>) => api.post('/platform/coupons', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await m.run({
      code: f.code.trim(), name: f.name.trim(), kind: f.kind, duration: f.duration,
      ...(f.kind === 'percent' ? { percentOff: f.percentOff.trim() } : { amountOff: f.amountOff.trim(), currency: f.currency.trim() }),
      ...(f.duration === 'repeating' ? { durationCycles: Number(f.durationCycles) } : {}),
      ...(f.maxRedemptions.trim() ? { maxRedemptions: Number(f.maxRedemptions) } : {}),
      ...(f.validUntil ? { validUntil: f.validUntil } : {}),
    });
    if (ok) onSaved();
  };
  return (
    <Modal open onClose={onClose} title="New coupon">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Letters, digits, - and _"><input className="input font-mono uppercase" required maxLength={40} value={f.code} onChange={set('code')} placeholder="LAUNCH20" /></Field>
          <Field label="Name"><input className="input" required maxLength={120} value={f.name} onChange={set('name')} placeholder="Launch offer" /></Field>
        </div>
        <Segmented options={[{ value: 'percent', label: 'Percent off' }, { value: 'amount', label: 'Amount off' }]} value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} />
        {f.kind === 'percent'
          ? <Field label="Percent off"><input className="input max-w-[10rem]" required inputMode="decimal" value={f.percentOff} onChange={set('percentOff')} placeholder="20" /></Field>
          : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount off" hint="Per invoice; never more than the plan"><input className="input" required inputMode="decimal" value={f.amountOff} onChange={set('amountOff')} placeholder="50.00" /></Field>
              <Field label="Currency" hint="Must match the network’s plan"><input className="input uppercase" required maxLength={3} value={f.currency} onChange={set('currency')} /></Field>
            </div>
          )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Applies to">
            <select className="input" value={f.duration} onChange={set('duration')}>
              <option value="once">The next invoice only</option><option value="repeating">A number of invoices</option><option value="forever">Every invoice</option>
            </select>
          </Field>
          {f.duration === 'repeating' && <Field label="How many invoices"><input className="input" required inputMode="numeric" value={f.durationCycles} onChange={set('durationCycles')} /></Field>}
          <Field label="Max uses" hint="Blank = unlimited"><input className="input" inputMode="numeric" value={f.maxRedemptions} onChange={set('maxRedemptions')} /></Field>
          <Field label="Valid until" hint="Blank = no end; applying stops after this day"><input className="input" type="date" value={f.validUntil} onChange={set('validUntil')} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Create coupon'}</button>
        </div>
      </form>
    </Modal>
  );
}
