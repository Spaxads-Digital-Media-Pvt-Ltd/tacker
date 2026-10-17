/**
 * Super Admin › Tasks — the team's to-dos across the panels (sales follow-ups, customer-success check-ins,
 * support and billing chores): mine or the team's, open or done, grouped by when they're due.
 */
import { useState } from 'react';
import { useQuery } from '../../lib/useApi';
import { TASK_KINDS, useStaff, type PlatformTask } from '../../lib/platformSales';
import { PageHeader, Segmented, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { Panel } from './kit';
import { TaskList, TaskForm } from './TaskList';
import { StaffSelect } from './sales/parts';

const DAY = 86_400_000;
function groupOf(t: PlatformTask, now: number): string {
  if (!t.due_at) return 'No due date';
  const due = new Date(t.due_at).getTime();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  if (due < now) return 'Overdue';
  if (due <= endOfToday.getTime()) return 'Today';
  if (due <= endOfToday.getTime() + 6 * DAY) return 'This week';
  return 'Later';
}
const ORDER = ['Overdue', 'Today', 'This week', 'Later', 'No due date'];

export default function Tasks() {
  const [who, setWho] = useState('me');
  const [member, setMember] = useState('');
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [adding, setAdding] = useState(false);
  const staff = useStaff();
  const assignee = who === 'member' ? member || 'all' : who;
  const tasks = useQuery<PlatformTask[]>('/platform/tasks', { assignee, status, kind: kind || undefined, limit: 200 });
  const now = Date.now();
  const rows = tasks.data ?? [];
  const groups = status === 'open'
    ? ORDER.map((g) => ({ g, rows: rows.filter((t) => groupOf(t, now) === g) })).filter((x) => x.rows.length)
    : [{ g: status === 'done' ? 'Done' : 'All', rows }];

  return (
    <>
      <PageHeader title="Tasks" subtitle="Follow-ups and to-dos across sales, customer success, support and billing."
        action={<button className="btn-primary" onClick={() => setAdding(true)}>New task</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented className="sm:max-w-md" options={[{ value: 'me', label: 'Mine' }, { value: 'all', label: 'Team' }, { value: 'unassigned', label: 'Unassigned' }, { value: 'member', label: 'Member…' }]}
          value={who} onChange={setWho} />
        {who === 'member' && <StaffSelect staff={staff.data} value={member} onChange={setMember} noneLabel="Choose a member" className="input !w-auto" ariaLabel="Member" />}
        <Segmented className="sm:max-w-[15rem]" options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />
        <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Every kind</option>
          {TASK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      {tasks.loading && !tasks.data ? <StateBlock><Spinner /></StateBlock>
        : tasks.error ? <StateBlock>{tasks.error}</StateBlock>
        : rows.length === 0 ? <StateBlock>{status === 'open' ? 'Nothing open — all caught up.' : 'No tasks here.'}</StateBlock>
        : (
          <div className="space-y-4">
            {groups.map(({ g, rows: list }) => (
              <Panel key={g} title={<span className={g === 'Overdue' ? 'text-danger-text' : ''}>{g} <span className="text-small font-normal text-fg-muted">· {list.length}</span></span>}>
                <TaskList tasks={list} onChanged={tasks.refetch} />
              </Panel>
            ))}
          </div>
        )}
      {adding && <TaskForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); tasks.refetch(); }} />}
    </>
  );
}
