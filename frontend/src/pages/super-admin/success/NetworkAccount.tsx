/**
 * A network's account (Super Admin › Networks › a network › Account): its health — score, the parts it's
 * made of, 90 days of history — the signals behind it, the onboarding milestones, who looks after it and
 * who sold it, tags, the team's notes (pinned first) and its tasks.
 */
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Circle, Pin, PinOff, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { useStaff, type PlatformTask } from '../../../lib/platformSales';
import { HEALTH, PARTS, trendPct, type AccountDetail } from '../../../lib/platformSuccess';
import { Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Sparkline } from '../../../shared-components/charts/Sparkline';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { Panel, Empty } from '../kit';
import { StaffSelect } from '../sales/parts';
import { TaskList, TaskForm } from '../TaskList';
import { HealthChip, ScoreDelta } from './parts';

export function NetworkAccount({ networkId, networkName }: { networkId: string; networkName: string }) {
  const { can } = usePlatformMe();
  const canEdit = can('success', 'full');
  const acc = useQuery<AccountDetail>(`/platform/networks/${networkId}/account`);
  const tasks = useQuery<PlatformTask[]>('/platform/tasks', { networkId, assignee: 'all', status: 'open', limit: 100 });
  const staff = useStaff();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState('');
  const [pinNew, setPinNew] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const addNote = useMutation((b: { body: string; pinned: boolean }) => api.post(`/platform/networks/${networkId}/notes`, b));
  const recalc = useMutation(() => api.post('/platform/success/recalculate', { networkId }));

  if (acc.loading && !acc.data) return <StateBlock><Spinner /></StateBlock>;
  if (acc.error || !acc.data) return <StateBlock>{acc.error ?? 'Could not load the account'}</StateBlock>;
  const a = acc.data;
  const s = a.health_signals;
  const patch = async (b: Record<string, unknown>) => {
    setError(null);
    try { await api.patch(`/platform/networks/${networkId}/account`, b); acc.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  };
  const noteAction = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); acc.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the note'); }
  };
  const submitNote = async (e: FormEvent) => {
    e.preventDefault();
    if (await addNote.run({ body: note.trim(), pinned: pinNew })) { setNote(''); setPinNew(false); acc.refetch(); }
  };
  const addTag = (e: FormEvent) => {
    e.preventDefault();
    const t = tagInput.trim().toLowerCase();
    if (!t || a.tags.includes(t)) { setTagInput(''); return; }
    void patch({ tags: [...a.tags, t] });
    setTagInput('');
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Health" className="xl:col-span-2" action={canEdit ? (
          <button className="text-tiny font-medium text-accent-text hover:underline disabled:opacity-50" disabled={recalc.busy}
            onClick={async () => { if (await recalc.run(undefined)) acc.refetch(); }}>{recalc.busy ? 'Recalculating…' : 'Recalculate'}</button>
        ) : undefined}>
          <div className="grid grid-cols-1 gap-6 px-4 py-4 md:grid-cols-[auto,1fr]">
            <div className="flex flex-col items-start gap-2">
              <p className={`text-5xl font-semibold tracking-tight ${a.health_status ? HEALTH[a.health_status].text : 'text-fg-muted'}`}>{a.health_score ?? '—'}</p>
              <HealthChip score={a.health_score} status={a.health_status} />
              <p className="text-tiny text-fg-muted">{a.score_7d_ago === null ? 'No history a week back yet' : <>7 days ago: {a.score_7d_ago} <ScoreDelta now={a.health_score} before={a.score_7d_ago} /></>}</p>
              <p className="text-tiny text-fg-muted">{a.health_computed_at ? `Computed ${relTime(a.health_computed_at)}` : 'Not computed yet'}</p>
            </div>
            <div className="space-y-2.5">
              {PARTS.map((p) => {
                const v = a.health_components[p.key];
                return (
                  <div key={p.key} title={p.hint}>
                    <div className="mb-1 flex justify-between text-small"><span className="text-fg">{p.label} <span className="text-tiny text-fg-muted">· {p.weight} %</span></span><span className="font-medium text-fg">{v ?? '—'}</span></div>
                    <div className="h-1.5 rounded-full bg-page"><div className={`h-1.5 rounded-full ${v === undefined ? '' : v >= 70 ? 'bg-success' : v >= 40 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${v ?? 0}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
          {a.history.length > 1 && (
            <div className="px-4 py-3">
              <p className="mb-1 text-tiny font-semibold uppercase tracking-wide text-fg-muted">Last 90 days</p>
              <Sparkline data={a.history.map((h) => h.score)} height={48} />
            </div>
          )}
        </Panel>
        <Panel title="Signals">
          <dl className="space-y-2 px-4 py-3 text-small">
            {[
              ['Clicks · last 7 days', `${(s.clicks7d ?? 0).toLocaleString()}${trendPct(s) ? ` (${trendPct(s)})` : ''}`],
              ['Clicks today', (s.clicksToday ?? 0).toLocaleString()],
              ['Conversions · 7 days', (s.conversions7d ?? 0).toLocaleString()],
              ['Last sign-in', s.lastLoginAt ? relTime(s.lastLoginAt) : 'never'],
              ['People signing in · 14 days', String(s.activeUsers14d ?? 0)],
              ['Overdue invoices', String(s.overdueInvoices ?? 0)],
              ['Offers · partners', `${s.offers ?? 0} · ${s.partners ?? 0}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-fg-secondary">{k}</dt><dd className="font-medium text-fg">{v}</dd></div>
            ))}
          </dl>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={<>Onboarding <span className="text-small font-normal text-fg-muted">· {a.onboarding_pct ?? 0} %</span></>}>
          {a.onboarding.length === 0 ? <Empty>Computed with the health score.</Empty> : (
            <ul className="space-y-2 px-4 py-3 text-small">
              {a.onboarding.map((m) => (
                <li key={m.key} className="flex items-center gap-2">
                  {m.done ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Circle size={16} className="shrink-0 text-fg-muted" />}
                  <span className={m.done ? 'text-fg' : 'text-fg-secondary'}>{m.label}</span>
                  {m.at && <span className="ml-auto text-tiny text-fg-muted">{new Date(m.at).toLocaleDateString()}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Account">
          <div className="space-y-3 px-4 py-3 text-small">
            <div>
              <p className="mb-1 text-fg-secondary">Account manager</p>
              {canEdit ? <StaffSelect staff={staff.data} value={a.account_manager_id ?? ''} onChange={(v) => void patch({ accountManagerId: v || null })} noneLabel="Nobody yet" ariaLabel="Account manager" />
                : <p className="font-medium text-fg">{a.account_manager_name ?? 'Nobody yet'}</p>}
            </div>
            <div>
              <p className="mb-1 text-fg-secondary">Sold by</p>
              {canEdit ? <StaffSelect staff={staff.data} value={a.sales_owner_id ?? ''} onChange={(v) => void patch({ salesOwnerId: v || null })} noneLabel="—" ariaLabel="Sold by" />
                : <p className="font-medium text-fg">{a.sales_owner_name ?? '—'}</p>}
            </div>
            <div>
              <p className="mb-1 text-fg-secondary">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {a.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-tiny text-fg ring-1 ring-inset ring-border">
                    {t}{canEdit && <button type="button" aria-label={`Remove ${t}`} className="text-fg-muted hover:text-danger-text" onClick={() => void patch({ tags: a.tags.filter((x) => x !== t) })}>×</button>}
                  </span>
                ))}
                {a.tags.length === 0 && !canEdit && <span className="text-fg-muted">none</span>}
              </div>
              {canEdit && (
                <form onSubmit={addTag} className="mt-2 flex gap-2">
                  <input className="input !py-1 text-small" maxLength={40} placeholder="Add a tag, e.g. enterprise" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
                  <button type="submit" className="btn-ghost !px-3 !py-1" disabled={!tagInput.trim()}>Add</button>
                </form>
              )}
            </div>
          </div>
        </Panel>
        <Panel title="Tasks" action={can('success', 'full') ? <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setAddingTask(true)}>Add task</button> : undefined}>
          <TaskList tasks={tasks.data ?? []} onChanged={tasks.refetch} context={false} empty="No open tasks." />
        </Panel>
      </div>

      <Panel title="Notes">
        {canEdit && (
          <form onSubmit={submitNote} className="space-y-2 px-4 py-3">
            <textarea className="input min-h-[70px]" maxLength={10000} placeholder={`What should the team know about ${networkName}?`} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-small text-fg-secondary"><input type="checkbox" checked={pinNew} onChange={(e) => setPinNew(e.target.checked)} /> Pin it to the top</label>
              <div className="flex items-center gap-3">
                {addNote.error && <span className="text-small text-danger-text">{addNote.error}</span>}
                <button type="submit" className="btn-primary" disabled={addNote.busy || !note.trim()}>{addNote.busy ? 'Saving…' : 'Add note'}</button>
              </div>
            </div>
          </form>
        )}
        {a.notes.length === 0 ? <Empty>No notes yet.</Empty> : a.notes.map((n) => (
          <div key={n.id} className="group flex gap-3 px-4 py-3 text-small">
            {n.pinned ? <Pin size={14} className="mt-1 shrink-0 text-accent-text" /> : <span className="w-[14px] shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-fg">{n.body}</p>
              <p className="mt-1 text-tiny text-fg-muted">{n.author_name ?? 'Someone'} · {relTime(n.created_at)}{n.updated_at !== n.created_at ? ' · edited' : ''}</p>
            </div>
            {canEdit && (
              <span className="flex shrink-0 items-start gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" className="text-fg-muted hover:text-fg" aria-label={n.pinned ? 'Unpin' : 'Pin'} title={n.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => void noteAction(() => api.patch(`/platform/notes/${n.id}`, { pinned: !n.pinned }))}>{n.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                <button type="button" className="text-fg-muted hover:text-danger-text" aria-label="Delete note"
                  onClick={() => confirm({ title: 'Delete this note?', confirmLabel: 'Delete', destructive: true, message: 'It is removed for everyone.', onConfirm: async () => { await api.del(`/platform/notes/${n.id}`); acc.refetch(); } })}><Trash2 size={14} /></button>
              </span>
            )}
          </div>
        ))}
      </Panel>
      {addingTask && <TaskForm defaults={{ kind: 'success', networkId, about: networkName }} onClose={() => setAddingTask(false)} onSaved={() => { setAddingTask(false); tasks.refetch(); }} />}
    </div>
  );
}
