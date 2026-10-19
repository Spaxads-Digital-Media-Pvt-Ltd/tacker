/**
 * Super Admin › Overview — the platform at a glance (GET /platform/summary): networks, subscriptions, MRR (with
 * its last 12 months) and billing per currency (never summed across currencies), the last 24 hours' traffic;
 * traffic per day and the busiest networks (14 days), new networks per month; each panel's headline numbers — Sales, Support,
 * Customer health — from the same functions their own pages use; your tasks; what needs attention (overdue
 * invoices and the networks they suspend, trials ending this week, plan limits); what the team did lately.
 * A part the member's role may not read is null in the answer and left out here.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon, AlertTriangle, Building2, CircleDollarSign, Layers, Wallet } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { usePlatformMe } from '../../lib/platformMe';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { money, day, type InvoiceSummaryRow } from '../../lib/platformBilling';
import { activityLabel } from '../../lib/platformActivity';
import { HEALTH, type HealthCounts } from '../../lib/platformSuccess';
import { fmtMinutes, type SupportCounts } from '../../lib/platformSupport';
import type { PlatformTask, SalesHeadline } from '../../lib/platformSales';
import { KpiTile as Tile, Panel, Empty, PerCurrency, BarList, TrendChart, Sparkline, MiniStat, StackedBar, Toggle, Chip } from './kit';
import { TaskList } from './TaskList';

interface Summary {
  networks: { total: number; active: number; suspended: number; suspended_for_billing: number; deleted: number; new_this_month: number };
  subscriptions: { trialing: number; active: number; past_due: number; without_plan: number };
  /** null: the role may not see revenue / billing. */
  mrr: { currency: string; amount: string; subscriptions: number }[] | null;
  billing: InvoiceSummaryRow[] | null;
  traffic: { clicks24h: number; conversions24h: number };
  trialsEndingSoon: { network_id: string; network_name: string; plan_name: string; trial_ends_at: string }[];
  overdueInvoices: { id: string; number: string; network_id: string; network_name: string; total: string; currency: string; due_at: string; suspend_at: string; network_status: string | null; network_suspended_reason: string | null }[] | null;
  limitAlerts: { network_id: string; network_name: string; type: string; title: string; created_at: string }[];
  recentActivity: { id: string; created_at: string; action: string; network_id: string | null; network_name: string | null; admin_email: string | null; in_support_session: boolean }[] | null;
  trend: { day: string; clicks: number; conversions: number }[];
  signups: { month: string; created: number }[];
  topNetworks: { id: string; name: string; clicks: number; conversions: number }[];
  mrrTrend: { month: string; currency: string; mrr: string; customers: number }[] | null;
  sales: SalesHeadline | null;
  support: SupportCounts | null;
  health: HealthCounts | null;
  tasks: { open: number; overdue: number; due_today: number };
}

const int = (n: number) => n.toLocaleString();
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
/** The last 12 months as YYYY-MM, oldest first (this one last). */
const last12 = (now = new Date()) => Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
  return d.toISOString().slice(0, 7);
});
const greeting = (h = new Date().getHours()) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-3 mt-8 text-small font-semibold uppercase tracking-wide text-fg-secondary">{children}</h2>
);

