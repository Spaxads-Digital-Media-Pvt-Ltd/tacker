/**
 * Super Admin › Sales — the sales team's home: open pipeline and the weighted forecast, new and won this
 * month, win rate and sales cycle (90 days), the funnel by stage, leads per week, sources, the leaderboard,
 * trials to convert, my tasks and the latest activity. Amounts per currency, never summed across them.
 */
import { Link } from 'react-router-dom';
import { BadgeDollarSign, Clock3, Target, TrendingUp, Trophy, UserPlus } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { money, day } from '../../../lib/platformBilling';
import { relTime, isOverdue } from '../../../lib/relativeTime';
import { STAGES, sourceLabel, stageOf, type PerCurrencyAmount, type SalesHeadline } from '../../../lib/platformSales';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Avatar, BarList, Empty, KpiTile, Panel, PerCurrency, TrendChart } from '../kit';

interface Summary extends SalesHeadline {
  stages: { stage: string; count: number; mrr: PerCurrencyAmount[] }[];
  sources: { source: string; leads: number; won: number }[];
  leaderboard: { id: string; name: string; open: number; won_this_month: number; won_this_quarter: number; won_mrr_quarter: PerCurrencyAmount[] }[];
  trend: { week: string; created: number; won: number }[];
  myTasks: { id: string; title: string; priority: string; due_at: string | null; lead_id: string | null; lead_company: string | null; network_id: string | null; network_name: string | null }[];
  recent: { id: string; kind: string; body: string | null; meta: Record<string, unknown>; created_at: string; lead_id: string; company: string; actor_name: string | null }[];
  trials: { network_id: string; network_name: string; trial_ends_at: string; plan_name: string; sales_owner: string | null }[] | null;
  myQuota: { currency: string; target: string; won: string }[];
}

/** "Your quota USD 1,000.00 — 40%" for each currency you have a quota in this month. */
const quotaLine = (q: Summary['myQuota']): string => q.map((x) => {
  const t = Math.round(Number(x.target) * 100);
  return `your quota ${money(x.target, x.currency)}${t > 0 ? ` — ${Math.round((Math.round(Number(x.won) * 100) / t) * 100)}%` : ''}`;
}).join(' · ');

const recentLine = (r: Summary['recent'][number]): string => {
  const m = r.meta as Record<string, string>;
  switch (r.kind) {
    case 'stage': return `moved it to ${stageOf(m['to'] ?? '').label}`;
    case 'owner': return `handed it to ${m['to'] ?? 'nobody'}`;
    case 'created': return 'added it';
    case 'converted': return `converted it into ${m['networkName']}`;
    case 'inbound': return 'asked for a demo';
    case 'task': return `completed “${r.body ?? 'a task'}”`;
    default: return `logged a ${r.kind}`;
  }
};

