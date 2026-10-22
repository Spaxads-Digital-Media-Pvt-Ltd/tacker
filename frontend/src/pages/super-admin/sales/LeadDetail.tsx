/**
 * Super Admin › Sales › a lead: the stage bar (click a stage to move it; Lost asks why), the deal and the
 * contact, its owner, its timeline (log a note, call, email or meeting — stage, owner and conversion are
 * recorded on their own), its tasks, its quotes (QuoteParts.tsx), and "Convert to customer" (a network + owner
 * login + plan/trial).
 */
import { useState, type FormEvent, type ElementType } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRightLeft, Building2, CalendarClock, CheckCircle2, FileText, Globe, Inbox, Mail, MessageSquare, Phone, Sparkles, UserRound, Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { money } from '../../../lib/platformBilling';
import { relTime, isOverdue } from '../../../lib/relativeTime';
import { OPEN_STAGES, stageOf, sourceLabel, useStaff, type Lead, type LeadActivity, type PlatformTask, type Quote, type Stage } from '../../../lib/platformSales';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Avatar, Panel } from '../kit';
import { TaskList, TaskForm } from '../TaskList';
import { StageChip, StaffSelect, LostReasonModal, WonChoice } from './parts';
import { LeadForm } from './LeadForm';
import { ConvertLead } from './ConvertLead';
import { QuoteForm, QuoteList, QuoteModal } from './QuoteParts';

type Detail = Lead & { activities: LeadActivity[]; tasks: PlatformTask[] };

const KIND: Record<LeadActivity['kind'], { icon: ElementType; label: string }> = {
  note: { icon: MessageSquare, label: 'Note' }, call: { icon: Phone, label: 'Call' }, email: { icon: Mail, label: 'Email' },
  meeting: { icon: Users, label: 'Meeting' }, stage: { icon: ArrowRightLeft, label: 'Stage' }, owner: { icon: UserRound, label: 'Owner' },
  created: { icon: Sparkles, label: 'Created' }, converted: { icon: Building2, label: 'Converted' }, inbound: { icon: Inbox, label: 'Demo request' },
  task: { icon: CheckCircle2, label: 'Task done' }, quote: { icon: FileText, label: 'Quote' },
};

