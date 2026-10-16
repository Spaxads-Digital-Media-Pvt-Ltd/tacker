/** Super Admin › Settings › Support — first-reply targets per priority (the SLA), auto-close, auto-assignment. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { TICKET_PRIORITY, type TicketPriority } from '../../../lib/platformSupport';
import { Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';

interface S { firstResponseHours: Record<TicketPriority, number>; autoCloseDays: number; autoAssign: boolean }
const ORDER: TicketPriority[] = ['urgent', 'high', 'normal', 'low'];

export function SupportSettings() {
  const canEdit = usePlatformMe().can('settings', 'full');
  const current = useQuery<S>('/platform/settings/support');
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [auto, setAuto] = useState(true);
  const [saved, setSaved] = useState(false);
  const m = useMutation((b: S) => api.put<S>('/platform/settings/support', b));
  useEffect(() => {
    if (!current.data) return;
    setF({ ...Object.fromEntries(ORDER.map((p) => [p, String(current.data!.firstResponseHours[p])])), autoCloseDays: String(current.data.autoCloseDays) });
    setAuto(current.data.autoAssign);
  }, [current.data]);
  if (current.loading || (!f && !current.error)) return <StateBlock><Spinner /></StateBlock>;
  if (current.error || !f) return <StateBlock>{current.error ?? 'Could not load the support settings'}</StateBlock>;
  const set = (k: string, v: string) => { setSaved(false); setF((s) => (s ? { ...s, [k]: v.replace(/\D/g, '').slice(0, 3) } : s)); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await m.run({ firstResponseHours: Object.fromEntries(ORDER.map((p) => [p, Number(f[p])])) as Record<TicketPriority, number>, autoCloseDays: Number(f['autoCloseDays']), autoAssign: auto });
    if (out) setSaved(true);
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        {saved && <p className="text-small text-success-text">Saved — new tickets use these targets.</p>}
        <div className="card space-y-4">
          <h3 className="text-h3 font-medium text-fg">First reply within (hours)</h3>
          <p className="text-small text-fg-secondary">Each new ticket gets a first-reply deadline from its priority. Past it, the ticket shows as overdue in the queue.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ORDER.map((p) => <Field key={p} label={TICKET_PRIORITY[p].label}><input className="input" inputMode="numeric" required value={f[p]} onChange={(e) => set(p, e.target.value)} /></Field>)}
          </div>
        </div>
        <div className="card space-y-4">
          <h3 className="text-h3 font-medium text-fg">Assignment &amp; closing</h3>
          <label className="flex items-start gap-3 text-small text-fg">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={auto} onChange={(e) => { setSaved(false); setAuto(e.target.checked); }} />
            <span>Assign new tickets automatically — to the Support member with the fewest open tickets.</span>
          </label>
          <Field label="Close resolved tickets after (days)" hint="If the customer doesn’t reply or reopen it"><input className="input max-w-[8rem]" inputMode="numeric" required value={f['autoCloseDays']} onChange={(e) => set('autoCloseDays', e.target.value)} /></Field>
        </div>
        {canEdit && <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Save support settings'}</button></div>}
      </fieldset>
    </form>
  );
}
