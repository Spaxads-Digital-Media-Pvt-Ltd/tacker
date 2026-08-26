import { Spinner } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { useQuery } from '../../../lib/useApi';

interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }
const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
const num = (v: string | number | undefined) => new Intl.NumberFormat('en-US').format(Number(v ?? 0));

function todayIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/** "Reporting Data" is real (same per-publisher report endpoint as the General tab's Stats card).
 * Login history has no backend — no auth-event log exists — so those two panels stay static shells. */
export function PlatformUsageTab({ publisherId }: { publisherId: string }) {
  const statsPath = `/api/reports?publisherId=${publisherId}&metrics=clicks,conversions,revenue,payout,margin,cr&from=${encodeURIComponent(todayIso(30))}&to=${encodeURIComponent(todayIso(0))}`;
  const stats = useQuery<AggResult>(statsPath);
  const statsRow = stats.data?.rows[0]?.metrics;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="card !p-0">
        <div className="border-b border-border px-4 py-3"><h3 className="text-h3 font-medium text-fg">Recent Logins</h3></div>
        <div className="p-4"><EmptyShellTable search={false} columns={['Login Time', 'User', 'IP', 'Location', 'Device Type', 'Browser']} /></div>
      </div>
      <div className="card !p-0">
        <div className="border-b border-border px-4 py-3"><h3 className="text-h3 font-medium text-fg">Daily Logins</h3></div>
        <div className="p-4"><EmptyShellTable search={false} columns={['Date', 'Logins']} /></div>
      </div>
      <div className="card !p-0 xl:col-span-2">
        <div className="border-b border-border px-4 py-3"><h3 className="text-h3 font-medium text-fg">Reporting Data (last 30 days)</h3></div>
        <div className="p-4">
          {stats.loading ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-small">
                <thead className="text-tiny uppercase text-fg-muted"><tr>
                  <th className="py-2 pr-4">Revenue</th><th className="py-2 pr-4">Payout</th><th className="py-2 pr-4">Margin</th>
                  <th className="py-2 pr-4">Clicks</th><th className="py-2 pr-4">CV</th><th className="py-2">CVR</th>
                </tr></thead>
                <tbody><tr className="font-semibold text-fg">
                  <td className="py-2 pr-4">{money(statsRow?.revenue)}</td>
                  <td className="py-2 pr-4">{money(statsRow?.payout)}</td>
                  <td className="py-2 pr-4">{money(statsRow?.margin)}</td>
                  <td className="py-2 pr-4">{num(statsRow?.clicks)}</td>
                  <td className="py-2 pr-4">{num(statsRow?.conversions)}</td>
                  <td className="py-2">{statsRow?.cr ?? 0}%</td>
                </tr></tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
