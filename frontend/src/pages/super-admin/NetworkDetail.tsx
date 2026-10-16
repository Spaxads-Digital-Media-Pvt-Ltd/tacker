/**
 * Super Admin › Networks › one network, in tabs (?tab=…): Overview — who it is and who owns it, its plan and
 * this period's usage against it, its tracking domains; Account — its health, onboarding, account manager,
 * tags, notes and tasks (success/NetworkAccount.tsx); Billing — its invoices; Team — a temporary password for
 * a member who can't get in; Activity — what Super Admins did to it. "Open dashboard": a 30-minute support
 * session as its admin, in a new tab, every change recorded under the Super Admin.
 */
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { useSupportSession } from '../../lib/impersonation';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { PageHeader, Table, Badge, Modal, Spinner, StateBlock, Tabs, type Column } from '../../shared-components/primitives/ui';
import { PlanLimitBars } from '../../shared-components/panels/PlanLimitBars';
import { activityLabel } from '../../lib/platformActivity';
import { usePlatformMe } from '../../lib/platformMe';
import { useAllPages } from '../../hooks/useAllPages';
import { useInvoiceActions } from './invoiceActions';
import { NewInvoice } from './Billing';
import { AssignPlanModal, ExtendTrialModal } from './subscriptionActions';
import { money as amountMoney, planPrice, billingBadge, invoiceState, type PlatformInvoice } from '../../lib/platformBilling';
import type { NetworkDetail as Detail, NetworkTeamMember, PlatformActivityRow } from '../../types';
import { NetworkAccount } from './success/NetworkAccount';

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const actionLabel = (a: PlatformActivityRow) => activityLabel(a.action);

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-h3 font-medium text-fg">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-border py-2 text-small last:border-0">
      <dt className="w-40 shrink-0 text-fg-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-medium text-fg">{children}</dd>
    </div>
  );
}

