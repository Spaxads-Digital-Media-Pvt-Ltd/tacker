/** A network's discount (its page › Billing): the active coupon and what's left of it, apply one by code, remove it. */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { couponFor, couponOff, type Coupon } from '../../../lib/platformRevenue';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { Panel } from '../kit';

interface Discount { id: string; cycles_left: number | null; applied_at: string; code: string; name: string; kind: Coupon['kind']; percent_off: string | null; amount_off: string | null; currency: string | null; duration: Coupon['duration']; applied_by_name: string | null }

export function NetworkDiscount({ networkId }: { networkId: string }) {
  const canEdit = usePlatformMe().can('billing', 'full');
  const discount = useQuery<Discount | null>(`/platform/networks/${networkId}/discount`);
  const coupons = useQuery<Coupon[]>(canEdit ? '/platform/coupons' : null);
  const confirm = useConfirm();
  const [code, setCode] = useState('');
  const apply = useMutation((c: string) => api.post(`/platform/networks/${networkId}/discount`, { code: c }));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await apply.run(code.trim())) { setCode(''); discount.refetch(); } };
  const d = discount.data;
  return (
    <Panel title="Discount">
      <div className="space-y-3 px-4 py-3 text-small">
        {discount.error ? <p className="text-danger-text">{discount.error}</p> : d ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-fg"><span className="font-mono">{d.code}</span> · {couponOff(d)}</p>
              <p className="text-tiny text-fg-muted">
                {d.name} · on {couponFor({ duration: d.duration, duration_cycles: d.cycles_left })}{d.duration === 'repeating' ? ' left' : ''} · applied {relTime(d.applied_at)}{d.applied_by_name ? ` by ${d.applied_by_name}` : ''}
              </p>
            </div>
            {canEdit && <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => confirm({
              title: `Remove ${d.code}?`, confirmLabel: 'Remove', destructive: true, message: 'Its next invoices are at the full price.',
              onConfirm: async () => { await api.del(`/platform/networks/${networkId}/discount`); discount.refetch(); },
            })}>Remove</button>}
          </div>
        ) : <p className="text-fg-secondary">No discount — invoices are at the plan’s price.</p>}
        {canEdit && (
          <form onSubmit={submit} className="flex flex-wrap gap-2">
            <input className="input max-w-[14rem] font-mono uppercase" list={`coupons-${networkId}`} placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value)} />
            <datalist id={`coupons-${networkId}`}>{(coupons.data ?? []).map((c) => <option key={c.id} value={c.code}>{c.name} · {couponOff(c)}</option>)}</datalist>
            <button type="submit" className="btn-ghost" disabled={apply.busy || !code.trim()}>{apply.busy ? 'Applying…' : d ? 'Replace with this' : 'Apply'}</button>
            {apply.error && <p className="w-full text-danger-text">{apply.error}</p>}
          </form>
        )}
      </div>
    </Panel>
  );
}
