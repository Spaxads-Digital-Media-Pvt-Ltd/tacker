/**
 * Super Admin › Sales › Pipeline — the kanban: a column per stage with its deal count and value, every open
 * lead as a card (and the last 30 days' won / lost). Drag a card to move it: into Lost asks why; into Won
 * offers "Convert to customer". A converted lead stays won.
 */
import { useEffect, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ListChecks } from 'lucide-react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useDebounced } from '../../admin/pagedList';
import { money } from '../../../lib/platformBilling';
import { relTime, isOverdue } from '../../../lib/relativeTime';
import { stageOf, useStaff, type Lead, type PipelineColumn, type Stage } from '../../../lib/platformSales';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Avatar } from '../kit';
import { LostReasonModal, WonChoice } from './parts';
import { LeadForm } from './LeadForm';
import { ConvertLead } from './ConvertLead';

export default function Pipeline() {
  const { can } = usePlatformMe();
  const canEdit = can('sales', 'full');
  const staff = useStaff();
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 300);
  const board = useQuery<PipelineColumn[]>('/platform/sales/pipeline', { owner: owner || undefined, q: search || undefined });
  const [columns, setColumns] = useState<PipelineColumn[] | null>(null);
  useEffect(() => { if (board.data) setColumns(board.data); }, [board.data]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [losing, setLosing] = useState<Lead | null>(null);
  const [winning, setWinning] = useState<Lead | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [adding, setAdding] = useState<Stage | null>(null);

  const find = (id: string) => columns?.flatMap((c) => c.leads).find((l) => l.id === id) ?? null;
  /** Optimistic move, then the API; a refusal puts it back and says why. */
  const move = async (lead: Lead, stage: Stage, lostReason?: string): Promise<string | null> => {
    setError(null);
    const before = columns;
    setColumns((cols) => cols?.map((c) => ({
      ...c,
      leads: c.stage === stage ? [{ ...lead, stage }, ...c.leads.filter((l) => l.id !== lead.id)] : c.leads.filter((l) => l.id !== lead.id),
      count: c.count + (c.stage === stage ? 1 : 0) - (c.stage === lead.stage ? 1 : 0),
    })) ?? null);
    try {
      await api.patch(`/platform/sales/leads/${lead.id}`, { stage, ...(lostReason ? { lostReason } : {}) });
      board.refetch();
      return null;
    } catch (e) {
      setColumns(before);
      const msg = e instanceof Error ? e.message : 'Could not move the lead';
      setError(msg);
      return msg;
    }
  };
  const drop = (stage: Stage) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const lead = find(e.dataTransfer.getData('text/plain'));
    setDragging(null);
    if (!lead || lead.stage === stage) return;
    if (stage === 'lost') setLosing(lead);
    else if (stage === 'won') setWinning(lead);
    else void move(lead, stage);
  };

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Every open deal by stage — drag a card to move it."
        action={canEdit ? <button className="btn-primary" onClick={() => setAdding('new')}>New lead</button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search company, contact or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Everyone’s deals</option>
          <option value="me">My deals</option>
          <option value="unassigned">Unassigned</option>
          {(staff.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
        </select>
      </div>
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {!columns ? (board.error ? <StateBlock>{board.error}</StateBlock> : <StateBlock><Spinner /></StateBlock>) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
          {columns.map((col) => {
            const s = stageOf(col.stage);
            const closed = col.stage === 'won' || col.stage === 'lost';
            return (
              <div key={col.stage}
                className={`flex w-[12.5rem] shrink-0 flex-col rounded-card border bg-page/60 transition-colors ${over === col.stage ? 'border-accent bg-accent-subtle/40' : 'border-border'}`}
                onDragOver={(e) => { if (canEdit && dragging) { e.preventDefault(); setOver(col.stage); } }}
                onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
                onDrop={drop(col.stage)}>
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-small font-semibold text-fg"><span className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}</span>
                    <span className="rounded-full bg-elevated px-2 text-tiny font-medium text-fg-secondary ring-1 ring-inset ring-border">{col.count}</span>
                  </div>
                  <p className="mt-0.5 truncate text-tiny text-fg-muted">
                    {col.mrr.length ? col.mrr.map((m) => money(m.amount, m.currency)).join(' · ') : 'No value yet'}{closed ? ' · last 30 days' : ` · ${s.chance}% chance`}
                  </p>
                </div>
                <div className="flex max-h-[65vh] min-h-[8rem] flex-col gap-2 overflow-y-auto p-2">
                  {col.leads.map((l) => {
                    const movable = canEdit && !l.network_id;
                    return (
                      <div key={l.id} draggable={movable}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDragging(l.id); }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}
                        className={`rounded-[var(--radius)] border border-border bg-elevated p-3 text-small shadow-sm transition ${movable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === l.id ? 'opacity-40' : 'hover:border-slate-400/60'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/admin/sales/leads/${l.id}`} className="min-w-0 font-medium text-fg hover:text-accent-text hover:underline">{l.company}</Link>
                          {l.owner_name && <Avatar name={l.owner_name} size="sm" />}
                        </div>
                        {l.contact_name && <p className="truncate text-tiny text-fg-muted">{l.contact_name}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-tiny">
                          {l.expected_mrr && <span className="font-semibold text-fg">{money(l.expected_mrr, l.currency)}<span className="font-normal text-fg-muted">/mo</span></span>}
                          {l.next_step_at && !closed && (
                            <span className={`inline-flex items-center gap-1 ${isOverdue(l.next_step_at) ? 'font-medium text-danger-text' : 'text-fg-secondary'}`} title={l.next_step ?? undefined}>
                              <CalendarClock size={12} />{relTime(l.next_step_at)}
                            </span>
                          )}
                          {l.open_tasks > 0 && <span className="inline-flex items-center gap-1 text-fg-secondary"><ListChecks size={12} />{l.open_tasks}</span>}
                          {l.network_name && <span className="text-success-text">→ {l.network_name}</span>}
                          {col.stage === 'lost' && l.lost_reason && <span className="text-fg-muted">{l.lost_reason}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {col.leads.length === 0 && <p className="px-1 py-6 text-center text-tiny text-fg-muted">{canEdit && !closed ? 'Drop a deal here' : 'Nothing here'}</p>}
                  {canEdit && !closed && (
                    <button type="button" className="rounded-[var(--radius)] border border-dashed border-border py-1.5 text-tiny text-fg-secondary hover:border-accent hover:text-fg" onClick={() => setAdding(col.stage)}>+ Add a deal</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {losing && <LostReasonModal company={losing.company} onClose={() => setLosing(null)}
        onSubmit={async (reason) => { const err = await move(losing, 'lost', reason); if (!err) setLosing(null); return err; }} />}
      {winning && <WonChoice company={winning.company} onClose={() => setWinning(null)}
        onJustWon={() => { void move(winning, 'won'); setWinning(null); }} onConvert={() => { setConverting(winning); setWinning(null); }} />}
      {converting && <ConvertLead lead={converting} onClose={() => { setConverting(null); board.refetch(); }} onDone={() => board.refetch()} />}
      {adding && <LeadForm lead={null} initialStage={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); board.refetch(); }} />}
    </>
  );
}
