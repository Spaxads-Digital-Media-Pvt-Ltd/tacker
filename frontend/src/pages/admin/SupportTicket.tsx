/**
 * Help & support › a ticket (the network's staff): the conversation with the platform's support team, a reply
 * box (a reply sends it back to them), "This solved it" / reopen, and a 1–5 rating once it's resolved.
 */
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { relTime } from '../../lib/relativeTime';
import { TICKET_STATUS, categoryLabel, type CustomerTicket } from '../../lib/platformSupport';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';

export default function SupportTicket() {
  const { id = '' } = useParams<{ id: string }>();
  const t = useQuery<CustomerTicket>(`/api/support/tickets/${id}`);
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reply = useMutation((b: { body: string }) => api.post(`/api/support/tickets/${id}/messages`, b));
  if (t.loading && !t.data) return <StateBlock><Spinner /></StateBlock>;
  if (t.error || !t.data) return <StateBlock>{t.error ?? 'Ticket not found'}</StateBlock>;
  const tk = t.data;
  const act = async (path: string, b: Record<string, unknown> = {}) => {
    setError(null);
    try { await api.post(`/api/support/tickets/${id}/${path}`, b); t.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the ticket'); }
  };
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await reply.run({ body: body.trim() })) { setBody(''); t.refetch(); } };
  const done = tk.status === 'resolved' || tk.status === 'closed';

  return (
    <>
      <PageHeader title={tk.subject} subtitle={`#${tk.number} · ${categoryLabel(tk.category)} · opened ${relTime(tk.created_at)}`}
        action={<Link to="/app/support" className="btn-ghost">All tickets</Link>} />
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold ${TICKET_STATUS[tk.status].chip}`}>{TICKET_STATUS[tk.status].customer}</span>
          <span className="flex gap-2">
            {!done && <button className="btn-ghost" onClick={() => void act('resolve')}>This solved it</button>}
            {tk.status === 'resolved' && <button className="btn-ghost" onClick={() => void act('reopen')}>Reopen</button>}
          </span>
        </div>
        {error && <p className="text-small text-danger-text">{error}</p>}
        <div className="card space-y-3">
          {(tk.messages ?? []).map((m) => m.author_kind === 'system'
            ? <p key={m.id} className="text-center text-tiny text-fg-muted">{m.body} · {relTime(m.created_at)}</p>
            : (
              <div key={m.id} className={`flex ${m.author_kind === 'staff' ? '' : 'flex-row-reverse'}`}>
                <div className={`max-w-[85%] rounded-[var(--radius)] px-3 py-2 text-small ${m.author_kind === 'staff' ? 'bg-accent-subtle' : 'bg-page ring-1 ring-inset ring-border'}`}>
                  <p className="mb-1 text-tiny text-fg-secondary"><span className="font-medium text-fg">{m.author_kind === 'staff' ? `${m.author_name ?? 'Support'} · Support` : m.author_name ?? 'You'}</span> · {new Date(m.created_at).toLocaleString()}</p>
                  <p className="whitespace-pre-wrap text-fg">{m.body}</p>
                </div>
              </div>
            ))}
        </div>
        {tk.status !== 'closed' ? (
          <form onSubmit={submit} className="card space-y-2">
            <textarea className="input min-h-[100px]" maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={tk.status === 'pending' ? 'Reply to support…' : 'Add more detail…'} />
            <div className="flex items-center justify-between">
              {reply.error ? <p className="text-small text-danger-text">{reply.error}</p> : <span />}
              <button type="submit" className="btn-primary" disabled={reply.busy || !body.trim()}>{reply.busy ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        ) : <p className="text-center text-small text-fg-secondary">This ticket is closed. <Link to="/app/support" className="font-medium text-accent-text hover:underline">Open a new one</Link> if you still need help.</p>}
        {done && (
          <div className="card space-y-2">
            {tk.satisfaction ? (
              <p className="text-small text-fg">You rated this {'★'.repeat(tk.satisfaction)}{'☆'.repeat(5 - tk.satisfaction)} — thank you.</p>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (rating) void act('rate', { satisfaction: rating, ...(comment.trim() ? { comment: comment.trim() } : {}) }); }} className="space-y-2">
                <p className="text-small font-medium text-fg">How did we do?</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}
                      className={`text-2xl leading-none ${n <= rating ? 'text-warning' : 'text-fg-muted hover:text-warning'}`}>★</button>
                  ))}
                </div>
                <input className="input" maxLength={2000} placeholder="Anything to add? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button type="submit" className="btn-primary" disabled={!rating}>Send rating</button>
              </form>
            )}
          </div>
        )}
      </div>
    </>
  );
}
