/**
 * Super Admin › a network › its deal when it differs from its plan (PUT /platform/networks/:id/overrides):
 * its own price (the plan's currency and interval), billing exempt (never invoiced), and limits — each the
 * plan's, a number of its own, or unlimited. Saving it all back to the plan's removes the override.
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { Field, Modal } from '../../shared-components/primitives/ui';
import type { NetworkDetail } from '../../types';
import { OVERRIDE_LIMITS as KEYS } from '../../lib/platformBilling';

type Key = (typeof KEYS)[number]['key'];
type Mode = 'plan' | 'custom' | 'unlimited';

export function OverridesModal({ network, onClose, onSaved }: { network: NetworkDetail; onClose: () => void; onSaved: () => void }) {
  const o = network.overrides ?? null;
  const planLimits = network.subscription?.limits ?? {};
  const [price, setPrice] = useState(o?.price ?? '');
  const [exempt, setExempt] = useState(o?.billingExempt ?? false);
  const [note, setNote] = useState(o?.note ?? '');
  const [limits, setLimits] = useState<Record<Key, { mode: Mode; value: string }>>(() => Object.fromEntries(KEYS.map(({ key }) => {
    const v = o?.limits[key];
    return [key, v === undefined ? { mode: 'plan', value: '' } : v === null ? { mode: 'unlimited', value: '' } : { mode: 'custom', value: String(v) }];
  })) as Record<Key, { mode: Mode; value: string }>);
  const save = useMutation((b: Record<string, unknown>) => api.put(`/platform/networks/${network.id}/overrides`, b));
  const submit = async () => {
    const lim: Record<string, number | null> = {};
    for (const { key } of KEYS) {
      const l = limits[key];
      if (l.mode === 'unlimited') lim[key] = null;
      else if (l.mode === 'custom') lim[key] = Number(l.value);
    }
    if (await save.run({ price: price.trim() || null, billingExempt: exempt, limits: lim, note: note.trim() })) onSaved();
  };
  const sub = network.subscription;
  return (
    <Modal open onClose={onClose} title={`${network.name} · its own deal`} size="xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={save.busy} onClick={() => void submit()}>{save.busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="space-y-4">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <p className="text-small text-fg-secondary">For a network whose deal differs from its plan{sub ? ` (${sub.plan_name})` : ''}. It applies from its next invoice; MRR and its limits change at once.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`Its own price${sub ? ` (${sub.currency}, per ${sub.billing_interval})` : ''}`}>
            <input className="input font-mono" inputMode="decimal" placeholder={sub ? `Plan’s: ${(sub.price_cents / 100).toFixed(2)}` : 'The plan’s'} value={price} onChange={(e) => setPrice(e.target.value)} disabled={exempt} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-small text-fg">
            <input type="checkbox" className="h-4 w-4" checked={exempt} onChange={(e) => setExempt(e.target.checked)} /> Billing exempt — never invoiced (a partner, internal or comped network)
          </label>
        </div>
        <div>
          <p className="label">Limits</p>
          <div className="space-y-2">
            {KEYS.map(({ key, label }) => {
              const l = limits[key];
              const planV = planLimits[key];
              return (
                <div key={key} className="grid grid-cols-[10rem_1fr_9rem] items-center gap-3 text-small">
                  <span className="text-fg">{label}</span>
                  <select className="input" value={l.mode} aria-label={`${label} — source`} onChange={(e) => setLimits((s) => ({ ...s, [key]: { ...s[key], mode: e.target.value as Mode } }))}>
                    <option value="plan">The plan’s ({planV !== undefined && Number(planV) > 0 ? Number(planV).toLocaleString() : 'none'})</option>
                    <option value="custom">Its own limit</option>
                    <option value="unlimited">Unlimited</option>
                  </select>
                  <input className="input font-mono" inputMode="numeric" disabled={l.mode !== 'custom'} value={l.value} aria-label={`${label} — its own limit`}
                    onChange={(e) => setLimits((s) => ({ ...s, [key]: { ...s[key], value: e.target.value } }))} />
                </div>
              );
            })}
          </div>
        </div>
        <Field label="Note (why)"><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Launch partner — 50% off for the first year" /></Field>
      </div>
    </Modal>
  );
}
