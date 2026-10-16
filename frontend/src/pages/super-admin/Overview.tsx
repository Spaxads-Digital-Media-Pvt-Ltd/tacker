/**
 * Super Admin › Overview — the platform at a glance (GET /platform/summary): networks by status,
 * subscriptions, monthly recurring revenue and billing per currency (never summed across currencies),
 * the last 24 hours' traffic, and what needs attention — overdue invoices (and the networks they suspend),
 * trials ending this week, plan limits reached — plus what Super Admins did lately.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { money, day, type InvoiceSummaryRow } from '../../lib/platformBilling';
import { activityLabel } from '../../lib/platformActivity';

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
}

const int = (n: number) => n.toLocaleString();

function Tile({ label, children, hint, to }: { label: string; children: ReactNode; hint?: ReactNode; to?: string }) {
  const body = (
    <div className="card h-full transition-colors hover:border-slate-400/50">
      <p className="text-small font-medium text-fg-secondary">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-fg">{children}</div>
      {hint && <p className="mt-1 text-tiny text-fg-muted">{hint}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

function Panel({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-h3 font-medium text-fg">{title}</h3>
        {to && <Link to={to} className="text-tiny font-medium text-accent-text hover:underline">View all</Link>}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-3 text-small text-fg-secondary">{children}</p>;
/** One line per currency — amounts are never summed across currencies. */
function PerCurrency<T extends { currency: string }>({ rows, render, none = '—' }: { rows: T[]; render: (r: T) => ReactNode; none?: string }) {
  return rows.length === 0 ? <span>{none}</span> : <div className="space-y-0.5">{rows.map((r) => <div key={r.currency}>{render(r)}</div>)}</div>;
}

export default function Overview() {
  const { data: s, loading, error } = useQuery<Summary>('/platform/summary');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !s) return <StateBlock>{error ?? 'Could not load the overview'}</StateBlock>;
  const billing = s.billing ?? [];
  const overdueCount = billing.reduce((n, b) => n + b.overdue_count, 0);

  return (
    <>
      <PageHeader title="Overview" subtitle="The platform at a glance." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Networks" to="/admin/networks"
          hint={<>{int(s.networks.suspended)} suspended{s.networks.suspended_for_billing ? ` (${int(s.networks.suspended_for_billing)} for billing)` : ''} · {int(s.networks.new_this_month)} new this month</>}>
          {int(s.networks.active)} <span className="text-base font-normal text-fg-secondary">active of {int(s.networks.total - s.networks.deleted)}</span>
        </Tile>
        <Tile label="Subscriptions" to="/admin/plans"
          hint={<>{int(s.subscriptions.trialing)} in trial · {int(s.subscriptions.past_due)} past due · {int(s.subscriptions.without_plan)} without a plan</>}>
          {int(s.subscriptions.active + s.subscriptions.past_due)} <span className="text-base font-normal text-fg-secondary">paying</span>
        </Tile>
        {s.mrr && (
          <Tile label="MRR" to="/admin/revenue" hint="Monthly recurring revenue — paying plans, a yearly price as a twelfth">
            <PerCurrency rows={s.mrr} render={(m) => money(m.amount, m.currency)} none="None yet" />
          </Tile>
        )}
        {s.billing && <>
          <Tile label="Overdue" to="/admin/billing" hint={`${int(overdueCount)} invoice(s) past their due date`}>
            <PerCurrency rows={billing.filter((b) => b.overdue_count > 0)} render={(b) => <span className="text-danger-text">{money(b.overdue_total, b.currency)}</span>} none="Nothing overdue" />
          </Tile>
          <Tile label="Collected this month" to="/admin/billing" hint="Payments recorded this month">
            <PerCurrency rows={billing.filter((b) => Number(b.collected_this_month) > 0)} render={(b) => money(b.collected_this_month, b.currency)} none="None yet" />
          </Tile>
        </>}
        <Tile label="Traffic (24h)" hint="Platform-wide clicks and conversions">
          {int(s.traffic.clicks24h)} <span className="text-base font-normal text-fg-secondary">clicks · {int(s.traffic.conversions24h)} conversions</span>
        </Tile>
      </div>

      <h2 className="mb-3 mt-8 text-small font-semibold uppercase tracking-wide text-fg-secondary">Needs attention</h2>
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
        <Panel title="Plan limits" to="/admin/usage">
          {s.limitAlerts.length === 0 ? <Empty>No network is near its plan’s limits.</Empty> : s.limitAlerts.map((a) => (
            <div key={`${a.network_id}-${a.title}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
              <Link to={`/admin/networks/${a.network_id}`} className="font-medium text-fg hover:underline">{a.network_name}</Link>
              <span className={`text-tiny ${a.type === 'plan_limit_reached' ? 'font-medium text-danger-text' : 'text-warning-text'}`}>{a.title}</span>
            </div>
          ))}
        </Panel>
      </div>

      {s.recentActivity && <div className="mt-4">
        <Panel title="Recent Super Admin activity" to="/admin/activity">
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
        </Panel>
      </div>}
    </>
  );
}