export default function NetworkDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const net = useQuery<Detail>(`/platform/networks/${id}`);
  const team = useQuery<NetworkTeamMember[]>(`/platform/networks/${id}/users`);
  const activity = useQuery<PlatformActivityRow[]>(`/platform/networks/${id}/activity?limit=50`);
  const support = useSupportSession();
  const confirm = useConfirm();
  const [temp, setTemp] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const tempPassword = useMutation((userId: string) =>
    api.post<{ email: string; temporaryPassword: string }>(`/platform/networks/${id}/users/${userId}/temporary-password`, {}));
  const invoices = useAllPages<PlatformInvoice>(`/platform/invoices?networkId=${id}&status=all`);
  const invoiceActions = useInvoiceActions(() => { invoices.refetch(); net.refetch(); activity.refetch(); });
  const [planModal, setPlanModal] = useState(false);
  const [trialModal, setTrialModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { can } = usePlatformMe();
  const [params, setParams] = useSearchParams();
  const canManage = can('networks', 'full');
  const canAccess = can('access', 'full');
  const canPlans = can('plans', 'full');
  const canBilling = can('billing', 'full');

  if (net.loading) return <StateBlock><Spinner /></StateBlock>;
  if (net.error || !net.data) return <StateBlock>{net.error ?? 'Network not found'}</StateBlock>;
  const n = net.data;
  const refreshAll = () => { net.refetch(); activity.refetch(); invoices.refetch(); };
  const sub = n.subscription;
  const live = Boolean(sub && ['trialing', 'active', 'past_due'].includes(sub.status));
  const done = (msg: string) => { setPlanModal(false); setTrialModal(false); setNewInvoice(false); setNotice(msg); refreshAll(); };
  const subscriptionAction = (path: 'cancel' | 'resume', body: Record<string, unknown>, title: string, message: string, label: string, destructive: boolean) => confirm({
    title, message, confirmLabel: label, destructive,
    onConfirm: async () => { await api.post(`/platform/networks/${n.id}/subscription/${path}`, body); setNotice(null); refreshAll(); },
  });

  const setStatus = (status: 'active' | 'suspended', verb: string, message: string) => confirm({
    title: `${verb} ${n.name}?`, message, confirmLabel: verb, destructive: status === 'suspended',
    onConfirm: async () => { await api.patch(`/platform/networks/${n.id}`, { status }); refreshAll(); },
  });
  const giveTemporaryPassword = (m: NetworkTeamMember) => confirm({
    title: `New temporary password for ${m.email}?`, confirmLabel: 'Set temporary password',
    message: 'Their current password stops working and they are signed out everywhere. You get the temporary password once, here — pass it to them; they choose their own at their next sign-in.',
    onConfirm: async () => {
      const r = await tempPassword.runOrThrow(m.id);
      setTemp(r);
      activity.refetch();
    },
  });

  const teamCols: Column<NetworkTeamMember>[] = [
    { header: 'Member', cell: (m) => <div><p className="font-medium">{m.name ?? m.email}</p>{m.name && <p className="text-tiny text-fg-muted">{m.email}</p>}</div> },
    { header: 'Role', cell: (m) => <span className="capitalize">{m.role.replace('_', ' ')}</span> },
    { header: 'Status', cell: (m) => <Badge value={m.status} /> },
    { header: 'Last sign-in', cell: (m) => (m.last_sign_in_at ? when(m.last_sign_in_at) : <span className="text-fg-muted">never</span>) },
    {
      header: '', className: 'text-right',
      cell: (m) => (m.has_login && canAccess
        ? <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => giveTemporaryPassword(m)}>Temporary password</button>
        : m.has_login ? null : <span className="text-tiny text-fg-muted">no login yet</span>),
    },
  ];
  const tabs = ['Overview', ...(can('success') ? ['Account'] : []), ...(can('billing') ? ['Billing'] : []), 'Team', 'Activity'];
  const tab = tabs.includes(params.get('tab') ?? '') ? params.get('tab')! : 'Overview';
  const setTab = (t: string) => setParams(t === 'Overview' ? {} : { tab: t }, { replace: true });
  const activityCols: Column<PlatformActivityRow>[] = [
    { header: 'When', cell: (a) => when(a.created_at) },
    { header: 'What', cell: (a) => <span>{actionLabel(a)}{a.in_support_session && <span className="ml-2 text-tiny text-fg-muted">in a support session</span>}</span> },
    { header: 'By', cell: (a) => a.admin_email ?? <span className="text-fg-muted">—</span> },
  ];

  return (
    <>
      <PageHeader
        title={n.name}
        subtitle={`Network · ${n.slug}`}
        action={
          <>
            <Link to="/admin/networks" className="btn-ghost">All networks</Link>
            {n.status === 'active' && canManage && (
              <button className="btn-ghost text-danger-text" onClick={() => setStatus('suspended', 'Suspend',
                'Tracking, the dashboard, the portals and the API stop until you activate it again. Nothing is deleted.')}>Suspend</button>
            )}
            {n.status === 'suspended' && canManage && (
              <button className="btn-ghost" onClick={() => setStatus('active', 'Activate', 'Tracking, the dashboard, the portals and the API work again.')}>Activate</button>
            )}
            {n.status === 'active' && canAccess && (
              <button className="btn-primary" disabled={support.busy} onClick={() => void support.start(n.id)}
                title="Opens a new tab as this network's admin for 30 minutes — every change is recorded under you">
                {support.busy ? 'Opening…' : 'Open dashboard'}
              </button>
            )}
          </>
        }
      />
      {support.error && <p className="mb-3 text-small text-danger-text">{support.error}</p>}
      {n.status !== 'active' && (
        <p className="mb-4 rounded-[var(--radius)] bg-warning-bg px-4 py-3 text-small text-warning-text">
          {n.status === 'deleted'
            ? `Deleted ${day(n.deleted_at)} — tracking, the dashboard and the API are off. It can be restored until ${day(n.purge_after)} (Networks › Restore).`
            : n.suspended_reason === 'billing'
              ? 'Suspended for an unpaid invoice — tracking, the dashboard, the portals and the API are off. Record the payment or give more time (Invoices below) and it comes back at once.'
              : 'Suspended — tracking, the dashboard, the portals and the API are off until you activate it.'}
        </p>
      )}

      {notice && <p className="mb-4 rounded-[var(--radius)] bg-page px-4 py-3 text-small text-fg-secondary ring-1 ring-inset ring-border">{notice}</p>}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'Overview' && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Overview">
          <dl>
            <InfoRow label="Status"><Badge value={n.status} /></InfoRow>
            <InfoRow label="Slug"><span className="font-mono text-xs">{n.slug}</span></InfoRow>
            <InfoRow label="Default currency">{n.default_currency}</InfoRow>
            <InfoRow label="Created">{day(n.created_at)}</InfoRow>
            <InfoRow label="Owner">
              {n.owner ? <>{n.owner.email}<span className="ml-2 text-tiny font-normal text-fg-muted">last sign-in {n.owner.last_sign_in_at ? when(n.owner.last_sign_in_at) : 'never'}</span></>
                : <span className="text-fg-muted">no admin yet</span>}
            </InfoRow>
            <InfoRow label="Size">
              {n.counts.users} team · {n.counts.offers} offers · {n.counts.partners} partners · {n.counts.advertisers} advertisers
            </InfoRow>
            <InfoRow label="Tracking domains">
              {n.trackingDomains.length === 0 ? <span className="text-fg-muted">none</span> : (
                <ul className="space-y-1">
                  {n.trackingDomains.map((t) => (
                    <li key={t.host} className="flex items-center gap-2">
                      <span className="font-mono text-xs">{t.host}</span>
                      <Badge value={t.status} />
                      {t.is_primary && <span className="text-tiny text-fg-muted">primary</span>}
                    </li>
                  ))}
                </ul>
              )}
            </InfoRow>
          </dl>
        </Card>

        <Card title="Plan & usage" action={n.status !== 'deleted' && canPlans && (
          <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => { setNotice(null); setPlanModal(true); }}>{live ? 'Change plan' : 'Assign plan'}</button>
        )}>
          {sub ? (
            <dl className="mb-3">
              <InfoRow label="Plan">{sub.plan_name} <span className="text-tiny font-normal text-fg-muted">{planPrice(sub)}</span></InfoRow>
              <InfoRow label="Subscription">
                <Badge {...billingBadge(sub.status)} />
                {sub.cancel_at_period_end && <span className="ml-2 text-tiny font-normal text-fg-muted">ends at the period end</span>}
              </InfoRow>
              {sub.status === 'trialing' && <InfoRow label="Trial ends">{day(sub.trial_ends_at)}</InfoRow>}
              {sub.status === 'canceled'
                ? <InfoRow label="Ended">{day(sub.canceled_at)}</InfoRow>
                : <InfoRow label={sub.status === 'trialing' ? 'Trial period' : 'Current period'}>{day(sub.current_period_start)} – {day(sub.current_period_end)}</InfoRow>}
            </dl>
          ) : <p className="mb-3 text-small text-fg-secondary">No plan assigned.</p>}
          {live && sub && canPlans && (
            <div className="mb-4 flex flex-wrap gap-3">
              {sub.status === 'trialing' && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setTrialModal(true)}>Extend trial</button>}
              {sub.cancel_at_period_end
                ? <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => subscriptionAction('resume', {}, 'Resume the subscription?', 'It renews at the period end again, invoiced as usual.', 'Resume', false)}>Resume</button>
                : <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => subscriptionAction('cancel', { atPeriodEnd: true }, 'Cancel at the period end?', `It runs until ${day(sub.current_period_end)}, then ends — no renewal invoice.`, 'Cancel at period end', true)}>Cancel at period end</button>}
              <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => subscriptionAction('cancel', { atPeriodEnd: false }, 'Cancel now?', 'The subscription ends now (no more invoices). Open invoices stay — void them if they are waived. The network itself keeps running; suspend it separately if needed.', 'Cancel now', true)}>Cancel now</button>
            </div>
          )}
          <p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">This period · {day(n.usage.period.start)} – {day(n.usage.period.end)}</p>
          {n.usage.limits.length === 0
            ? <p className="mt-2 text-small text-fg-secondary">{n.usage.plan ? 'Its plan sets no limits.' : 'Usage is compared with a plan’s limits once one is assigned.'}</p>
            : <PlanLimitBars limits={n.usage.limits} />}
        </Card>
      </div>}

      {tab === 'Account' && <NetworkAccount networkId={n.id} networkName={n.name} />}

      <div className="space-y-4">
        {tab === 'Billing' && <Card title="Invoices" action={n.status !== 'deleted' && canBilling && (
          <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setNewInvoice(true)}>New invoice</button>
        )}>
          {invoiceActions.notice && <p className="mb-2 text-small text-fg-secondary">{invoiceActions.notice}</p>}
          {invoices.loading ? <Spinner /> : invoices.error ? <p className="text-small text-danger-text">{invoices.error}</p>
            : (invoices.data ?? []).length === 0 ? <p className="text-small text-fg-secondary">No invoices yet.</p>
            : <Table columns={[
              { header: 'Invoice', cell: (i: PlatformInvoice) => <Link to={`/admin/invoices/${i.id}`} className="font-mono text-xs hover:underline">{i.number}</Link> },
              { header: 'Description', cell: (i: PlatformInvoice) => <span className="text-small text-fg-secondary">{i.description}</span> },
              { header: 'Total', className: 'text-right', cell: (i: PlatformInvoice) => <span className="whitespace-nowrap">{amountMoney(i.total, i.currency)}</span> },
              { header: 'Due', cell: (i: PlatformInvoice) => day(i.due_at) },
              { header: 'Status', cell: (i: PlatformInvoice) => <Badge {...billingBadge(invoiceState(i))} /> },
              { header: 'Suspends on', cell: (i: PlatformInvoice) => (i.status === 'open' ? day(i.suspend_at) : <span className="text-fg-muted">—</span>) },
              { header: '', className: 'text-right', cell: (i: PlatformInvoice) => invoiceActions.buttons(i) },
            ]} rows={invoices.data ?? []} rowKey={(i) => i.id} />}
        </Card>}
        {tab === 'Team' && <Card title="Team">
          {tempPassword.error && <p className="mb-2 text-small text-danger-text">{tempPassword.error}</p>}
          {team.loading ? <Spinner /> : team.error ? <p className="text-small text-danger-text">{team.error}</p>
            : (team.data ?? []).length === 0 ? <p className="text-small text-fg-secondary">No team members.</p>
            : <Table columns={teamCols} rows={team.data ?? []} rowKey={(m) => m.id} />}
        </Card>}
        {tab === 'Activity' && <Card title="Super Admin activity">
          {activity.loading ? <Spinner /> : activity.error ? <p className="text-small text-danger-text">{activity.error}</p>
            : (activity.data ?? []).length === 0 ? <p className="text-small text-fg-secondary">Nothing yet.</p>
            : <Table columns={activityCols} rows={activity.data ?? []} rowKey={(a) => a.id} />}
        </Card>}
      </div>

      {invoiceActions.modal}
      {planModal && <AssignPlanModal networkId={n.id} networkName={n.name} live={live} currentPlanId={live ? sub?.plan_id ?? null : null} onClose={() => setPlanModal(false)} onDone={done} />}
      {trialModal && <ExtendTrialModal networkId={n.id} onClose={() => setTrialModal(false)} onDone={done} />}
      {newInvoice && <NewInvoice networkId={n.id} onClose={() => setNewInvoice(false)} onCreated={(num) => done(`Invoice ${num} issued.`)} />}
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Temporary password">
        {temp && (
          <div className="space-y-3">
            <p className="text-small text-fg-secondary">For <strong className="text-fg">{temp.email}</strong> — shown only now. They choose their own password at their next sign-in.</p>
            <pre className="overflow-x-auto rounded-[var(--radius)] border border-border bg-page p-3 font-mono text-small text-fg">{temp.temporaryPassword}</pre>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(temp.temporaryPassword)}>Copy</button>
              <button className="btn-primary" onClick={() => setTemp(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
