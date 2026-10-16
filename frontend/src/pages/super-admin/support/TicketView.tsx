/**
 * Super Admin › Support › a ticket: the conversation (the customer, the team, internal notes only the team
 * sees, status changes), the reply box (reply or internal note, a saved reply, send — waits on the customer —
 * or send & resolve), and the ticket's properties (status, priority, category, assignee, tags), its first-reply
 * deadline, the network (plan, health, account manager) and its other tickets.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { useStaff } from '../../../lib/platformSales';
import { useSupportSession } from '../../../lib/impersonation';
import { TICKET_CATEGORIES, TICKET_PRIORITY, TICKET_STATUS, categoryLabel, type Macro, type TicketDetail, type TicketPriority, type TicketStatus } from '../../../lib/platformSupport';
import { PageHeader, Segmented, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Avatar, Panel } from '../kit';
import { StaffSelect } from '../sales/parts';
import { HealthChip } from '../success/parts';
import { PriorityChip, SlaBadge, StatusChip } from './parts';

export default function TicketView() {
  const { id = '' } = useParams<{ id: string }>();
  const { can } = usePlatformMe();
  const canEdit = can('support', 'full');
  const ticket = useQuery<TicketDetail>(`/platform/support/tickets/${id}`);
  const macros = useQuery<Macro[]>(canEdit ? '/platform/support/macros' : null);
  const staff = useStaff();
  const support = useSupportSession();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const [macroId, setMacroId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation((b: Record<string, unknown>) => api.post(`/platform/support/tickets/${id}/messages`, b));
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [ticket.data?.messages.length]);

  if (ticket.loading && !ticket.data) return <StateBlock><Spinner /></StateBlock>;
  if (ticket.error || !ticket.data) return <StateBlock>{ticket.error ?? 'Ticket not found'}</StateBlock>;
  const t = ticket.data;

  const patch = async (b: Record<string, unknown>) => {
    setError(null);
    try { await api.patch(`/platform/support/tickets/${t.id}`, b); ticket.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the ticket'); }
  };
  const submit = (status?: TicketStatus) => async (e?: FormEvent) => {
    e?.preventDefault();
    if (!body.trim()) return;
    const ok = await send.run({ body: body.trim(), internal: mode === 'note', ...(status ? { status } : {}), ...(macroId ? { macroId } : {}) });
    if (ok) { setBody(''); setMacroId(null); ticket.refetch(); }
  };
  const insertMacro = (mid: string) => {
    const m = (macros.data ?? []).find((x) => x.id === mid);
    if (!m) return;
    setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${m.body}` : m.body));
    setMacroId(m.id);
  };

  return (
    <>
      <PageHeader title={t.subject} subtitle={`#${t.number} · ${t.network_name} · ${categoryLabel(t.category)} · opened ${relTime(t.created_at)}`}
        action={<Link to="/admin/support" className="btn-ghost">All tickets</Link>} />
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="card !p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <StatusChip status={t.status} /><PriorityChip priority={t.priority} /><SlaBadge t={t} />
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
              {t.messages.map((m) => {
                if (m.author_kind === 'system') {
                  return <p key={m.id} className="text-center text-tiny text-fg-muted">{m.body} · {relTime(m.created_at)}</p>;
                }
                if (m.internal) {
                  return (
                    <div key={m.id} className="rounded-[var(--radius)] border border-warning-bg bg-warning-bg/60 px-3 py-2 text-small">
                      <p className="mb-1 flex items-center gap-1.5 text-tiny font-semibold text-warning-text"><Lock size={12} />Internal note · {m.author_name ?? 'Team'} · {relTime(m.created_at)}</p>
                      <p className="whitespace-pre-wrap text-fg">{m.body}</p>
                    </div>
                  );
                }
                const staffMsg = m.author_kind === 'staff';
                return (
                  <div key={m.id} className={`flex gap-2.5 ${staffMsg ? 'flex-row-reverse' : ''}`}>
                    <Avatar name={m.author_name ?? (staffMsg ? 'Support' : 'Customer')} size="sm" />
                    <div className={`max-w-[85%] rounded-[var(--radius)] px-3 py-2 text-small ${staffMsg ? 'bg-accent-subtle' : 'bg-page ring-1 ring-inset ring-border'}`}>
                      <p className="mb-1 text-tiny text-fg-secondary"><span className="font-medium text-fg">{m.author_name ?? (staffMsg ? 'Support' : 'Customer')}</span> · {new Date(m.created_at).toLocaleString()}</p>
                      <p className="whitespace-pre-wrap text-fg">{m.body}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={end} />
            </div>
            {canEdit && t.status !== 'closed' && (
              <form onSubmit={submit()} className="space-y-2 border-t border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Segmented className="max-w-xs" options={[{ value: 'reply', label: 'Reply' }, { value: 'note', label: 'Internal note' }]} value={mode} onChange={(v) => setMode(v as 'reply' | 'note')} />
                  {(macros.data ?? []).length > 0 && (
                    <select className="input !w-auto !py-1.5 text-small" value="" onChange={(e) => insertMacro(e.target.value)} aria-label="Saved reply">
                      <option value="">Insert a saved reply…</option>
                      {(macros.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                  )}
                </div>
                <textarea className={`input min-h-[110px] ${mode === 'note' ? 'bg-warning-bg/40' : ''}`} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder={mode === 'note' ? 'Only the team sees this…' : `Reply to ${t.requester_name ?? t.network_name}…`} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {send.error ? <p className="text-small text-danger-text">{send.error}</p> : <span className="text-tiny text-fg-muted">{mode === 'reply' ? 'Sending waits on the customer.' : 'The customer never sees notes.'}</span>}
                  <div className="flex gap-2">
                    {mode === 'reply' && <button type="button" className="btn-ghost" disabled={send.busy || !body.trim()} onClick={() => void submit('resolved')()}>Send &amp; resolve</button>}
                    <button type="submit" className="btn-primary" disabled={send.busy || !body.trim()}>{send.busy ? 'Sending…' : mode === 'reply' ? 'Send reply' : 'Add note'}</button>
                  </div>
                </div>
              </form>
            )}
            {t.status === 'closed' && <p className="border-t border-border px-4 py-3 text-small text-fg-secondary">Closed {relTime(t.closed_at)}. {canEdit && <button className="font-medium text-accent-text hover:underline" onClick={() => void patch({ status: 'open' })}>Reopen</button>}</p>}
          </div>
        </div>

        <div className="space-y-4">
          <Panel title="Ticket">
            <div className="space-y-3 px-4 py-3 text-small">
              {([
                ['Status', <select key="s" className="input !py-1 text-small" disabled={!canEdit} value={t.status} onChange={(e) => void patch({ status: e.target.value })}>
                  {(Object.keys(TICKET_STATUS) as TicketStatus[]).map((s) => <option key={s} value={s}>{TICKET_STATUS[s].label}</option>)}</select>],
                ['Priority', <select key="p" className="input !py-1 text-small" disabled={!canEdit} value={t.priority} onChange={(e) => void patch({ priority: e.target.value })}>
                  {(Object.keys(TICKET_PRIORITY) as TicketPriority[]).map((p) => <option key={p} value={p}>{TICKET_PRIORITY[p].label}</option>)}</select>],
                ['Category', <select key="c" className="input !py-1 text-small" disabled={!canEdit} value={t.category} onChange={(e) => void patch({ category: e.target.value })}>
                  {TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>],
                ['Assignee', <StaffSelect key="a" staff={staff.data} value={t.assignee_id ?? ''} onChange={(v) => void patch({ assigneeId: v || null })} className="input !py-1 text-small" disabled={!canEdit} ariaLabel="Assignee" />],
              ] as const).map(([label, control]) => (
                <div key={label} className="grid grid-cols-[6rem,1fr] items-center gap-2"><span className="text-fg-secondary">{label}</span>{control}</div>
              ))}
              <div className="grid grid-cols-[6rem,1fr] items-start gap-2">
                <span className="pt-1 text-fg-secondary">Tags</span>
                <div>
                  <div className="flex flex-wrap gap-1">
                    {t.tags.map((x) => <span key={x} className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-tiny ring-1 ring-inset ring-border">{x}{canEdit && <button type="button" aria-label={`Remove ${x}`} className="text-fg-muted hover:text-danger-text" onClick={() => void patch({ tags: t.tags.filter((y) => y !== x) })}>×</button>}</span>)}
                  </div>
                  {canEdit && <form className="mt-1.5" onSubmit={(e) => { e.preventDefault(); const v = tagInput.trim(); if (v) void patch({ tags: [...t.tags, v] }); setTagInput(''); }}>
                    <input className="input !py-1 text-small" placeholder="Add a tag…" maxLength={40} value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
                  </form>}
                </div>
              </div>
              <div className="border-t border-border pt-2 text-tiny text-fg-muted">
                <p>Requester: <span className="text-fg">{t.requester_name ?? '—'}</span>{t.requester_email && <> · <a href={`mailto:${t.requester_email}`} className="hover:underline">{t.requester_email}</a></>}</p>
                <p>First reply due: {t.first_response_due_at ? new Date(t.first_response_due_at).toLocaleString() : '—'}</p>
                {t.satisfaction && <p className="mt-1 text-small text-fg">Rated {'★'.repeat(t.satisfaction)}{'☆'.repeat(5 - t.satisfaction)}{t.satisfaction_comment ? ` — “${t.satisfaction_comment}”` : ''}</p>}
              </div>
            </div>
          </Panel>
          <Panel title="Network" to={can('networks') ? `/admin/networks/${t.network.id}` : undefined} linkLabel="Open">
            <div className="space-y-2 px-4 py-3 text-small">
              <p className="font-medium text-fg">{t.network.name} <span className="font-mono text-tiny text-fg-muted">{t.network.slug}</span></p>
              <p className="text-fg-secondary">{t.network.plan_name ?? 'No plan'}{t.network.subscription_status ? ` · ${t.network.subscription_status.replace('_', ' ')}` : ''}{t.network.status !== 'active' ? ` · ${t.network.status}` : ''}</p>
              <HealthChip score={t.network.health_score} status={t.network.health_status} />
              <p className="text-tiny text-fg-muted">Account manager: {t.network.account_manager_name ?? 'none'} · Owner: {t.network.owner_email ?? '—'}</p>
              {can('access', 'full') && t.network.status === 'active' && (
                <button className="btn-ghost w-full" disabled={support.busy} onClick={() => void support.start(t.network.id)}>{support.busy ? 'Opening…' : 'Open their dashboard'}</button>
              )}
              {support.error && <p className="text-tiny text-danger-text">{support.error}</p>}
            </div>
          </Panel>
          <Panel title="Their other tickets">
            {t.otherTickets.length === 0 ? <p className="px-4 py-3 text-small text-fg-secondary">None.</p> : t.otherTickets.map((o) => (
              <Link key={o.id} to={`/admin/support/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small hover:bg-page">
                <span className="min-w-0 truncate text-fg">#{o.number} {o.subject}</span><StatusChip status={o.status} />
              </Link>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
