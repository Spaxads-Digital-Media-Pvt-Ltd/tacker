/**
 * Super Admin › Trust & safety — fraud across every network: the last 7 days' invalid and rejected clicks per
 * network, the addresses the hourly scan found sending flagged clicks to more than one network (block one
 * platform-wide in a click), the 24-hour rejection reasons, the blocklist's busiest entries and the privacy
 * requests waiting (GET /platform/trust/summary).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Fingerprint, Gauge, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { flagLabel, type TrustSummary, type SuspiciousIp } from '../../../lib/platformTrust';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { BarList, Chip, Empty, KpiTile, MiniStat, Panel } from '../kit';

const int = (n: number) => n.toLocaleString();

export default function TrustOverview() {
  const { can } = usePlatformMe();
  const canEdit = can('trust', 'full');
  const { data: s, loading, error, refetch } = useQuery<TrustSummary>('/platform/trust/summary');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setFailure(null); setNotice(null);
    try { await fn(); setNotice(done); refetch(); } catch (e) { setFailure(e instanceof Error ? e.message : 'That didn’t work'); } finally { setBusy(null); }
  };
  if (loading && !s) return <StateBlock><Spinner /></StateBlock>;
  if (error || !s) return <StateBlock>{error ?? 'Could not load Trust & safety'}</StateBlock>;
  const k = s.kpis;
  const blockIp = (ip: SuspiciousIp) => act(ip.ip, () => api.post('/platform/trust/blocklist', {
    kind: 'ip', value: ip.ip, reason: `Flagged in ${ip.networks.length} networks (${ip.flagged} of ${ip.clicks} clicks, 24 h)`,
  }), `${ip.ip} is blocked for every network from the next click.`);

  return (
    <>
      <PageHeader title="Trust & safety" subtitle="Fraud across every network, the platform blocklist and privacy requests."
        action={(
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/trust/blocklist" className="btn-ghost">Blocklist</Link>
            <Link to="/admin/trust/privacy" className="btn-ghost">Privacy requests</Link>
            {canEdit && <button className="btn-primary" disabled={busy === 'scan'} onClick={() => void act('scan', () => api.post('/platform/trust/scan', {}), 'Scanned the last 24 hours.')}>
              {busy === 'scan' ? 'Scanning…' : 'Scan now'}
            </button>}
          </div>
        )} />
      {notice && <p className="mb-3 text-small text-success-text">{notice}</p>}
      {failure && <p className="mb-3 text-small text-danger-text">{failure}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile label="Invalid clicks · 7 days" icon={ShieldAlert} tone={k.invalidPct >= 20 ? 'danger' : k.invalidPct >= 5 ? 'warning' : 'success'}
          hint={`${int(k.invalid7d)} of ${int(k.clicks7d)} clicks flagged or rejected`}>{k.invalidPct}%</KpiTile>
        <KpiTile label="Rejected · 7 days" icon={Ban} tone="info" hint="Never sent to the offer — blocked, over a cap, not allowed">{int(k.rejected7d)}</KpiTile>
        <KpiTile label="Average fraud score" icon={Gauge} tone={(k.avgScore ?? 0) >= 50 ? 'danger' : (k.avgScore ?? 0) >= 20 ? 'warning' : 'success'} hint="0 is clean, 100 is certain fraud · 7 days">
          {k.avgScore ?? '—'}<span className="text-base font-normal text-fg-secondary"> / 100</span>
        </KpiTile>
        <KpiTile label="Flagged in 2+ networks · 24 h" icon={Fingerprint} tone={s.suspicious.length ? 'danger' : 'success'}
          hint={s.scan ? `Scanned ${relTime(s.scan.computedAt)} · hourly` : 'Not scanned yet — the workers run it hourly'}>{int(s.suspicious.filter((x) => !x.blocked).length)}
          <span className="text-base font-normal text-fg-secondary"> not blocked yet</span></KpiTile>
        <KpiTile label="Platform blocklist" icon={ShieldCheck} to="/admin/trust/blocklist" hint={`${int(s.blocklist.hits)} click(s) blocked since added`}>
          {int(s.blocklist.entries)} <span className="text-base font-normal text-fg-secondary">entries</span>
        </KpiTile>
        <KpiTile label="Privacy requests" icon={Undo2} to="/admin/trust/privacy" tone={s.privacy.overdue ? 'danger' : s.privacy.open ? 'warning' : 'success'}
          hint={`${int(s.privacy.overdue)} overdue · ${int(s.privacy.due_soon)} due this week · ${int(s.privacy.completed_30d)} done in 30 days`}>
          {int(s.privacy.open)} <span className="text-base font-normal text-fg-secondary">open</span>
        </KpiTile>
      </div>

      <div className="mt-4">
        <Panel title="Flagged in more than one network · last 24 hours"
          action={<span className="text-tiny text-fg-muted">Only the platform sees across networks</span>}>
          {s.suspicious.length === 0 ? <Empty>No address sent flagged clicks to more than one network{s.scan ? '' : ' — the first scan runs within the hour'}.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="text-left text-tiny uppercase tracking-wide text-fg-muted">
                    <th className="px-4 py-2 font-medium">Address</th><th className="px-4 py-2 font-medium">Networks</th>
                    <th className="px-4 py-2 font-medium">Flagged</th><th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Why</th><th className="px-4 py-2 font-medium">Last seen</th><th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.suspicious.map((x) => (
                    <tr key={x.ip}>
                      <td className="px-4 py-2.5 font-mono text-fg">{x.ip}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {x.networks.slice(0, 4).map((n) => <Link key={n.id} to={`/admin/networks/${n.id}`} className="rounded bg-page px-1.5 py-0.5 text-tiny text-fg hover:underline">{n.name}</Link>)}
                          {x.networks.length > 4 && <span className="text-tiny text-fg-muted">+{x.networks.length - 4}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-fg">{int(x.flagged)} <span className="text-tiny text-fg-muted">of {int(x.clicks)}</span></td>
                      <td className={`px-4 py-2.5 font-medium ${x.avg_score >= 50 ? 'text-danger-text' : 'text-fg'}`}>{x.avg_score}</td>
                      <td className="px-4 py-2.5 text-tiny text-fg-secondary">{x.top_flags.map(flagLabel).join(' · ') || '—'}</td>
                      <td className="px-4 py-2.5 text-tiny text-fg-muted">{relTime(x.last_seen)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {x.blocked ? <Chip className="bg-success-bg text-success-text">Blocked</Chip>
                          : canEdit && <button className="text-tiny font-medium text-danger-text hover:underline disabled:opacity-50" disabled={busy === x.ip} onClick={() => void blockIp(x)}>
                            {busy === x.ip ? 'Blocking…' : 'Block platform-wide'}
                          </button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Networks by invalid traffic · 7 days" className="xl:col-span-2">
          {s.networks.length === 0 ? <Empty>No traffic in the last 7 days.</Empty> : (
            <BarList format={(v) => `${v}%`} color="bg-warning"
              rows={s.networks.slice(0, 10).map((n) => ({
                key: n.id, value: n.invalidPct,
                label: <Link to={`/admin/networks/${n.id}`} className="hover:underline">{n.name}</Link>,
                hint: `${int(n.invalid)} of ${int(n.clicks)} · ${int(n.rejected)} rejected · score ${n.avgScore ?? '—'}`,
              }))} />
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Why clicks were flagged · 24 h">
            {!s.scan || s.scan.reasons.length === 0 ? <Empty>{s.scan ? 'Nothing flagged in the last 24 hours.' : 'Waiting for the first scan.'}</Empty> : (
              <BarList color="bg-danger" rows={s.scan.reasons.map((r) => ({ key: r.reason, label: flagLabel(r.reason), value: r.clicks }))} />
            )}
          </Panel>
          <Panel title="Most-hit blocks" to="/admin/trust/blocklist" linkLabel="Blocklist">
            {s.blocklist.top.length === 0 ? <Empty>No block has stopped a click yet.</Empty> : (
              <div className="grid grid-cols-1 gap-1 p-2">
                {s.blocklist.top.map((b) => (
                  <MiniStat key={b.id} label={b.kind === 'ip' ? 'IP' : b.kind === 'user_agent' ? 'User agent' : 'Referrer'}
                    value={<span className="font-mono text-small">{b.value}{b.value_to ? ` – ${b.value_to}` : ''}</span>} hint={`${int(b.hits)} click(s) blocked`} />
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
