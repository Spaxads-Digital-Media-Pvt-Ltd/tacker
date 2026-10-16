/**
 * Super Admin › Platform › Feature flags — turn tenant features on or off per network: everyone, a % rollout
 * (stable — the same networks stay in as it grows), networks on chosen plans, listed networks (on / never), and
 * a kill switch. A feature without a flag is on everywhere; the gateable ones are also refused by the API.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { SearchablePicker } from '../../../shared-components/primitives/SearchablePicker';
import type { PlatformPlan } from '../../../lib/platformBilling';
import { useAllNetworks } from '../useAllNetworks';
import { Chip } from '../kit';

interface Flag {
  id: string; key: string; name: string; description: string | null; enabled: boolean; rollout_percent: number; plan_ids: string[];
  network_ids_on: string[]; network_ids_off: string[]; kill_switch: boolean; networks_on: number; networks_total: number; updated_at: string;
}
interface Gateable { key: string; name: string; description: string }

function reach(f: Flag): { label: string; cls: string } {
  if (f.kill_switch) return { label: 'Off for everyone (kill switch)', cls: 'bg-danger-bg text-danger-text' };
  if (f.networks_on === f.networks_total && f.networks_total > 0) return { label: 'On for every network', cls: 'bg-success-bg text-success-text' };
  if (f.networks_on === 0) return { label: 'Off for every network', cls: 'bg-page text-fg-secondary ring-1 ring-inset ring-border' };
  return { label: `On for ${f.networks_on} of ${f.networks_total} networks`, cls: 'bg-warning-bg text-warning-text' };
}

export default function FeatureFlags() {
  const canEdit = usePlatformMe().can('platform', 'full');
  const flags = useQuery<{ flags: Flag[]; gateable: Gateable[] }>('/platform/flags');
  const plans = useQuery<PlatformPlan[]>('/platform/plans');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Flag | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = async (f: Flag, b: Record<string, unknown>) => {
    setError(null);
    try { await api.patch(`/platform/flags/${f.id}`, b); flags.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the flag'); }
  };
  const planName = (id: string) => (plans.data ?? []).find((p) => p.id === id)?.name ?? 'a plan';
  return (
    <>
      <PageHeader title="Feature flags" subtitle="Turn tenant features on or off — for everyone, a rollout, plans or chosen networks."
        action={canEdit ? <button className="btn-primary" onClick={() => setEditing('new')}>New flag</button> : undefined} />
      <p className="mb-4 max-w-3xl text-small text-fg-secondary">A feature without a flag is on for every network. Changes reach every server within 10 seconds; a turned-off feature disappears from the network’s menu and its API answers “not enabled”.</p>
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {flags.loading && !flags.data ? <StateBlock><Spinner /></StateBlock>
        : flags.error ? <StateBlock>{flags.error}</StateBlock>
        : (flags.data?.flags ?? []).length === 0 ? <StateBlock>No flags — every feature is on for every network.</StateBlock>
        : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {flags.data!.flags.map((f) => {
              const r = reach(f);
              return (
                <div key={f.id} className="card space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-fg">{f.name} <span className="ml-1 font-mono text-tiny font-normal text-fg-muted">{f.key}</span></p>
                      {f.description && <p className="text-small text-fg-secondary">{f.description}</p>}
                    </div>
                    <Chip className={r.cls}>{r.label}</Chip>
                  </div>
                  <ul className="space-y-0.5 text-tiny text-fg-secondary">
                    <li>{f.enabled ? 'On for everyone' : f.rollout_percent > 0 ? `Rolled out to ${f.rollout_percent} % of networks` : 'Not on by default'}</li>
                    {f.plan_ids.length > 0 && <li>On for plans: {f.plan_ids.map(planName).join(', ')}</li>}
                    {f.network_ids_on.length > 0 && <li>Always on for {f.network_ids_on.length} network(s)</li>}
                    {f.network_ids_off.length > 0 && <li>Never on for {f.network_ids_off.length} network(s)</li>}
                  </ul>
                  {canEdit && (
                    <div className="flex flex-wrap gap-3 border-t border-border pt-2">
                      <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setEditing(f)}>Edit</button>
                      <button className={`text-tiny font-medium hover:underline ${f.kill_switch ? 'text-accent-text' : 'text-danger-text'}`}
                        onClick={() => (f.kill_switch ? void patch(f, { killSwitch: false }) : confirm({
                          title: `Turn ${f.name} off everywhere?`, confirmLabel: 'Kill switch', destructive: true,
                          message: 'Every network loses it at once (within 10 seconds on every server), whatever else the flag says.',
                          onConfirm: async () => { await api.patch(`/platform/flags/${f.id}`, { killSwitch: true }); flags.refetch(); },
                        }))}>{f.kill_switch ? 'Release kill switch' : 'Kill switch'}</button>
                      <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => confirm({
                        title: `Delete the flag ${f.key}?`, confirmLabel: 'Delete', destructive: true, message: 'Without a flag the feature is on for every network.',
                        onConfirm: async () => { await api.del(`/platform/flags/${f.id}`); flags.refetch(); },
                      })}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {editing && <FlagForm flag={editing === 'new' ? null : editing} gateable={flags.data?.gateable ?? []} existing={(flags.data?.flags ?? []).map((f) => f.key)}
        plans={plans.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flags.refetch(); }} />}
    </>
  );
}

function FlagForm({ flag, gateable, existing, plans, onClose, onSaved }: {
  flag: Flag | null; gateable: Gateable[]; existing: string[]; plans: PlatformPlan[]; onClose: () => void; onSaved: () => void;
}) {
  const networks = useAllNetworks();
  const free = gateable.filter((g) => !existing.includes(g.key));
  const [f, setF] = useState({
    key: flag?.key ?? free[0]?.key ?? '', name: flag?.name ?? free[0]?.name ?? '', description: flag?.description ?? free[0]?.description ?? '',
    enabled: flag?.enabled ?? false, rollout: flag?.rollout_percent ?? 0, planIds: flag?.plan_ids ?? [], on: flag?.network_ids_on ?? [], off: flag?.network_ids_off ?? [],
  });
  const m = useMutation((b: Record<string, unknown>) => (flag ? api.patch(`/platform/flags/${flag.id}`, b) : api.post('/platform/flags', b)));
  const netOptions = (networks.data ?? []).filter((n) => n.status !== 'deleted').map((n) => ({ value: n.id, label: n.name, hint: n.slug }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: f.name.trim(), description: f.description.trim(), enabled: f.enabled, rolloutPercent: f.rollout, planIds: f.planIds, networkIdsOn: f.on, networkIdsOff: f.off,
    };
    if (!flag) body['key'] = f.key.trim();
    if (await m.run(body)) onSaved();
  };
  const pickKey = (key: string) => {
    const g = gateable.find((x) => x.key === key);
    setF((s) => ({ ...s, key, ...(g ? { name: g.name, description: g.description } : {}) }));
  };
  return (
    <Modal open size="xl" onClose={onClose} title={flag ? `Edit ${flag.name}` : 'New feature flag'}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {flag ? <Field label="Key"><input className="input font-mono" disabled value={flag.key} /></Field> : (
            <Field label="Feature" hint="Built-in features are also refused by the API when off; a custom key is read by new work">
              <select className="input" value={gateable.some((g) => g.key === f.key) ? f.key : '__custom'} onChange={(e) => (e.target.value === '__custom' ? setF((s) => ({ ...s, key: '' })) : pickKey(e.target.value))}>
                {free.map((g) => <option key={g.key} value={g.key}>{g.name} ({g.key})</option>)}
                <option value="__custom">A custom key…</option>
              </select>
              {!gateable.some((g) => g.key === f.key) && <input className="input mt-2 font-mono" required pattern="[a-z][a-z0-9_]{1,49}" placeholder="new_dashboard" value={f.key} onChange={(e) => setF((s) => ({ ...s, key: e.target.value }))} />}
            </Field>
          )}
          <Field label="Name"><input className="input" required maxLength={120} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
        </div>
        <Field label="Description" hint="Optional"><input className="input" maxLength={500} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} /></Field>
        <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" checked={f.enabled} onChange={(e) => setF((s) => ({ ...s, enabled: e.target.checked }))} /> On for every network</label>
        {!f.enabled && (
          <Field label={`Roll out to ${f.rollout} % of networks`} hint="The same networks stay in as you raise it">
            <input type="range" min={0} max={100} step={5} className="w-full" value={f.rollout} onChange={(e) => setF((s) => ({ ...s, rollout: Number(e.target.value) }))} />
          </Field>
        )}
        {plans.length > 0 && (
          <Field label="Also on for networks on these plans">
            <div className="flex flex-wrap gap-3">
              {plans.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-small text-fg">
                  <input type="checkbox" checked={f.planIds.includes(p.id)} onChange={(e) => setF((s) => ({ ...s, planIds: e.target.checked ? [...s.planIds, p.id] : s.planIds.filter((x) => x !== p.id) }))} />{p.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Always on for"><SearchablePicker options={netOptions} value={f.on} onChange={(v) => setF((s) => ({ ...s, on: v }))} placeholder="Choose networks…" ariaLabel="Always on for" /></Field>
          <Field label="Never on for"><SearchablePicker options={netOptions} value={f.off} onChange={(v) => setF((s) => ({ ...s, off: v }))} placeholder="Choose networks…" ariaLabel="Never on for" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !f.key}>{m.busy ? 'Saving…' : flag ? 'Save flag' : 'Create flag'}</button>
        </div>
      </form>
    </Modal>
  );
}
