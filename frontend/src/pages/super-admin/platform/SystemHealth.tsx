/**
 * Super Admin › Platform › System health — is everything running: this server, Postgres (round trip, pool,
 * connections, size, the latest migration, the largest tables), Redis, and every background queue (waiting,
 * active, delayed, failed, workers listening, the last job finished, its schedule). Failed jobs: see why, retry
 * or clear them. Refreshes every 30 seconds.
 */
import { useEffect, useState } from 'react';
import { Activity, Database, Server, Zap } from 'lucide-react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { PageHeader, Modal, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Chip, KpiTile, Panel } from '../kit';

interface QueueRow {
  name: string; counts: Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed' | 'paused', number> | null; workers: number;
  lastFinishedAt: string | null; schedules: { every: number | null; pattern: string | null; next: string | null }[]; error: string | null;
}
interface System {
  server: { version: string; node: string; uptimeSeconds: number; env: string; now: string; memoryMb: number };
  database: { ok: boolean; roundTripMs: number; error: string | null; pool: { total: number; idle: number; waiting: number }; connections: { used: number; max: string } | null;
    size: string | null; latestMigration: { name: string; run_on: string } | null; largestTables: { table: string; size: string; rows: string }[] };
  redis: { ok: boolean; roundTripMs: number; error: string | null; version?: string; memory?: string; clients?: number; uptimeDays?: number };
  queues: QueueRow[];
}
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);
const every = (ms: number | null) => (!ms ? '' : ms < 60_000 ? `every ${ms / 1000} s` : ms < 3_600_000 ? `every ${ms / 60_000} min` : `every ${ms / 3_600_000} h`);

