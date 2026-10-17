/**
 * Super Admin › Customers › Customer health — the account managers' home: how many accounts are healthy, need
 * attention or are at risk; the at-risk ones and the biggest drops this week; onboarding that stalled; trials
 * ending; my check-ins and the latest notes — then every account with its score, change, signals, onboarding,
 * account manager and tags (worst first; filter by status, manager, tag).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Gauge, HeartPulse, ShieldCheck, UserRoundCheck, Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useDebounced } from '../../admin/pagedList';
import { relTime, isOverdue } from '../../../lib/relativeTime';
import { totalOf, useStaff } from '../../../lib/platformSales';
import { HEALTH, trendPct, type AccountRow, type HealthCounts, type HealthStatus } from '../../../lib/platformSuccess';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { KpiTile, Panel, Empty, Pager } from '../kit';
import { StaffSelect } from '../sales/parts';
import { HealthBar, HealthChip, ScoreDelta } from './parts';

interface Summary {
  counts: HealthCounts;
  atRisk: { id: string; name: string; health_score: number; account_manager_name: string | null }[];
  drops: { id: string; name: string; health_score: number; score_7d_ago: number }[];
  stalled: { id: string; name: string; created_at: string; onboarding_pct: number }[];
  trials: { id: string; name: string; trial_ends_at: string; health_score: number | null; health_status: HealthStatus | null; plan_name: string }[];
  notes: { id: string; body: string; created_at: string; network_id: string; network_name: string; author_name: string | null }[];
  myTasks: { id: string; title: string; due_at: string | null; network_id: string | null; network_name: string | null }[];
}
const LIMIT = 50;

export default function HealthBoard() {
  const { can } = usePlatformMe();
  const canEdit = can('success', 'full');
  const staff = useStaff();
  const summary = useQuery<Summary>('/platform/success/summary');
  const tags = useQuery<{ tag: string; n: number }[]>('/platform/success/tags');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [manager, setManager] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('score');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const search = useDebounced(q.trim(), 300);
  const accounts = useQuery<AccountRow[]>('/platform/success/accounts', { q: search || undefined, status: status || undefined, manager: manager || undefined, tag: tag || undefined, sort, limit: LIMIT, offset });
  const recalc = useMutation(() => api.post<{ computed: number; atRisk: number; tasksCreated: number }>('/platform/success/recalculate', {}));
  const filter = (fn: () => void) => { fn(); setOffset(0); };
  const assign = async (row: AccountRow, accountManagerId: string) => {
    setError(null);
    try { await api.patch(`/platform/networks/${row.id}/account`, { accountManagerId: accountManagerId || null }); accounts.refetch(); summary.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not assign'); }
  };

  const columns: Column<AccountRow>[] = [
    {
      header: 'Network', cell: (r) => (
        <div className="min-w-[11rem]">
          <Link to={`/admin/networks/${r.id}?tab=Account`} className="font-medium text-fg hover:text-accent-text hover:underline">{r.name}</Link>
          <p className="text-tiny text-fg-muted">{r.plan_name ?? 'no plan'}{r.subscription_status ? ` · ${r.subscription_status.replace('_', ' ')}` : ''}{r.status !== 'active' ? ` · ${r.status}` : ''}</p>
        </div>
      ),
    },
    { header: 'Health', cell: (r) => <div className="space-y-1"><HealthChip score={r.health_score} status={r.health_status} /><HealthBar score={r.health_score} status={r.health_status} /></div> },
    { header: '7 days', cell: (r) => <ScoreDelta now={r.health_score} before={r.score_7d_ago} /> },
    {
      header: 'Signals', cell: (r) => {
        const s = r.health_signals;
        return (
          <div className="text-tiny text-fg-secondary">
            <p>{(s.clicks7d ?? 0).toLocaleString()} clicks · 7d{trendPct(s) ? <span className={trendPct(s)!.startsWith('−') ? ' text-danger-text' : ' text-success-text'}> {trendPct(s)}</span> : ''}</p>
            <p>signed in {s.lastLoginAt ? relTime(s.lastLoginAt) : 'never'}{s.overdueInvoices ? <span className="text-danger-text"> · {s.overdueInvoices} overdue</span> : ''}</p>
          </div>
        );
      },
    },
    { header: 'Onboarding', cell: (r) => (r.onboarding_pct === null ? <span className="text-fg-muted">—</span> : <span className={r.onboarding_pct < 60 ? 'text-warning-text' : 'text-fg'}>{r.onboarding_pct} %</span>) },
    {
      header: 'Account manager', cell: (r) => (canEdit
        ? <StaffSelect staff={staff.data} value={r.account_manager_id ?? ''} onChange={(v) => void assign(r, v)} noneLabel="Unassigned" className="input !w-44 !py-1 text-small" ariaLabel={`Account manager of ${r.name}`} />
        : r.account_manager_name ?? <span className="text-fg-muted">Unassigned</span>),
    },
    { header: 'Tags', cell: (r) => (r.tags.length ? <div className="flex max-w-[12rem] flex-wrap gap-1">{r.tags.map((t) => <span key={t} className="rounded-full bg-page px-2 py-0.5 text-tiny text-fg-secondary ring-1 ring-inset ring-border">{t}</span>)}</div> : <span className="text-fg-muted">—</span>) },
  ];

  const c = summary.data?.counts;
  return (
    <>
      <PageHeader title="Customer health" subtitle="Every customer network’s health — who needs a call, who’s stuck onboarding, whose trial ends."
        action={canEdit ? <button className="btn-ghost" disabled={recalc.busy} onClick={async () => { if (await recalc.run(undefined)) { summary.refetch(); accounts.refetch(); } }}>
          {recalc.busy ? 'Recalculating…' : 'Recalculate now'}</button> : undefined} />
      {(recalc.error || error) && <p className="mb-3 text-small text-danger-text">{recalc.error ?? error}</p>}
      {summary.loading && !summary.data ? <StateBlock><Spinner /></StateBlock> : summary.error ? <StateBlock>{summary.error}</StateBlock> : c && summary.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiTile label="Healthy" icon={ShieldCheck} tone="success" hint={`${c.accounts} account(s) · scored ${c.computed_at ? relTime(c.computed_at) : 'not yet'}`}>{c.healthy}</KpiTile>
            <KpiTile label="Needs attention" icon={Gauge} tone="warning" hint="Score 40–69">{c.attention}</KpiTile>
            <KpiTile label="At risk" icon={AlertTriangle} tone="danger" hint="Score under 40">{c.at_risk}</KpiTile>
            <KpiTile label="Average score" icon={HeartPulse} tone="info" hint={c.unscored ? `${c.unscored} not scored yet` : 'Across your accounts'}>{c.avg_score ?? '—'}</KpiTile>
            <KpiTile label="My accounts" icon={UserRoundCheck} hint="Where you’re the account manager">{c.mine}</KpiTile>
            <KpiTile label="No account manager" icon={Users} tone={c.unassigned ? 'warning' : 'success'} hint="Assign one below">{c.unassigned}</KpiTile>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="At risk">
              {summary.data.atRisk.length === 0 ? <Empty>No account is at risk.</Empty> : summary.data.atRisk.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                  <div className="min-w-0"><Link to={`/admin/networks/${r.id}?tab=Account`} className="font-medium text-fg hover:underline">{r.name}</Link><p className="text-tiny text-fg-muted">{r.account_manager_name ?? 'no account manager'}</p></div>
                  <span className={`text-small font-semibold ${HEALTH.at_risk.text}`}>{r.health_score}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Biggest drops · 7 days">
              {summary.data.drops.length === 0 ? <Empty>No score fell 10+ points this week.</Empty> : summary.data.drops.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                  <Link to={`/admin/networks/${r.id}?tab=Account`} className="min-w-0 truncate font-medium text-fg hover:underline">{r.name}</Link>
                  <span className="shrink-0 text-tiny text-fg-secondary">{r.score_7d_ago} → <strong className="text-danger-text">{r.health_score}</strong></span>
                </div>
              ))}
            </Panel>
            <Panel title="Onboarding stalled">
              {summary.data.stalled.length === 0 ? <Empty>Nobody is stuck in onboarding.</Empty> : summary.data.stalled.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                  <div className="min-w-0"><Link to={`/admin/networks/${r.id}?tab=Account`} className="font-medium text-fg hover:underline">{r.name}</Link><p className="text-tiny text-fg-muted">joined {relTime(r.created_at)}</p></div>
                  <span className="shrink-0 text-tiny font-medium text-warning-text">{r.onboarding_pct} % set up</span>
                </div>
              ))}
            </Panel>
            <Panel title="Trials ending · 14 days">
              {summary.data.trials.length === 0 ? <Empty>No trial ends soon.</Empty> : summary.data.trials.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                  <div className="min-w-0"><Link to={`/admin/networks/${t.id}?tab=Account`} className="font-medium text-fg hover:underline">{t.name}</Link><p className="text-tiny text-fg-muted">{t.plan_name} · ends {relTime(t.trial_ends_at)}</p></div>
                  <HealthChip score={t.health_score} status={t.health_status} />
                </div>
              ))}
            </Panel>
            <Panel title="My check-ins" to="/admin/tasks">
              {summary.data.myTasks.length === 0 ? <Empty>No customer-success tasks for you.</Empty> : summary.data.myTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                  <div className="min-w-0"><p className="truncate font-medium text-fg">{t.title}</p>{t.network_id && <Link to={`/admin/networks/${t.network_id}?tab=Account`} className="text-tiny text-fg-muted hover:underline">{t.network_name}</Link>}</div>
                  <span className={`shrink-0 text-tiny ${isOverdue(t.due_at) ? 'font-medium text-danger-text' : 'text-fg-muted'}`}>{t.due_at ? relTime(t.due_at) : 'no date'}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Latest notes">
              {summary.data.notes.length === 0 ? <Empty>No notes yet.</Empty> : summary.data.notes.map((n) => (
                <div key={n.id} className="px-4 py-2.5 text-small">
                  <p className="line-clamp-2 text-fg">{n.body}</p>
                  <p className="text-tiny text-fg-muted"><Link to={`/admin/networks/${n.network_id}?tab=Account`} className="hover:underline">{n.network_name}</Link> · {n.author_name ?? 'someone'} · {relTime(n.created_at)}</p>
                </div>
              ))}
            </Panel>
          </div>
        </>
      )}

      <h2 className="mb-3 mt-8 text-small font-semibold uppercase tracking-wide text-fg-secondary">Accounts</h2>
      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search name or slug…" value={q} onChange={(e) => filter(() => setQ(e.target.value))} />
        <select className="input !w-auto" value={status} onChange={(e) => filter(() => setStatus(e.target.value))} aria-label="Health">
          <option value="">Any health</option><option value="at_risk">At risk</option><option value="attention">Needs attention</option><option value="healthy">Healthy</option><option value="unscored">Not scored yet</option>
        </select>
        <select className="input !w-auto" value={manager} onChange={(e) => filter(() => setManager(e.target.value))} aria-label="Account manager">
          <option value="">Any account manager</option><option value="me">Mine</option><option value="unassigned">Unassigned</option>
          {(staff.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
        </select>
        {(tags.data ?? []).length > 0 && (
          <select className="input !w-auto" value={tag} onChange={(e) => filter(() => setTag(e.target.value))} aria-label="Tag">
            <option value="">Any tag</option>
            {(tags.data ?? []).map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
          </select>
        )}
        <select className="input !w-auto" value={sort} onChange={(e) => filter(() => setSort(e.target.value))} aria-label="Sort">
          <option value="score">Worst health first</option><option value="score_desc">Best health first</option><option value="drop">Biggest drop</option>
          <option value="onboarding">Least set up</option><option value="last_login">Longest since sign-in</option><option value="name">Name A–Z</option>
        </select>
      </div>
      {accounts.loading && !accounts.data ? <StateBlock><Spinner /></StateBlock>
        : accounts.error ? <StateBlock>{accounts.error}</StateBlock>
        : (accounts.data ?? []).length === 0 ? <StateBlock>No account matches.</StateBlock>
        : <>
          <Table columns={columns} rows={accounts.data ?? []} rowKey={(r) => r.id} />
          <Pager offset={offset} limit={LIMIT} total={totalOf(accounts.data)} onChange={setOffset} />
        </>}
    </>
  );
}
