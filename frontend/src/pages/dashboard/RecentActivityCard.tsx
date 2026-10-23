/**
 * Recent changes — the network's latest audit-log entries (GET /api/audit-log?limit=5), refreshed
 * every 30 s while the tab is visible (data.ts useRecentChanges). Labelled "Recent changes", not
 * "Live": it is a periodic refresh, not a stream.
 */
import { Link } from 'react-router-dom';
import { formatDateTime, browserTimeZone, timeAgo } from '../../lib/datetime';
import { useRecentChanges, type AuditRow } from './data';
import { SectionBody, SectionCard, StaleNote } from './parts';

/** "Offer created" / "Partner updated" — from the row's service + method. */
function activity(r: AuditRow): string {
  if (r.isNew) return `${r.service} created`;
  if (r.method === 'PATCH') return `${r.service} updated`;
  if (r.method === 'DELETE') return `${r.service} deleted`;
  if (r.method === 'Scheduled Action') return `${r.service} (scheduled)`;
  return r.service;
}

export function RecentActivityCard() {
  const q = useRecentChanges();
  const rows = q.data ?? [];
  const tz = browserTimeZone();
  return (
    <SectionCard title="Recent changes" subtitle="Refreshes every 30 s while this tab is open">
      {/* A background poll refreshes silently — only the first load shows a skeleton. */}
      <SectionBody loading={q.loading && !q.data} error={q.error} onRetry={q.refetch} empty={!q.data || rows.length === 0 && !q.error}
        emptyTitle="No changes yet" emptyHint="Edits to offers, partners and settings will appear here." rows={5}>
        <table className="w-full text-small">
          <caption className="sr-only">Recent changes</caption>
          <thead>
            <tr className="border-b border-border text-left text-tiny font-semibold uppercase tracking-wide text-fg-muted">
              <th scope="col" className="pb-2 pr-3">Activity</th>
              <th scope="col" className="hidden pb-2 pr-3 sm:table-cell">Details</th>
              <th scope="col" className="pb-2 pr-3">By</th>
              <th scope="col" className="pb-2 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5 pr-3 font-medium text-fg">{activity(r)}</td>
                <td className="hidden py-2.5 pr-3 text-fg-secondary sm:table-cell">{r.method} · {r.portal}</td>
                <td className="max-w-[10rem] truncate py-2.5 pr-3 text-fg-secondary" title={r.employee}>{r.employee}</td>
                <td className="whitespace-nowrap py-2.5 text-right tabular-nums text-fg-muted">
                  <time dateTime={r.operationTime} title={formatDateTime(r.operationTime, tz)}>{timeAgo(r.operationTime)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-auto flex justify-end pt-3">
          <Link to="/app/control-center/accounts?view=history" className="text-small font-semibold text-accent-text hover:underline">View all</Link>
        </div>
        <StaleNote error={q.data ? q.error : null} onRetry={q.refetch} />
      </SectionBody>
    </SectionCard>
  );
}