export default function SystemHealth() {
  const canEdit = usePlatformMe().can('platform', 'full');
  const sys = useQuery<System>('/platform/system');
  const [failed, setFailed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { refetch } = sys;
  useEffect(() => { const t = setInterval(refetch, 30_000); return () => clearInterval(t); }, [refetch]);
  const act = async (name: string, what: 'retry-failed' | 'clean-failed') => {
    setNote(null);
    try {
      const r = await api.post<{ retried?: number; removed?: number }>(`/platform/system/queues/${name}/${what}`, {});
      setNote(what === 'retry-failed' ? `${name}: ${r.retried} job(s) retried.` : `${name}: ${r.removed} failed job(s) cleared.`);
      sys.refetch();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Failed'); }
  };
  if (sys.loading && !sys.data) return <StateBlock><Spinner /></StateBlock>;
  if (sys.error || !sys.data) return <StateBlock>{sys.error ?? 'Could not load the system status'}</StateBlock>;
  const s = sys.data;
  const failing = s.queues.filter((q) => (q.counts?.failed ?? 0) > 0).length;
  // No worker matters only when the queue has work or a schedule (an unused queue is just idle).
  const hasWork = (q: QueueRow) => (q.counts?.waiting ?? 0) + (q.counts?.delayed ?? 0) > 0 || q.schedules.length > 0;
  const idle = s.queues.filter((q) => q.workers === 0 && hasWork(q)).length;

  return (
    <>
      <PageHeader title="System health" subtitle="The servers, the database, Redis and every background queue."
        action={<button className="btn-ghost" onClick={() => sys.refetch()}>{sys.loading ? 'Refreshing…' : 'Refresh'}</button>} />
      {note && <p className="mb-3 text-small text-fg-secondary">{note}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="This server" icon={Server} tone="info" hint={`Node ${s.server.node} · ${s.server.env} · ${s.server.memoryMb} MB · up ${uptime(s.server.uptimeSeconds)}`}>v{s.server.version}</KpiTile>
        <KpiTile label="Postgres" icon={Database} tone={s.database.ok ? 'success' : 'danger'}
          hint={s.database.ok ? `${s.database.connections ? `${s.database.connections.used} of ${s.database.connections.max} connections · ` : ''}${s.database.size ?? ''}` : s.database.error ?? ''}>
          {s.database.ok ? `${s.database.roundTripMs} ms` : 'Down'}
        </KpiTile>
        <KpiTile label="Redis" icon={Zap} tone={s.redis.ok ? 'success' : 'danger'} hint={s.redis.ok ? `v${s.redis.version} · ${s.redis.memory} · ${s.redis.clients} clients` : s.redis.error ?? ''}>
          {s.redis.ok ? `${s.redis.roundTripMs} ms` : 'Down'}
        </KpiTile>
        <KpiTile label="Background queues" icon={Activity} tone={failing || idle ? 'warning' : 'success'}
          hint={`${failing} with failed jobs · ${idle} with work but no worker`}>{idle || failing ? 'Needs a look' : 'All running'}</KpiTile>
      </div>

      <Panel title="Queues" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead className="text-tiny uppercase tracking-wide text-fg-secondary">
              <tr className="border-b border-border">{['Queue', 'Waiting', 'Active', 'Delayed', 'Failed', 'Workers', 'Last job done', 'Schedule', ''].map((h) => <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {s.queues.map((q) => (
                <tr key={q.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-tiny text-fg">{q.name}{q.error && <p className="font-sans text-danger-text">{q.error}</p>}</td>
                  <td className="px-4 py-2">{q.counts?.waiting ?? '—'}</td>
                  <td className="px-4 py-2">{q.counts?.active ?? '—'}</td>
                  <td className="px-4 py-2">{q.counts?.delayed ?? '—'}</td>
                  <td className="px-4 py-2">{q.counts?.failed ? <button className="font-medium text-danger-text hover:underline" onClick={() => setFailed(q.name)}>{q.counts.failed}</button> : 0}</td>
                  <td className="px-4 py-2">{q.workers ? <Chip className="bg-success-bg text-success-text">{q.workers}</Chip>
                    : hasWork(q) ? <Chip className="bg-warning-bg text-warning-text">none</Chip> : <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">unused</Chip>}</td>
                  <td className="px-4 py-2 text-fg-secondary">{q.lastFinishedAt ? relTime(q.lastFinishedAt) : '—'}</td>
                  <td className="px-4 py-2 text-tiny text-fg-secondary">{q.schedules.map((x) => (x.pattern ?? every(x.every))).filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {canEdit && (q.counts?.failed ?? 0) > 0 && (
                      <span className="flex justify-end gap-3 whitespace-nowrap">
                        <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => void act(q.name, 'retry-failed')}>Retry failed</button>
                        <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => void act(q.name, 'clean-failed')}>Clear</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Database">
          <dl className="space-y-1.5 px-4 py-3 text-small">
            <div className="flex justify-between"><dt className="text-fg-secondary">Latest migration</dt><dd className="font-mono text-tiny text-fg">{s.database.latestMigration?.name ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-secondary">This server’s pool</dt><dd className="text-fg">{s.database.pool.total} open · {s.database.pool.idle} idle · {s.database.pool.waiting} waiting</dd></div>
          </dl>
          {s.database.largestTables.map((t) => (
            <div key={t.table} className="flex justify-between px-4 py-1.5 text-small"><span className="font-mono text-tiny text-fg">{t.table}</span><span className="text-fg-secondary">{t.size} · ~{Number(t.rows).toLocaleString()} rows</span></div>
          ))}
        </Panel>
        <Panel title="Checked">
          <p className="px-4 py-3 text-small text-fg-secondary">{new Date(s.server.now).toLocaleString()} — refreshes every 30 seconds. A queue without a worker means the workers process isn’t running (start it with <code className="font-mono">npm run dev</code> or the workers service).</p>
        </Panel>
      </div>
      {failed && <FailedJobs queue={failed} onClose={() => setFailed(null)} />}
    </>
  );
}

function FailedJobs({ queue, onClose }: { queue: string; onClose: () => void }) {
  const jobs = useQuery<{ id: string; name: string; failedReason: string; attemptsMade: number; failedAt: string | null }[]>(`/platform/system/queues/${queue}/failed`);
  return (
    <Modal open size="xl" onClose={onClose} title={`Failed jobs · ${queue}`}>
      {jobs.loading ? <Spinner /> : jobs.error ? <p className="text-small text-danger-text">{jobs.error}</p> : (
        <div className="space-y-2">
          {(jobs.data ?? []).map((j) => (
            <div key={j.id} className="rounded-[var(--radius)] border border-border px-3 py-2 text-small">
              <p className="font-mono text-tiny text-fg-muted">{j.name} · #{j.id} · {j.attemptsMade} attempt(s){j.failedAt ? ` · ${relTime(j.failedAt)}` : ''}</p>
              <p className="mt-1 break-words text-danger-text">{j.failedReason}</p>
            </div>
          ))}
          {(jobs.data ?? []).length === 0 && <p className="text-small text-fg-secondary">None.</p>}
        </div>
      )}
    </Modal>
  );
}
