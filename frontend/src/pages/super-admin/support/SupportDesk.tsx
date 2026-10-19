/**
 * Super Admin › Support — the help desk: the queue's numbers (open, waiting on the customer, first replies
 * overdue, unassigned, SLA met, first-reply time, satisfaction), the queue itself (Unassigned · Mine · All
 * open · Overdue · Resolved · Closed; priority / category / search; worst first), tickets per day and each
 * agent's load. Open a ticket for a network (after a call); saved replies.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlarmClock, CheckCheck, Clock3, Inbox, Smile, UserX } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useDebounced } from '../../admin/pagedList';
import { relTime } from '../../../lib/relativeTime';
import { totalOf } from '../../../lib/platformSales';
import { TICKET_CATEGORIES, TICKET_PRIORITY, categoryLabel, fmtMinutes, type SupportCounts, type Ticket, type TicketPriority } from '../../../lib/platformSupport';
import { PageHeader, Table, Spinner, StateBlock, Tabs, type Column } from '../../../shared-components/primitives/ui';
import { Avatar, Empty, KpiTile, Pager, Panel, TrendChart } from '../kit';
import { NewTicketModal, PriorityChip, SlaBadge, StatusChip } from './parts';

interface Summary {
  counts: SupportCounts;
  byCategory: { category: string; n: number }[];
  trend: { day: string; created: number; resolved: number }[];
  agents: { id: string; name: string; active: number; open: number; resolved_7d: number }[];
}
const VIEWS: Record<string, Record<string, string>> = {
  Unassigned: { status: 'active', assignee: 'unassigned' },
  Mine: { status: 'active', assignee: 'me' },
  'All open': { status: 'active' },
  Overdue: { status: 'active', overdue: 'true' },
  Resolved: { status: 'resolved', sort: 'updated' },
  Closed: { status: 'closed', sort: 'updated' },
};
const LIMIT = 50;

export default function SupportDesk() {
  const { can } = usePlatformMe();
  const [params, setParams] = useSearchParams();
  const view = VIEWS[params.get('view') ?? ''] ? params.get('view')! : 'All open';
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [opening, setOpening] = useState(false);
  const search = useDebounced(q.trim(), 300);
  const summary = useQuery<Summary>('/platform/support/summary');
  const tickets = useQuery<Ticket[]>('/platform/support/tickets', { ...VIEWS[view], priority: priority || undefined, category: category || undefined, q: search || undefined, limit: LIMIT, offset });
  const c = summary.data?.counts;

  const columns: Column<Ticket>[] = [
    {
      header: 'Ticket', cell: (t) => (
        <div className="min-w-[16rem] max-w-[28rem]">
          <Link to={`/admin/support/${t.id}`} className="font-medium text-fg hover:text-accent-text hover:underline">{t.subject}</Link>
          <p className="truncate text-tiny text-fg-muted">
            <span className="font-mono">#{t.number}</span> · {t.last_author === 'customer' ? <span className="text-fg-secondary">Customer: </span> : t.last_author === 'staff' ? 'You: ' : ''}{t.last_message ?? ''}
          </p>
        </div>
      ),
    },
    { header: 'Network', cell: (t) => <div><Link to={`/admin/networks/${t.network_id}`} className="text-fg hover:underline">{t.network_name}</Link><p className="text-tiny text-fg-muted">{t.requester_name ?? t.requester_email ?? '—'}</p></div> },
    { header: 'Priority', cell: (t) => <PriorityChip priority={t.priority} /> },
    { header: 'Status', cell: (t) => <div className="space-y-1"><StatusChip status={t.status} /><div><SlaBadge t={t} /></div></div> },
    { header: 'Assignee', cell: (t) => (t.assignee_name ? <span className="inline-flex items-center gap-2"><Avatar name={t.assignee_name} size="sm" />{t.assignee_name}</span> : <span className="text-fg-muted">Unassigned</span>) },
    { header: 'Updated', cell: (t) => <span className="text-fg-secondary" title={new Date(t.updated_at).toLocaleString()}>{relTime(t.updated_at)}</span> },
  ];

  return (
    <>
      <PageHeader title="Support" subtitle="Tickets from your customer networks — answer them before their first-reply deadline."
        action={<>
          <Link to="/admin/support/macros" className="btn-ghost">Saved replies</Link>
          {can('support', 'full') && <button className="btn-primary" onClick={() => setOpening(true)}>New ticket</button>}
        </>} />
      {summary.error ? <p className="mb-3 text-small text-danger-text">{summary.error}</p> : !c ? <StateBlock><Spinner /></StateBlock> : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <KpiTile label="Open" icon={Inbox} hint={`${c.on_hold} on hold · ${c.mine} yours`} to="/admin/support?view=All+open">{c.open}</KpiTile>
            <KpiTile label="Waiting on customer" icon={Clock3} tone="warning" hint="Answered — their turn">{c.pending}</KpiTile>
            <KpiTile label="First reply overdue" icon={AlarmClock} tone={c.breached ? 'danger' : 'success'} hint="Past the SLA" to="/admin/support?view=Overdue">{c.breached}</KpiTile>
            <KpiTile label="Unassigned" icon={UserX} tone={c.unassigned ? 'warning' : 'success'} to="/admin/support?view=Unassigned">{c.unassigned}</KpiTile>
            <KpiTile label="SLA met · 30 days" icon={CheckCheck} tone={c.sla_met_pct !== null && c.sla_met_pct < 90 ? 'warning' : 'success'}
              hint={`First reply ${fmtMinutes(c.avg_first_response_min)} avg · ${c.resolved_30d} resolved`}>{c.sla_met_pct === null ? '—' : `${c.sla_met_pct}%`}</KpiTile>
            <KpiTile label="Satisfaction" icon={Smile} tone="info" hint={c.csat_responses ? `${c.csat_responses} rating(s) · 90 days` : 'No ratings yet'}>{c.csat ? `${c.csat} / 5` : '—'}</KpiTile>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Tickets per day · 14 days" className="xl:col-span-2">
              <TrendChart height={120} points={(summary.data?.trend ?? []).map((t) => ({ label: new Date(t.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), values: [t.created, t.resolved] }))}
                series={[{ name: 'New', className: 'bg-info' }, { name: 'Resolved', className: 'bg-success' }]} />
            </Panel>
            <Panel title="Team load">
              {(summary.data?.agents ?? []).length === 0 ? <Empty>No support members yet.</Empty> : summary.data!.agents.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2 text-small">
                  <Avatar name={a.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-fg">{a.name}</span>
                  <span className="text-tiny text-fg-secondary">{a.active} open · {a.resolved_7d} solved 7d</span>
                </div>
              ))}
            </Panel>
          </div>
        </>
      )}

      <div className="mt-6">
        <Tabs tabs={Object.keys(VIEWS)} active={view} onChange={(v) => { setParams({ view: v }, { replace: true }); setOffset(0); }} />
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search subject, #number, network, email…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <select className="input !w-auto" value={priority} onChange={(e) => { setPriority(e.target.value); setOffset(0); }} aria-label="Priority">
          <option value="">Any priority</option>
          {(Object.keys(TICKET_PRIORITY) as TicketPriority[]).map((p) => <option key={p} value={p}>{TICKET_PRIORITY[p].label}</option>)}
        </select>
        <select className="input !w-auto" value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); }} aria-label="Category">
          <option value="">Any category</option>
          {TICKET_CATEGORIES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        {summary.data && summary.data.byCategory.length > 0 && (
          <p className="self-center text-tiny text-fg-muted">Open by category: {summary.data.byCategory.map((b) => `${categoryLabel(b.category)} ${b.n}`).join(' · ')}</p>
        )}
      </div>
      {tickets.loading && !tickets.data ? <StateBlock><Spinner /></StateBlock>
        : tickets.error ? <StateBlock>{tickets.error}</StateBlock>
        : (tickets.data ?? []).length === 0 ? <StateBlock>{view === 'Overdue' ? 'No first reply is overdue.' : view === 'Unassigned' ? 'Every open ticket has someone.' : 'No tickets here.'}</StateBlock>
        : <>
          <Table columns={columns} rows={tickets.data ?? []} rowKey={(t) => t.id} />
          <Pager offset={offset} limit={LIMIT} total={totalOf(tickets.data)} onChange={setOffset} />
        </>}
      {opening && <NewTicketModal onClose={() => setOpening(false)} />}
    </>
  );
}