export default function SalesDashboard() {
  const { can } = usePlatformMe();
  const { data: s, loading, error } = useQuery<Summary>('/platform/sales/summary');
  if (loading && !s) return <StateBlock><Spinner /></StateBlock>;
  if (error || !s) return <StateBlock>{error ?? 'Could not load the sales dashboard'}</StateBlock>;
  const k = s.kpis;
  const funnel = STAGES.filter((x) => x.key !== 'lost').map((x) => ({ ...x, row: s.stages.find((r) => r.stage === x.key) }));
  const maxCount = Math.max(1, ...funnel.map((f) => f.row?.count ?? 0));

  return (
    <>
      <PageHeader title="Sales" subtitle="Pipeline, forecast and the team’s numbers."
        action={<>
          <Link to="/admin/sales/pipeline" className="btn-ghost">Pipeline</Link>
          {can('sales', 'full') && <Link to="/admin/sales/leads" className="btn-primary">Leads</Link>}
        </>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile label="Open pipeline" icon={Target} to="/admin/sales/pipeline"
          hint={<>{k.open.toLocaleString()} open deal(s){k.unassigned ? ` · ${k.unassigned} unassigned` : ''}{k.overdue_next_steps ? ` · ${k.overdue_next_steps} next step(s) overdue` : ''}</>}>
          <PerCurrency rows={s.forecast} render={(f) => <>{money(f.pipeline, f.currency)}<span className="text-base font-normal text-fg-secondary"> /mo</span></>} none="Nothing open" />
        </KpiTile>
        <KpiTile label="Weighted forecast" icon={TrendingUp} tone="info" hint="Open value × each stage’s chance of closing">
          <PerCurrency rows={s.forecast} render={(f) => money(f.weighted, f.currency)} none="—" />
        </KpiTile>
        <KpiTile label="Won this month" icon={Trophy} tone="success" to={s.myQuota?.length ? '/admin/sales/team' : undefined}
          hint={`${k.won_this_month} deal(s) closed this month${s.myQuota?.length ? ` · ${quotaLine(s.myQuota)}` : ''}`}>
          <PerCurrency rows={s.wonThisMonth} render={(w) => <>{money(w.amount, w.currency)}<span className="text-base font-normal text-fg-secondary"> MRR</span></>} none="None yet" />
        </KpiTile>
        <KpiTile label="New leads this month" icon={UserPlus} to="/admin/sales/leads">{k.new_this_month.toLocaleString()}</KpiTile>
        <KpiTile label="Win rate (90 days)" icon={BadgeDollarSign} tone={k.win_rate_90d !== null && k.win_rate_90d < 20 ? 'warning' : 'success'} hint={`${k.won_90d} won · ${k.lost_90d} lost`}>
          {k.win_rate_90d === null ? '—' : `${k.win_rate_90d}%`}
        </KpiTile>
        <KpiTile label="Sales cycle" icon={Clock3} tone="info" hint="Average days from lead to won (90 days)">
          {k.avg_cycle_days === null ? '—' : `${k.avg_cycle_days} days`}
        </KpiTile>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Funnel" to="/admin/sales/pipeline" linkLabel="Open the pipeline" className="xl:col-span-1">
          <div className="space-y-2 px-4 py-3">
            {funnel.map((f) => (
              <div key={f.key} className="flex items-center gap-3 text-small">
                <span className="w-24 shrink-0 text-fg-secondary">{f.label}</span>
                <div className="h-6 flex-1 rounded bg-page">
                  <div className={`flex h-6 items-center rounded px-2 text-tiny font-semibold text-white ${f.dot}`} style={{ width: `${Math.max(8, ((f.row?.count ?? 0) / maxCount) * 100)}%` }}>
                    {f.row?.count ?? 0}
                  </div>
                </div>
              </div>
            ))}
            <p className="pt-1 text-tiny text-fg-muted">Won counts the last 30 days.</p>
          </div>
        </Panel>
        <Panel title="Leads per week" className="xl:col-span-2">
          <TrendChart points={s.trend.map((t) => ({ label: new Date(t.week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), values: [t.created, t.won] }))}
            series={[{ name: 'New leads', className: 'bg-info' }, { name: 'Won', className: 'bg-success' }]} />
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="My tasks" to="/admin/tasks">
          {s.myTasks.length === 0 ? <Empty>Nothing due — all caught up.</Empty> : s.myTasks.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-small">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{t.title}</p>
                <p className="text-tiny text-fg-muted">
                  {t.lead_id ? <Link to={`/admin/sales/leads/${t.lead_id}`} className="hover:underline">{t.lead_company}</Link> : t.network_id ? <Link to={`/admin/networks/${t.network_id}`} className="hover:underline">{t.network_name}</Link> : 'General'}
                </p>
              </div>
              <span className={`shrink-0 text-tiny ${isOverdue(t.due_at) ? 'font-medium text-danger-text' : 'text-fg-muted'}`}>{t.due_at ? relTime(t.due_at) : 'no date'}</span>
            </div>
          ))}
        </Panel>
        <Panel title="Leaderboard · this quarter">
          {s.leaderboard.length === 0 ? <Empty>No deals with an owner yet.</Empty> : s.leaderboard.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-small">
              <span className="w-4 text-tiny font-semibold text-fg-muted">{i + 1}</span>
              <Avatar name={r.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{r.name}</p>
                <p className="text-tiny text-fg-muted">{r.open} open · {r.won_this_month} won this month</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-fg">{r.won_this_quarter} won</p>
                <p className="text-tiny text-fg-muted">{r.won_mrr_quarter.map((m) => money(m.amount, m.currency)).join(' · ') || '—'}</p>
              </div>
            </div>
          ))}
        </Panel>
        <Panel title="Where leads come from · 6 months">
          {s.sources.length === 0 ? <Empty>No leads yet.</Empty>
            : <BarList rows={s.sources.map((x) => ({ key: x.source, label: sourceLabel(x.source), value: x.leads, hint: `${x.won} won` }))} />}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {s.trials && (
          <Panel title="Trials to convert" to="/admin/networks" linkLabel="All networks">
            {s.trials.length === 0 ? <Empty>No network is in a trial.</Empty> : s.trials.map((t) => (
              <div key={t.network_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                <div className="min-w-0">
                  <Link to={`/admin/networks/${t.network_id}`} className="font-medium text-fg hover:underline">{t.network_name}</Link>
                  <p className="text-tiny text-fg-muted">{t.plan_name}{t.sales_owner ? ` · sold by ${t.sales_owner}` : ''}</p>
                </div>
                <span className={`shrink-0 text-tiny ${new Date(t.trial_ends_at).getTime() - Date.now() < 3 * 86_400_000 ? 'font-medium text-danger-text' : 'text-fg-muted'}`}>
                  ends {relTime(t.trial_ends_at)} · {day(t.trial_ends_at)}
                </span>
              </div>
            ))}
          </Panel>
        )}
        <Panel title="Latest activity" className={s.trials ? '' : 'xl:col-span-2'}>
          {s.recent.length === 0 ? <Empty>Nothing yet.</Empty> : s.recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
              <span className="min-w-0 truncate text-fg-secondary">
                <span className="font-medium text-fg">{r.actor_name ?? 'System'}</span> {recentLine(r)} · <Link to={`/admin/sales/leads/${r.lead_id}`} className="text-fg hover:underline">{r.company}</Link>
              </span>
              <span className="shrink-0 text-tiny text-fg-muted">{relTime(r.created_at)}</span>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
