/**
 * The platform team's tasks (Super Admin › Tasks, a lead's page, a network's page): tick one off, see when
 * it's due (overdue in red), who has it and what it's about; add one with a due date, a priority and an
 * assignee. The API decides who may change which (its assignee or creator, or full on its section).
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { usePlatformMe } from '../../lib/platformMe';
import { relTime, isOverdue } from '../../lib/relativeTime';
import { TASK_KINDS, useStaff, fromLocalInput, type PlatformTask } from '../../lib/platformSales';
import { Modal, Field } from '../../shared-components/primitives/ui';
import { Avatar, Chip, Empty } from './kit';
import { StaffSelect } from './sales/parts';

export function TaskList({ tasks, onChanged, context = true, empty = 'Nothing to do.' }: {
  tasks: PlatformTask[]; onChanged: () => void; context?: boolean; empty?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the task'); }
  };
  return (
    <div>
      {error && <p className="px-4 py-2 text-small text-danger-text">{error}</p>}
      {tasks.length === 0 ? <Empty>{empty}</Empty> : tasks.map((t) => {
        const overdue = t.status === 'open' && isOverdue(t.due_at);
        return (
          <div key={t.id} className="group flex items-start gap-3 px-4 py-2.5 text-small">
            <input type="checkbox" className="mt-1 h-4 w-4 rounded border-border" checked={t.status === 'done'} aria-label={`Done: ${t.title}`}
              onChange={() => void act(() => api.patch(`/platform/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }))} />
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${t.status === 'done' ? 'text-fg-muted line-through' : 'text-fg'}`} title={t.notes ?? undefined}>
                {t.title}
                {t.priority === 'high' && t.status === 'open' && <Chip className="ml-2 bg-danger-bg text-danger-text">High</Chip>}
              </p>
              <p className="text-tiny text-fg-muted">
                {t.status === 'done'
                  ? <>Done {relTime(t.completed_at)}</>
                  : t.due_at ? <span className={overdue ? 'font-medium text-danger-text' : ''}>Due {relTime(t.due_at)}</span> : 'No due date'}
                {context && t.lead_id && <> · <Link to={`/admin/sales/leads/${t.lead_id}`} className="hover:underline">{t.lead_company}</Link></>}
                {context && t.network_id && <> · <Link to={`/admin/networks/${t.network_id}`} className="hover:underline">{t.network_name}</Link></>}
                {t.notes && <> · {t.notes.length > 80 ? `${t.notes.slice(0, 80)}…` : t.notes}</>}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              {t.assignee_name && <Avatar name={t.assignee_name} size="sm" />}
              <button type="button" className="text-fg-muted opacity-0 hover:text-danger-text group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${t.title}`}
                onClick={() => void act(() => api.del(`/platform/tasks/${t.id}`))}><Trash2 size={14} /></button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TaskForm({ defaults = {}, onClose, onSaved }: {
  defaults?: { kind?: PlatformTask['kind']; leadId?: string; networkId?: string; about?: string }; onClose: () => void; onSaved: () => void;
}) {
  const { me, can } = usePlatformMe();
  const staff = useStaff();
  const kinds = TASK_KINDS.filter((k) => !k.section || can(k.section, 'full'));
  const [f, setF] = useState({
    title: '', notes: '', kind: defaults.kind ?? kinds[0]?.value ?? 'other', priority: 'normal', dueAt: '', assigneeId: me?.id ?? '',
  });
  const m = useMutation((b: Record<string, unknown>) => api.post('/platform/tasks', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await m.run({
      title: f.title.trim(), notes: f.notes, kind: f.kind, priority: f.priority, dueAt: fromLocalInput(f.dueAt) ?? '',
      assigneeId: f.assigneeId || null, leadId: defaults.leadId ?? null, networkId: defaults.networkId ?? null,
    });
    if (ok) onSaved();
  };
  const quick = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0); return d; };
  const pad = (n: number) => String(n).padStart(2, '0');
  const asInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return (
    <Modal open onClose={onClose} title={defaults.about ? `New task · ${defaults.about}` : 'New task'}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <Field label="Task"><input className="input" required maxLength={300} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. Call to discuss the proposal" autoFocus /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Due">
            <input className="input" type="datetime-local" value={f.dueAt} onChange={(e) => setF((s) => ({ ...s, dueAt: e.target.value }))} />
            <div className="mt-1.5 flex gap-1.5">
              {[['Today', 0], ['Tomorrow', 1], ['In a week', 7]].map(([l, d]) => (
                <button key={l} type="button" className="rounded-full border border-border px-2 py-0.5 text-tiny text-fg-secondary hover:border-accent hover:text-fg"
                  onClick={() => setF((s) => ({ ...s, dueAt: asInput(quick(d as number)) }))}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="Assignee"><StaffSelect staff={staff.data} value={f.assigneeId} onChange={(v) => setF((s) => ({ ...s, assigneeId: v }))} /></Field>
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select>
          </Field>
          {!defaults.kind && (
            <Field label="Kind">
              <select className="input" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as PlatformTask['kind'] }))}>
                {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Notes" hint="Optional"><textarea className="input min-h-[70px]" maxLength={5000} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Adding…' : 'Add task'}</button>
        </div>
      </form>
    </Modal>
  );
}