export default function Overview() {
  const { me, can } = usePlatformMe();
  const { data: s, loading, error, refetch } = useQuery<Summary>('/platform/summary');
  if (loading && !s) return <StateBlock><Spinner /></StateBlock>;
  if (error || !s) return <StateBlock>{error ?? 'Could not load the overview'}</StateBlock>;
  const billing = s.billing ?? [];
  const overdueCount = billing.reduce((n, b) => n + b.overdue_count, 0);
  const firstName = (me?.name ?? '').trim().split(/\s+/)[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <PageHeader title="Overview" subtitle="The platform at a glance." />
      <div className="mb-5">
        <h2 className="text-h2 font-semibold text-fg">{firstName ? `${greeting()}, ${firstName}` : greeting()}</h2>
        <p className="text-small text-fg-secondary">{today}{me ? ` · ${me.role.name}` : ''}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Networks" to={can('networks') ? '/admin/networks' : undefined} icon={Building2}
          hint={<>{int(s.networks.suspended)} suspended{s.networks.suspended_for_billing ? ` (${int(s.networks.suspended_for_billing)} for billing)` : ''} · {int(s.networks.new_this_month)} new this month</>}
          footer={<Sparkline values={s.signups.map((m) => m.created)} labels={s.signups.map((m) => `New in ${monthLabel(m.month)}`)} />}>
          {int(s.networks.active)} <span className="text-base font-normal text-fg-secondary">active of {int(s.networks.total - s.networks.deleted)}</span>
        </Tile>
        <Tile label="Subscriptions" to={can('plans') ? '/admin/plans' : undefined} icon={Layers} tone="info"
          hint={<>{int(s.subscriptions.trialing)} in trial · {int(s.subscriptions.past_due)} past due · {int(s.subscriptions.without_plan)} without a plan</>}
          footer={<StackedBar legend={false} parts={[
            { key: 'active', label: 'Paying', value: s.subscriptions.active, className: 'bg-success' },
            { key: 'past_due', label: 'Past due', value: s.subscriptions.past_due, className: 'bg-danger' },
            { key: 'trialing', label: 'In trial', value: s.subscriptions.trialing, className: 'bg-info' },
            { key: 'none', label: 'Without a plan', value: s.subscriptions.without_plan, className: 'bg-fg-muted/40' },
          ]} />}>
          {int(s.subscriptions.active + s.subscriptions.past_due)} <span className="text-base font-normal text-fg-secondary">paying</span>
        </Tile>
        {s.mrr && <MrrTile mrr={s.mrr} trend={s.mrrTrend ?? []} />}
        {s.billing && <>
          <Tile label="Overdue" to="/admin/billing" icon={AlertTriangle} tone={overdueCount ? 'danger' : 'success'} hint={`${int(overdueCount)} invoice(s) past their due date`}>
            <PerCurrency rows={billing.filter((b) => b.overdue_count > 0)} render={(b) => <span className="text-danger-text">{money(b.overdue_total, b.currency)}</span>} none="Nothing overdue" />
          </Tile>
          <Tile label="Collected this month" to="/admin/billing" icon={Wallet} tone="success" hint="Payments recorded this month">
            <PerCurrency rows={billing.filter((b) => Number(b.collected_this_month) > 0)} render={(b) => money(b.collected_this_month, b.currency)} none="None yet" />
          </Tile>
        </>}
        <Tile label="Traffic (24h)" icon={ActivityIcon} tone="info" hint="Platform-wide clicks and conversions">
          {int(s.traffic.clicks24h)} <span className="text-base font-normal text-fg-secondary">clicks · {int(s.traffic.conversions24h)} conversions</span>
        </Tile>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <TrafficPanel trend={s.trend} />
        <Panel title="Top networks · last 14 days" to={can('networks') ? '/admin/usage' : undefined} linkLabel="Usage">
          {s.topNetworks.length === 0 ? <Empty>No traffic in the last 14 days.</Empty> : (
            <BarList rows={s.topNetworks.map((n) => ({
              key: n.id, value: n.clicks, hint: `${int(n.conversions)} conv.`,
              label: <Link to={`/admin/networks/${n.id}`} className="hover:underline">{n.name}</Link>,
            }))} />
          )}
        </Panel>
      </div>

      {(s.sales || s.support || s.health) && <>
        <SectionTitle>Across the team</SectionTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {s.sales && <SalesCard sales={s.sales} />}
          {s.support && <SupportCard c={s.support} />}
          {s.health && <HealthCard h={s.health} />}
        </div>
      </>}

      <SectionTitle>Needs attention</SectionTitle>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {s.overdueInvoices && <Panel title="Overdue invoices" to="/admin/billing">
          {s.overdueInvoices.length === 0 ? <Empty>Nothing overdue.</Empty> : s.overdueInvoices.map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-small">
              <div className="min-w-0">
                <Link to={`/admin/networks/${i.network_id}`} className="font-medium text-fg hover:underline">{i.network_name}</Link>
                <p className="text-tiny text-fg-muted"><Link to={`/admin/invoices/${i.id}`} className="font-mono hover:underline">{i.number}</Link> · due {day(i.due_at)}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-fg">{money(i.total, i.currency)}</p>
                <p className={`text-tiny ${i.network_status === 'suspended' && i.network_suspended_reason === 'billing' ? 'font-medium text-danger-text' : 'text-fg-muted'}`}>
                  {i.network_status === 'suspended' && i.network_suspended_reason === 'billing' ? 'network suspended' : `suspends ${day(i.suspend_at)}`}
                </p>
              </div>
            </div>
          ))}
        </Panel>}
        <Panel title="Trials ending this week">
          {s.trialsEndingSoon.length === 0 ? <Empty>No trial ends in the next 7 days.</Empty> : s.trialsEndingSoon.map((t) => (
            <div key={t.network_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
              <Link to={`/admin/networks/${t.network_id}`} className="font-medium text-fg hover:underline">{t.network_name}</Link>
              <span className="text-tiny text-fg-muted">{t.plan_name} · ends {day(t.trial_ends_at)}</span>
            </div>
          ))}
        </Panel>
        <Panel title="Plan limits" to={can('networks') ? '/admin/usage' : undefined}>
          {s.limitAlerts.length === 0 ? <Empty>No network is near its plan’s limits.</Empty> : s.limitAlerts.map((a) => (
            <div key={`${a.network_id}-${a.title}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
              <Link to={`/admin/networks/${a.network_id}`} className="font-medium text-fg hover:underline">{a.network_name}</Link>
              <span className={`text-tiny ${a.type === 'plan_limit_reached' ? 'font-medium text-danger-text' : 'text-warning-text'}`}>{a.title}</span>
            </div>
          ))}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <MyTasks counts={s.tasks} onChanged={refetch} />
        {s.recentActivity && <Panel title="Recent Super Admin activity" to="/admin/activity" className="xl:col-span-2">
          {s.recentActivity.length === 0 ? <Empty>Nothing yet.</Empty> : s.recentActivity.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-small">
              <span className="text-fg">
                {activityLabel(a.action)}
                {a.network_id && a.network_name && <> · <Link to={`/admin/networks/${a.network_id}`} className="hover:underline">{a.network_name}</Link></>}
                {a.in_support_session && <span className="ml-1 text-tiny text-fg-muted">(support session)</span>}
              </span>
              <span className="text-tiny text-fg-muted">{a.admin_email ?? '—'} · {new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
        </Panel>}
      </div>
    </>
  );
}

/** MRR per currency, with the last 12 months of the currency most networks pay in (bar heights only — no sums). */
function MrrTile({ mrr, trend }: { mrr: NonNullable<Summary['mrr']>; trend: NonNullable<Summary['mrrTrend']> }) {
  const months = useMemo(() => last12(), []);
  const main = [...mrr].sort((a, b) => b.subscriptions - a.subscriptions)[0]?.currency;
  const history = main ? months.map((m) => Number(trend.find((t) => t.month === m && t.currency === main)?.mrr ?? 0)) : [];
  const enough = history.filter((v) => v > 0).length >= 2;
  return (
    <Tile label="MRR" to="/admin/revenue" icon={CircleDollarSign} tone="success"
      hint={enough ? `${main} over the last 12 months` : 'Monthly recurring revenue — paying plans, a yearly price as a twelfth'}
      footer={enough ? <Sparkline values={history} labels={months.map(monthLabel)} className="bg-success" format={(v) => money(v.toFixed(2), main!)} /> : undefined}>
      <PerCurrency rows={mrr} render={(m) => money(m.amount, m.currency)} none="None yet" />
    </Tile>
  );
}

function TrafficPanel({ trend }: { trend: Summary['trend'] }) {
  const [metric, setMetric] = useState<'clicks' | 'conversions'>('clicks');
  const clicks = trend.reduce((n, t) => n + t.clicks, 0);
  const conversions = trend.reduce((n, t) => n + t.conversions, 0);
  return (
    <Panel title="Platform traffic · last 14 days" className="xl:col-span-2"
      action={<Toggle value={metric} onChange={setMetric} options={[{ value: 'clicks', label: 'Clicks' }, { value: 'conversions', label: 'Conversions' }]} />}>
      <div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pt-3 text-small">
          <span><span className="font-semibold text-fg">{int(clicks)}</span> <span className="text-fg-secondary">clicks</span></span>
          <span><span className="font-semibold text-fg">{int(conversions)}</span> <span className="text-fg-secondary">conversions</span></span>
          <span><span className="font-semibold text-fg">{clicks ? `${((conversions / clicks) * 100).toFixed(2)}%` : '—'}</span> <span className="text-fg-secondary">conversion rate</span></span>
        </div>
        <TrendChart height={180} series={[metric === 'clicks' ? { name: 'Clicks', className: 'bg-accent' } : { name: 'Conversions', className: 'bg-info' }]}
          points={trend.map((t) => ({ label: dayLabel(t.day), values: [t[metric]] }))} />
      </div>
    </Panel>
  );
}

function SalesCard({ sales }: { sales: SalesHeadline }) {
  const k = sales.kpis;
  const won = sales.wonThisMonth.map((w) => money(w.amount, w.currency)).join(' · ');
  return (
    <Panel title="Sales" to="/admin/sales" linkLabel="Open sales">
      <div className="grid grid-cols-2 gap-1 p-2">
        <MiniStat label="Open leads" value={int(k.open)} hint={`${int(k.new_this_month)} new this month`} to="/admin/sales/leads" />
        <MiniStat label="Won this month" value={int(k.won_this_month)} tone={k.won_this_month ? 'success' : undefined} hint={won ? `${won} a month` : 'No deals yet'} to="/admin/sales/pipeline" />
        <MiniStat label="Win rate · 90 days" value={k.win_rate_90d === null ? '—' : `${k.win_rate_90d}%`}
          hint={k.avg_cycle_days === null ? 'No deals closed yet' : `${k.avg_cycle_days} days to close`} />
        <MiniStat label="Next steps overdue" value={int(k.overdue_next_steps)} tone={k.overdue_next_steps ? 'warning' : 'success'}
          hint={`${int(k.unassigned)} without an owner`} to="/admin/sales/leads" />
      </div>
      <div className="px-4 py-3">
        <p className="mb-1 text-tiny text-fg-muted">Weighted pipeline — open deals × their stage’s chance</p>
        <PerCurrency rows={sales.forecast} none={<span className="text-small text-fg-secondary">No open deals</span>}
          render={(f) => <p className="text-small"><span className="font-semibold text-fg">{money(f.weighted, f.currency)}</span> <span className="text-fg-muted">of {money(f.pipeline, f.currency)} a month</span></p>} />
      </div>
    </Panel>
  );
}

function SupportCard({ c }: { c: SupportCounts }) {
  return (
    <Panel title="Support" to="/admin/support" linkLabel="Open the desk">
      <div className="grid grid-cols-2 gap-1 p-2">
        <MiniStat label="Open tickets" value={int(c.open)} hint={`${int(c.pending)} waiting on the customer`} to="/admin/support?view=All+open" />
        <MiniStat label="First reply overdue" value={int(c.breached)} tone={c.breached ? 'danger' : 'success'} hint="Past the SLA" to="/admin/support?view=Overdue" />
        <MiniStat label="Unassigned" value={int(c.unassigned)} tone={c.unassigned ? 'warning' : 'success'} hint={`${int(c.mine)} assigned to you`} to="/admin/support?view=Unassigned" />
        <MiniStat label="Satisfaction · 90 days" value={c.csat ? `${c.csat} / 5` : '—'} hint={c.csat_responses ? `${int(c.csat_responses)} ratings` : 'No ratings yet'} />
      </div>
      <p className="px-4 py-3 text-small text-fg-secondary">
        SLA met <span className="font-semibold text-fg">{c.sla_met_pct === null ? '—' : `${c.sla_met_pct}%`}</span>
        {' · '}first reply {fmtMinutes(c.avg_first_response_min)} avg · {int(c.created_30d)} tickets in 30 days
      </p>
    </Panel>
  );
}

function HealthCard({ h }: { h: HealthCounts }) {
  return (
    <Panel title="Customer health" to="/admin/success" linkLabel="Open the board">
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-small text-fg-secondary">Average score · {int(h.accounts)} accounts</p>
          <p className="text-xl font-semibold text-fg">{h.avg_score ?? '—'}<span className="text-small font-normal text-fg-muted"> / 100</span></p>
        </div>
        <StackedBar parts={[
          { key: 'healthy', label: HEALTH.healthy.label, value: h.healthy, className: HEALTH.healthy.bar },
          { key: 'attention', label: HEALTH.attention.label, value: h.attention, className: HEALTH.attention.bar },
          { key: 'at_risk', label: HEALTH.at_risk.label, value: h.at_risk, className: HEALTH.at_risk.bar },
          { key: 'unscored', label: 'Not scored yet', value: h.unscored, className: 'bg-fg-muted/40' },
        ]} />
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        <MiniStat label="At risk" value={int(h.at_risk)} tone={h.at_risk ? 'danger' : 'success'} hint={`${int(h.attention)} need attention`} to="/admin/success" />
        <MiniStat label="No account manager" value={int(h.unassigned)} tone={h.unassigned ? 'warning' : undefined} hint={`${int(h.onboarding_open)} still onboarding`} to="/admin/success" />
      </div>
    </Panel>
  );
}

/** Your next open tasks (tick one off here); the counts come with the overview. */
function MyTasks({ counts, onChanged }: { counts: Summary['tasks']; onChanged: () => void }) {
  const tasks = useQuery<PlatformTask[]>('/platform/tasks', { limit: 5 });
  return (
    <Panel title="My tasks" to="/admin/tasks" linkLabel="All tasks"
      action={counts.overdue ? <Chip className="bg-danger-bg text-danger-text">{counts.overdue} overdue</Chip>
        : counts.due_today ? <Chip className="bg-warning-bg text-warning-text">{counts.due_today} due today</Chip> : undefined}>
      {tasks.loading && !tasks.data ? <Empty>Loading…</Empty>
        : tasks.error ? <Empty>{tasks.error}</Empty>
        : <TaskList tasks={tasks.data ?? []} onChanged={() => { tasks.refetch(); onChanged(); }} empty="Nothing on your list." />}
    </Panel>
  );
}
