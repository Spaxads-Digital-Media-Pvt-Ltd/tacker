/**
 * Super Admin › Usage — every network against its plan's limits this billing period (lib/usage/meter.ts:
 * clicks / conversions / events per period, offers and team seats as counts; amber from 80 %, red at
 * 100 % — flagged, never blocked), plus its last 30 days' clicks and conversions. "Only near or over"
 * narrows it to the networks to talk to about a bigger plan.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import type { PlanLimitStatus } from '../../types';

interface UsageRow {
  id: string;
  name: string;
  status: string;
  plan: { code: string; name: string } | null;
  subscription_status: string | null;
  limits: PlanLimitStatus[];
  worst: 'ok' | 'near' | 'over' | null;
  clicks30d: number;
  conversions30d: number;
}

const LABEL: Record<string, string> = { clicks: 'Clicks', conversions: 'Conversions', events: 'Events', offers: 'Offers', seats: 'Seats' };
const RANK = { over: 0, near: 1, ok: 2 } as const;

function LimitCell({ l }: { l: PlanLimitStatus }) {
  const tone = l.state === 'over' ? 'bg-danger' : l.state === 'near' ? 'bg-warning' : 'bg-accent';
  return (
    <div className="min-w-[8.5rem]">
      <div className="flex justify-between text-tiny"><span className="text-fg-secondary">{LABEL[l.key] ?? l.key}</span><span className="text-fg">{l.pct}%</span></div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-border"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, l.pct)}%` }} /></div>
      <p className="text-tiny text-fg-muted">{l.used.toLocaleString()} / {l.limit.toLocaleString()}</p>
    </div>
  );
}

export default function Usage() {
  const { data, loading, error } = useQuery<UsageRow[]>('/platform/usage');
  const [onlyHot, setOnlyHot] = useState(false);
  const rows = useMemo(() => {
    const all = [...(data ?? [])].sort((a, b) => (RANK[a.worst ?? 'ok'] - RANK[b.worst ?? 'ok']) || a.name.localeCompare(b.name));
    return onlyHot ? all.filter((r) => r.worst === 'near' || r.worst === 'over') : all;
  }, [data, onlyHot]);

  const columns: Column<UsageRow>[] = [
    { header: 'Network', cell: (r) => <Link to={`/admin/networks/${r.id}`} className="font-medium text-fg hover:text-accent-text hover:underline">{r.name}</Link> },
    { header: 'Plan', cell: (r) => (r.plan ? r.plan.name : <span className="text-fg-muted">none</span>) },
    {
      header: 'This period', cell: (r) => (r.limits.length === 0
        ? <span className="text-tiny text-fg-muted">{r.plan ? 'no limits' : '—'}</span>
        : <div className="flex flex-wrap gap-4">{r.limits.map((l) => <LimitCell key={l.key} l={l} />)}</div>),
    },
    { header: 'State', cell: (r) => (r.worst === 'over' ? <Badge value="overdue" label="Over" /> : r.worst === 'near' ? <Badge value="pending" label="Near" /> : r.worst === 'ok' ? <Badge value="active" label="OK" /> : <span className="text-fg-muted">—</span>) },
    { header: 'Clicks (30d)', className: 'text-right', cell: (r) => r.clicks30d.toLocaleString() },
    { header: 'Conversions (30d)', className: 'text-right', cell: (r) => r.conversions30d.toLocaleString() },
  ];

  return (
    <>
      <PageHeader title="Usage" subtitle="Each network against its plan's limits this billing period — flagged, never blocked." />
      <label className="mb-3 flex items-center gap-2 text-small text-fg-secondary">
        <input type="checkbox" className="h-4 w-4 rounded border-border" checked={onlyHot} onChange={(e) => setOnlyHot(e.target.checked)} />
        Only networks near or over a limit
      </label>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : rows.length === 0 ? <StateBlock>{onlyHot ? 'No network is near its plan’s limits.' : 'No networks.'}</StateBlock>
        : <Table columns={columns} rows={rows} rowKey={(r) => r.id} />}
    </>
  );
}
