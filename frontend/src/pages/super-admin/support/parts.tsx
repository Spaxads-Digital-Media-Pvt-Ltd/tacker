/** Pieces of the Support desk: status / priority chips, the first-reply (SLA) badge, "New ticket" for a network. */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useMutation } from '../../../lib/useApi';
import { relTime } from '../../../lib/relativeTime';
import { TICKET_CATEGORIES, TICKET_PRIORITY, TICKET_STATUS, type Ticket, type TicketPriority, type TicketStatus } from '../../../lib/platformSupport';
import { useStaff } from '../../../lib/platformSales';
import { Modal, Field } from '../../../shared-components/primitives/ui';
import { SearchablePicker } from '../../../shared-components/primitives/SearchablePicker';
import { useAllNetworks } from '../useAllNetworks';
import { Chip } from '../kit';
import { StaffSelect } from '../sales/parts';

export const StatusChip = ({ status, customer = false }: { status: TicketStatus; customer?: boolean }) =>
  <Chip className={TICKET_STATUS[status].chip}>{customer ? TICKET_STATUS[status].customer : TICKET_STATUS[status].label}</Chip>;

export const PriorityChip = ({ priority }: { priority: TicketPriority }) => <Chip className={TICKET_PRIORITY[priority].chip}>{TICKET_PRIORITY[priority].label}</Chip>;

/** First reply: overdue / due in … / answered in … */
export function SlaBadge({ t }: { t: Pick<Ticket, 'first_response_at' | 'first_response_due_at' | 'created_at' | 'breached' | 'status'> }) {
  if (t.first_response_at) {
    const mins = Math.max(1, Math.round((new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 60000));
    const late = t.first_response_due_at && new Date(t.first_response_at) > new Date(t.first_response_due_at);
    return <span className={`text-tiny ${late ? 'text-warning-text' : 'text-fg-muted'}`}>answered in {mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`}{late ? ' (late)' : ''}</span>;
  }
  if (!t.first_response_due_at || t.status === 'resolved' || t.status === 'closed') return <span className="text-tiny text-fg-muted">—</span>;
  return t.breached
    ? <span className="text-tiny font-semibold text-danger-text">First reply overdue · {relTime(t.first_response_due_at)}</span>
    : <span className="text-tiny text-fg-secondary">First reply due {relTime(t.first_response_due_at)}</span>;
}

/** The team opens a ticket for a network (after a call, an email…). */
export function NewTicketModal({ networkId, onClose }: { networkId?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const networks = useAllNetworks();
  const staff = useStaff();
  const [f, setF] = useState({ networkId: networkId ?? '', subject: '', body: '', category: 'technical', priority: 'normal', requesterEmail: '', assigneeId: '' });
  const m = useMutation((b: Record<string, unknown>) => api.post<Ticket>('/platform/support/tickets', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = await m.run({
      networkId: f.networkId, subject: f.subject.trim(), body: f.body.trim(), category: f.category, priority: f.priority,
      ...(f.requesterEmail.trim() ? { requesterEmail: f.requesterEmail.trim() } : {}), assigneeId: f.assigneeId || null,
    });
    if (t) navigate(`/admin/support/${t.id}`);
  };
  return (
    <Modal open size="xl" onClose={onClose} title="New ticket for a network">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Network">
            <SearchablePicker single required ariaLabel="Network" placeholder="Choose a network…" value={f.networkId ? [f.networkId] : []}
              onChange={(v) => setF((s) => ({ ...s, networkId: v[0] ?? '' }))}
              options={(networks.data ?? []).filter((n) => n.status !== 'deleted').map((n) => ({ value: n.id, label: n.name, hint: n.slug }))} />
          </Field>
          <Field label="Their email" hint="Optional — a team member of the network"><input className="input" type="email" value={f.requesterEmail} onChange={(e) => setF((s) => ({ ...s, requesterEmail: e.target.value }))} /></Field>
          <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value }))}>{TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))}>{(Object.keys(TICKET_PRIORITY) as TicketPriority[]).map((p) => <option key={p} value={p}>{TICKET_PRIORITY[p].label}</option>)}</select></Field>
          <Field label="Assign to"><StaffSelect staff={staff.data} value={f.assigneeId} onChange={(v) => setF((s) => ({ ...s, assigneeId: v }))} noneLabel="Unassigned" /></Field>
        </div>
        <Field label="Subject"><input className="input" required maxLength={300} value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} /></Field>
        <Field label="What they need"><textarea className="input min-h-[120px]" required maxLength={20000} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !f.networkId}>{m.busy ? 'Opening…' : 'Open ticket'}</button>
        </div>
      </form>
    </Modal>
  );
}
