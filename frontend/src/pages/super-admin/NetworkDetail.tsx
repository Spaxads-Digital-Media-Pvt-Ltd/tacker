/**
 * Super Admin › Networks › one network: who it is and who owns it, its plan and this period's usage
 * against it, its team (a temporary password for a member who can't get in), its tracking domains and
 * what Super Admins did to it — and "Open dashboard": a 30-minute support session as its admin, in a
 * new tab, every change recorded under the Super Admin.
 */
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { useSupportSession } from '../../lib/impersonation';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { PageHeader, Table, Badge, Modal, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import type { NetworkDetail as Detail, NetworkTeamMember, PlatformActivityRow, PlanLimitStatus } from '../../types';

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const money = (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`;
const LIMIT_LABEL: Record<string, string> = { clicks: 'Clicks', conversions: 'Conversions', events: 'Events', offers: 'Offers', seats: 'Team seats' };
const ACTION_LABEL: Record<string, string> = {
  'network.create': 'Created the network',
  'network.update': 'Changed the network',
  'network.delete': 'Deleted the network',
  'network.export': 'Exported the network',
  'network.ledger_export': 'Downloaded the ledger',
  'network.support_session': 'Opened its dashboard (support session)',
  'network.user_temporary_password': 'Set a temporary password',
  'subscription.assign': 'Assigned a plan',
};
const actionLabel = (a: PlatformActivityRow) => ACTION_LABEL[a.action] ?? a.action.replace(/[._]/g, ' ');

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

function LimitBar({ l }: { l: PlanLimitStatus }) {
  const tone = l.state === 'over' ? 'bg-danger' : l.state === 'near' ? 'bg-warning' : 'bg-accent';
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between text-small">
        <span className="text-fg-secondary">{LIMIT_LABEL[l.key] ?? l.key}</span>
        <span className="font-medium text-fg">{l.used.toLocaleString()} / {l.limit.toLocaleString()} <span className="text-tiny text-fg-muted">({l.pct}%)</span></span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, l.pct)}%` }} />
      </div>
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

  if (net.loading) return <StateBlock><Spinner /></StateBlock>;
  if (net.error || !net.data) return <StateBlock>{net.error ?? 'Network not found'}</StateBlock>;
  const n = net.data;
  const refreshAll = () => { net.refetch(); activity.refetch(); };

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
      cell: (m) => (m.has_login
        ? <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => giveTemporaryPassword(m)}>Temporary password</button>
        : <span className="text-tiny text-fg-muted">no login yet</span>),
    },
  ];
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
            {n.status === 'active' && (
              <button className="btn-ghost text-danger-text" onClick={() => setStatus('suspended', 'Suspend',
                'Tracking, the dashboard, the portals and the API stop until you activate it again. Nothing is deleted.')}>Suspend</button>
            )}
            {n.status === 'suspended' && (
              <button className="btn-ghost" onClick={() => setStatus('active', 'Activate', 'Tracking, the dashboard, the portals and the API work again.')}>Activate</button>
            )}
            {n.status === 'active' && (
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
            : 'Suspended — tracking, the dashboard, the portals and the API are off until you activate it.'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

        <Card title="Plan & usage" action={<Link to="/admin/subscriptions" className="text-tiny font-medium text-accent-text hover:underline">Plans</Link>}>
          {n.subscription ? (
            <dl className="mb-3">
              <InfoRow label="Plan">{n.subscription.plan_name} <span className="text-tiny font-normal text-fg-muted">{money(n.subscription.price_cents, n.subscription.currency)}</span></InfoRow>
              <InfoRow label="Subscription"><Badge value={n.subscription.status} /></InfoRow>
              <InfoRow label="Current period">{day(n.subscription.current_period_start)} – {day(n.subscription.current_period_end)}</InfoRow>
            </dl>
          ) : <p className="mb-3 text-small text-fg-secondary">No plan assigned.</p>}
          <p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">This period · {day(n.usage.period.start)} – {day(n.usage.period.end)}</p>
          {n.usage.limits.length === 0
            ? <p className="mt-2 text-small text-fg-secondary">{n.usage.plan ? 'Its plan sets no limits.' : 'Usage is compared with a plan’s limits once one is assigned.'}</p>
            : n.usage.limits.map((l) => <LimitBar key={l.key} l={l} />)}
        </Card>
      </div>

      <div className="mt-4 space-y-4">
        <Card title="Team">
          {tempPassword.error && <p className="mb-2 text-small text-danger-text">{tempPassword.error}</p>}
          {team.loading ? <Spinner /> : team.error ? <p className="text-small text-danger-text">{team.error}</p>
            : (team.data ?? []).length === 0 ? <p className="text-small text-fg-secondary">No team members.</p>
            : <Table columns={teamCols} rows={team.data ?? []} rowKey={(m) => m.id} />}
        </Card>
        <Card title="Super Admin activity">
          {activity.loading ? <Spinner /> : activity.error ? <p className="text-small text-danger-text">{activity.error}</p>
            : (activity.data ?? []).length === 0 ? <p className="text-small text-fg-secondary">Nothing yet.</p>
            : <Table columns={activityCols} rows={activity.data ?? []} rowKey={(a) => a.id} />}
        </Card>
      </div>

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
