/**
 * Super Admin › Networks — the bar over the list when networks are ticked: the same change to all of them
 * (POST /platform/networks/bulk) — suspend / activate, account manager, seller, tag, plan, reseller — each
 * offered only to a role that may make it. Each network is done on its own; the ones that weren't are listed.
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { usePlatformMe } from '../../lib/platformMe';
import { useStaff } from '../../lib/platformSales';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { Field, Modal } from '../../shared-components/primitives/ui';
import type { Reseller } from '../../lib/platformResellers';

type Action = 'suspend' | 'activate' | 'account_manager' | 'sales_owner' | 'plan' | 'reseller' | 'add_tag';
interface Result { done: number; failed: { id: string; name: string | null; error: string }[] }

const TITLE: Record<Exclude<Action, 'suspend' | 'activate'>, string> = {
  account_manager: 'Account manager', sales_owner: 'Seller', plan: 'Plan', reseller: 'Reseller', add_tag: 'Add a tag',
};

function ValueModal({ action, count, onClose, onRun }: { action: Exclude<Action, 'suspend' | 'activate'>; count: number; onClose: () => void; onRun: (b: Record<string, unknown>) => Promise<boolean> }) {
  const staff = useStaff();
  const plans = useQuery<{ id: string; name: string; status: string }[]>(action === 'plan' ? '/platform/plans' : null);
  const resellers = useQuery<Reseller[]>(action === 'reseller' ? '/platform/resellers' : null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const body = (): Record<string, unknown> => action === 'plan' ? { planId: value } : action === 'add_tag' ? { tag: value.trim() }
    : action === 'reseller' ? { resellerId: value || null } : { memberId: value || null };
  const ready = action === 'plan' || action === 'add_tag' ? value.trim() !== '' : true;
  return (
    <Modal open onClose={onClose} title={`${TITLE[action]} for ${count} network${count === 1 ? '' : 's'}`}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!ready || busy} onClick={async () => { setBusy(true); const ok = await onRun(body()); setBusy(false); if (ok) onClose(); }}>{busy ? 'Applying…' : 'Apply'}</button></>}>
      {action === 'add_tag' ? (
        <Field label="Tag"><input className="input" maxLength={40} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. enterprise" /></Field>
      ) : action === 'plan' ? (
        <div className="space-y-2">
          <Field label="Plan">
            <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {(plans.data ?? []).filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <p className="text-tiny text-fg-muted">A network on a plan switches now (billed at the new price from its next period); one without a plan starts it — invoiced at once unless it has a trial.</p>
        </div>
      ) : action === 'reseller' ? (
        <Field label="Reseller">
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">None (sold directly)</option>
            {(resellers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={TITLE[action]}>
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Nobody</option>
            {(staff.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email} · {m.role_name}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

export function NetworkBulkBar({ ids, onDone, onClear }: { ids: string[]; onDone: () => void; onClear: () => void }) {
  const { can } = usePlatformMe();
  const confirm = useConfirm();
  const [asking, setAsking] = useState<Exclude<Action, 'suspend' | 'activate'> | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const run = useMutation((b: Record<string, unknown>) => api.post<Result>('/platform/networks/bulk', { ids, ...b }));
  const go = async (b: Record<string, unknown>): Promise<boolean> => {
    setResult(null);
    const out = await run.run(b);
    if (out) { setResult(out); onDone(); }
    return Boolean(out);
  };
  const n = ids.length;
  const btn = 'rounded-[var(--radius)] px-2.5 py-1 text-tiny font-medium text-accent-text hover:bg-accent-subtle';
  return (
    <div className="mb-3 space-y-2">
      {n > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-[var(--radius)] bg-accent-subtle/60 px-3 py-2 ring-1 ring-inset ring-accent/30">
          <span className="mr-2 text-small font-medium text-fg">{n} selected</span>
          {can('networks', 'full') && <>
            <button className={`${btn} !text-danger-text`} onClick={() => confirm({
              title: `Suspend ${n} network${n === 1 ? '' : 's'}?`, confirmLabel: 'Suspend', destructive: true,
              message: 'Tracking, their dashboards, portals and API stop at once, until a Super Admin activates them again.',
              onConfirm: async () => { await go({ action: 'suspend' }); },
            })}>Suspend</button>
            <button className={btn} onClick={() => void go({ action: 'activate' })}>Activate</button>
          </>}
          {can('success', 'full') && <>
            <button className={btn} onClick={() => setAsking('account_manager')}>Account manager…</button>
            <button className={btn} onClick={() => setAsking('sales_owner')}>Seller…</button>
            <button className={btn} onClick={() => setAsking('add_tag')}>Tag…</button>
          </>}
          {can('plans', 'full') && <button className={btn} onClick={() => setAsking('plan')}>Plan…</button>}
          {can('resellers', 'full') && <button className={btn} onClick={() => setAsking('reseller')}>Reseller…</button>}
          <button className="ml-auto text-tiny text-fg-secondary hover:underline" onClick={() => { onClear(); setResult(null); }}>Clear</button>
        </div>
      )}
      {run.error && <p className="text-small text-danger-text">{run.error}</p>}
      {result && (
        <div className="text-small">
          <p className="text-success-text">Done for {result.done} network{result.done === 1 ? '' : 's'}.</p>
          {result.failed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-danger-text">
              {result.failed.map((f) => <li key={f.id}>{f.name ?? f.id}: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
      {asking && <ValueModal action={asking} count={n} onClose={() => setAsking(null)} onRun={(b) => go({ action: asking, ...b })} />}
    </div>
  );
}
