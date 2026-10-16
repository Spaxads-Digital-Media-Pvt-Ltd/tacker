/**
 * A plan's limits this billing period (lib/usage/meter.ts): used vs limit as a bar — amber from 80 %,
 * red at 100 %. Flagged, never blocked. Super Admin › network page and the network's Settings › Billing.
 */
import type { PlanLimitStatus } from '../../types';

const LIMIT_LABEL: Record<string, string> = { clicks: 'Clicks', conversions: 'Conversions', events: 'Events', offers: 'Offers', seats: 'Team seats' };

export function PlanLimitBar({ l }: { l: PlanLimitStatus }) {
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

export function PlanLimitBars({ limits }: { limits: PlanLimitStatus[] }) {
  return <>{limits.map((l) => <PlanLimitBar key={l.key} l={l} />)}</>;
}