function describe(a: LeadActivity): string {
  const m = a.meta as Record<string, string | number | null | boolean>;
  switch (a.kind) {
    case 'stage': return `moved it from ${stageOf(String(m['from'])).label} to ${stageOf(String(m['to'])).label}${a.body ? ` — ${a.body}` : ''}`;
    case 'owner': return `handed it from ${m['from'] ?? 'nobody'} to ${m['to'] ?? 'nobody'}`;
    case 'created': return 'added the lead';
    case 'converted': return `converted it into the network ${m['networkName']}${m['plan'] ? ` on ${m['plan']}` : ''}${m['trialDays'] ? ` (${m['trialDays']}-day trial)` : ''}`;
    case 'inbound': return m['again'] ? 'asked for a demo again on the website' : 'asked for a demo on the website';
    case 'task': return 'completed a task';
    case 'quote': return m['event'] === 'sent' ? `sent quote Q-${m['number']} to ${m['to']}` : `${m['event'] === 'accepted' ? 'accepted' : 'declined'} quote Q-${m['number']}`;
    default: return `logged a ${KIND[a.kind].label.toLowerCase()}`;
  }
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = usePlatformMe();
  const canEdit = can('sales', 'full');
  const lead = useQuery<Detail>(`/platform/sales/leads/${id}`);
  const staff = useStaff();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [losing, setLosing] = useState(false);
  const [winning, setWinning] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const quotes = useQuery<Quote[]>(`/platform/sales/quotes?leadId=${id}`);
  const [quoting, setQuoting] = useState(false);
  const [openQuote, setOpenQuote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'note' | 'call' | 'email' | 'meeting'>('note');
  const [body, setBody] = useState('');
  const log = useMutation((b: { kind: string; body: string }) => api.post(`/platform/sales/leads/${id}/activities`, b));

  if (lead.loading && !lead.data) return <StateBlock><Spinner /></StateBlock>;
  if (lead.error || !lead.data) return <StateBlock>{lead.error ?? 'Lead not found'}</StateBlock>;
  const l = lead.data;
  const closed = l.stage === 'won' || l.stage === 'lost';

  const patch = async (b: Record<string, unknown>): Promise<string | null> => {
    setError(null);
    try { await api.patch(`/platform/sales/leads/${l.id}`, b); lead.refetch(); return null; }
    catch (e) { const msg = e instanceof Error ? e.message : 'Could not update the lead'; setError(msg); return msg; }
  };
  const submitLog = async (e: FormEvent) => {
    e.preventDefault();
    if (await log.run({ kind, body: body.trim() })) { setBody(''); lead.refetch(); }
  };
  const remove = () => confirm({
    title: `Delete ${l.company}?`, confirmLabel: 'Delete', destructive: true, message: 'The lead, its timeline and its tasks are deleted for good.',
    onConfirm: async () => { await api.del(`/platform/sales/leads/${l.id}`); navigate('/admin/sales/leads'); },
  });

  return (
    <>
      <PageHeader title={l.company} subtitle={[l.contact_name, sourceLabel(l.source), `added ${relTime(l.created_at)}`].filter(Boolean).join(' · ')}
        action={canEdit ? <>
          {!l.network_id && <button className="btn-ghost text-danger-text" onClick={remove}>Delete</button>}
          <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>
          {!l.network_id && l.stage !== 'lost' && <button className="btn-primary" onClick={() => setConverting(true)}>Convert to customer</button>}
        </> : undefined} />

      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {l.network_id && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-success-bg bg-success-bg px-4 py-3 text-small text-success-text">
          <span>Won {relTime(l.won_at)} — it’s the network <strong>{l.network_name}</strong>.</span>
          {can('networks') && <Link to={`/admin/networks/${l.network_id}`} className="font-medium underline">Open the network</Link>}
        </div>
      )}
      {l.stage === 'lost' && (
        <div className="mb-4 rounded-card border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text">
          Lost {relTime(l.lost_at)}{l.lost_reason ? ` — ${l.lost_reason}` : ''}. {canEdit && <button className="font-medium underline" onClick={() => void patch({ stage: 'qualified' })}>Reopen</button>}
        </div>
      )}

      {/* Stage bar */}
      <div className="card mb-4 !p-2">
        <div className="flex flex-wrap gap-1">
          {OPEN_STAGES.map((s, i) => {
            const at = OPEN_STAGES.indexOf(l.stage as Stage);
            const done = l.stage === 'won' || (at >= 0 && i < at);
            const current = l.stage === s;
            return (
              <button key={s} type="button" disabled={!canEdit || !!l.network_id || current}
                onClick={() => void patch({ stage: s })}
                className={`flex-1 rounded-[var(--radius)] px-3 py-2 text-small font-medium transition-colors disabled:cursor-default ${current ? 'bg-accent text-white' : done ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page enabled:hover:text-fg'}`}>
                {stageOf(s).label}
              </button>
            );
          })}
          <button type="button" disabled={!canEdit || l.stage === 'won'} onClick={() => setWinning(true)}
            className={`rounded-[var(--radius)] px-3 py-2 text-small font-medium ${l.stage === 'won' ? 'bg-success text-white' : 'text-success-text hover:bg-success-bg'} disabled:cursor-default`}>Won</button>
          <button type="button" disabled={!canEdit || l.stage === 'lost' || !!l.network_id} onClick={() => setLosing(true)}
            className={`rounded-[var(--radius)] px-3 py-2 text-small font-medium ${l.stage === 'lost' ? 'bg-danger text-white' : 'text-danger-text hover:bg-danger-bg'} disabled:cursor-default`}>Lost</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {l.message && (
            <Panel title="Their message">
              <p className="whitespace-pre-wrap px-4 py-3 text-small text-fg">{l.message}</p>
            </Panel>
          )}
          <Panel title="Timeline">
            {canEdit && (
              <form onSubmit={submitLog} className="space-y-2 px-4 py-3">
                <div className="flex gap-1">
                  {(['note', 'call', 'email', 'meeting'] as const).map((k) => {
                    const Icon = KIND[k].icon;
                    return (
                      <button key={k} type="button" onClick={() => setKind(k)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-tiny font-medium ${kind === k ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
                        <Icon size={13} />{KIND[k].label}
                      </button>
                    );
                  })}
                </div>
                <textarea className="input min-h-[70px]" maxLength={5000} required value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder={kind === 'note' ? 'Add a note…' : kind === 'call' ? 'What was said on the call?' : kind === 'email' ? 'What did you send or receive?' : 'Who met, and what was agreed?'} />
                <div className="flex items-center justify-between">
                  {log.error ? <p className="text-small text-danger-text">{log.error}</p> : <span />}
                  <button type="submit" className="btn-primary" disabled={log.busy || !body.trim()}>{log.busy ? 'Saving…' : `Log ${KIND[kind].label.toLowerCase()}`}</button>
                </div>
              </form>
            )}
            {l.activities.map((a) => {
              const Icon = KIND[a.kind].icon;
              const logged = ['note', 'call', 'email', 'meeting'].includes(a.kind);
              return (
                <div key={a.id} className="flex gap-3 px-4 py-3 text-small">
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${logged ? 'bg-accent-subtle text-accent-text' : 'bg-page text-fg-secondary'}`}><Icon size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-fg-secondary"><span className="font-medium text-fg">{a.actor_name ?? (a.kind === 'inbound' ? l.contact_name ?? 'The contact' : a.kind === 'quote' ? String(a.meta['by'] ?? l.contact_name ?? 'The prospect') : 'System')}</span> {describe(a)}
                      <span className="ml-2 text-tiny text-fg-muted" title={new Date(a.created_at).toLocaleString()}>{relTime(a.created_at)}</span></p>
                    {a.body && a.kind !== 'stage' && <p className="mt-1 whitespace-pre-wrap text-fg">{a.body}</p>}
                  </div>
                </div>
              );
            })}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Deal">
            <dl className="space-y-3 px-4 py-3 text-small">
              <div className="flex items-center justify-between gap-3"><dt className="text-fg-secondary">Stage</dt><dd><StageChip stage={l.stage} /></dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-fg-secondary">Owner</dt>
                <dd className="min-w-0">{canEdit
                  ? <StaffSelect staff={staff.data} value={l.owner_id ?? ''} onChange={(v) => void patch({ ownerId: v || null })} className="input !py-1 text-small" ariaLabel="Owner" />
                  : l.owner_name ? <span className="inline-flex items-center gap-2"><Avatar name={l.owner_name} size="sm" />{l.owner_name}</span> : 'Unassigned'}</dd>
              </div>
              <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Value</dt><dd className="font-medium text-fg">{l.expected_mrr ? `${money(l.expected_mrr, l.currency)} / mo` : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Likely plan</dt><dd className="text-fg">{l.plan_name ?? '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Monthly clicks</dt><dd className="text-fg">{l.monthly_clicks != null ? l.monthly_clicks.toLocaleString() : '—'}</dd></div>
              {!closed && (
                <div>
                  <dt className="text-fg-secondary">Next step</dt>
                  <dd className="mt-0.5 text-fg">{l.next_step ?? '—'}
                    {l.next_step_at && <span className={`ml-1 inline-flex items-center gap-1 text-tiny ${isOverdue(l.next_step_at) ? 'font-medium text-danger-text' : 'text-fg-muted'}`}><CalendarClock size={12} />{relTime(l.next_step_at)}</span>}
                  </dd>
                </div>
              )}
              {l.tags.length > 0 && <div className="flex flex-wrap gap-1">{l.tags.map((t) => <span key={t} className="rounded-full bg-page px-2 py-0.5 text-tiny text-fg-secondary ring-1 ring-inset ring-border">{t}</span>)}</div>}
            </dl>
          </Panel>
          <Panel title="Quotes" action={canEdit ? <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setQuoting(true)}>New quote</button> : undefined}>
            <QuoteList quotes={quotes.data ?? []} onOpen={(q) => setOpenQuote(q.id)} empty="No quotes yet." />
          </Panel>
          <Panel title="Contact">
            <div className="space-y-2 px-4 py-3 text-small">
              <p className="font-medium text-fg">{l.contact_name ?? '—'}</p>
              {l.email && <a href={`mailto:${l.email}`} className="flex items-center gap-2 text-accent-text hover:underline"><Mail size={14} />{l.email}</a>}
              {l.phone && <a href={`tel:${l.phone}`} className="flex items-center gap-2 text-accent-text hover:underline"><Phone size={14} />{l.phone}</a>}
              {l.website && <a href={/^https?:\/\//.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-accent-text hover:underline"><Globe size={14} />{l.website}</a>}
              {l.country && <p className="text-fg-secondary">{l.country}</p>}
              {l.notes && <p className="whitespace-pre-wrap border-t border-border pt-2 text-fg">{l.notes}</p>}
            </div>
          </Panel>
          <Panel title="Tasks" action={canEdit ? <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setAddingTask(true)}>Add task</button> : undefined}>
            <TaskList tasks={l.tasks} onChanged={lead.refetch} context={false} empty="No tasks for this lead." />
          </Panel>
        </div>
      </div>

      {editing && <LeadForm lead={l} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); lead.refetch(); }} />}
      {converting && <ConvertLead lead={l} onClose={() => { setConverting(false); lead.refetch(); }} onDone={lead.refetch} />}
      {winning && <WonChoice company={l.company} onClose={() => setWinning(false)}
        onJustWon={() => { setWinning(false); void patch({ stage: 'won' }); }} onConvert={() => { setWinning(false); setConverting(true); }} />}
      {losing && <LostReasonModal company={l.company} onClose={() => setLosing(false)} onSubmit={async (reason) => { const err = await patch({ stage: 'lost', lostReason: reason }); if (!err) setLosing(false); return err; }} />}
      {quoting && <QuoteForm lead={l} onClose={() => setQuoting(false)} onSaved={(q) => { setQuoting(false); quotes.refetch(); setOpenQuote(q.id); }} />}
      {openQuote && <QuoteModal key={openQuote} id={openQuote} lead={l} canEdit={canEdit} onClose={() => setOpenQuote(null)}
        onChanged={(next) => { quotes.refetch(); lead.refetch(); if (next) setOpenQuote(next); }} />}
      {addingTask && <TaskForm defaults={{ kind: 'sales', leadId: l.id, about: l.company }} onClose={() => setAddingTask(false)} onSaved={() => { setAddingTask(false); lead.refetch(); }} />}
    </>
  );
}
