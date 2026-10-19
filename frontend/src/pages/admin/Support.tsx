/**
 * Help & support (the network's staff) — tickets to the platform's support team: open, awaiting your reply,
 * resolved. Open a new one (subject, what's wrong, category, how urgent); the support team answers here.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { relTime } from '../../lib/relativeTime';
import { TICKET_CATEGORIES, TICKET_STATUS, categoryLabel, type CustomerTicket } from '../../lib/platformSupport';
import { PageHeader, Modal, Field, Spinner, StateBlock, Segmented } from '../../shared-components/primitives/ui';

const PRIORITIES = [
  { value: 'low', label: 'Low — a question' }, { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High — something important isn’t working' }, { value: 'urgent', label: 'Urgent — tracking or money is affected now' },
];

export default function Support() {
  const [status, setStatus] = useState('active');
  const [opening, setOpening] = useState(false);
  const tickets = useQuery<CustomerTicket[]>('/api/support/tickets', { status, limit: 100 });
  return (
    <>
      <PageHeader title="Help & support" subtitle="Ask the platform’s support team — we answer here."
        action={<button className="btn-primary" onClick={() => setOpening(true)}>New ticket</button>} />
      <div className="mb-4 max-w-sm"><Segmented options={[{ value: 'active', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} /></div>
      {tickets.loading && !tickets.data ? <StateBlock><Spinner /></StateBlock>
        : tickets.error ? <StateBlock>{tickets.error}</StateBlock>
        : (tickets.data ?? []).length === 0 ? (
          <StateBlock>{status === 'active' ? <>No open tickets. <button className="font-medium text-accent-text hover:underline" onClick={() => setOpening(true)}>Ask a question</button>.</> : 'No tickets here.'}</StateBlock>
        ) : (
          <div className="card !p-0 divide-y divide-border">
            {(tickets.data ?? []).map((t) => (
              <Link key={t.id} to={`/app/support/${t.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-page">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{t.subject}</p>
                  <p className="truncate text-tiny text-fg-muted">#{t.number} · {categoryLabel(t.category)} · {t.last_author === 'staff' ? `${t.agent_name ?? 'Support'}: ` : ''}{t.last_message ?? ''}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold ${TICKET_STATUS[t.status].chip}`}>{TICKET_STATUS[t.status].customer}</span>
                  <p className="mt-1 text-tiny text-fg-muted">{relTime(t.updated_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      {opening && <NewTicket onClose={() => setOpening(false)} />}
    </>
  );
}

function NewTicket({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ subject: '', body: '', category: 'technical', priority: 'normal' });
  const m = useMutation((b: typeof f) => api.post<CustomerTicket>('/api/support/tickets', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = await m.run({ ...f, subject: f.subject.trim(), body: f.body.trim() });
    if (t) navigate(`/app/support/${t.id}`);
  };
  return (
    <Modal open size="xl" onClose={onClose} title="New support ticket">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <Field label="Subject"><input className="input" required maxLength={300} value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} placeholder="e.g. Conversions from Offer 123 aren’t recorded" autoFocus /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="About"><select className="input" value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value }))}>{TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label="How urgent"><select className="input" value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
        </div>
        <Field label="What’s happening?" hint="Steps, offer / partner IDs, click IDs, what you expected"><textarea className="input min-h-[160px]" required maxLength={20000} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Sending…' : 'Send to support'}</button>
        </div>
      </form>
    </Modal>
  );
}
