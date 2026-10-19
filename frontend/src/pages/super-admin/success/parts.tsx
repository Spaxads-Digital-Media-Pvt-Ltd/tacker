/** Health score pieces the Customer success pages share: the score chip, its bar, the 7-day change. */
import { HEALTH, type HealthStatus } from '../../../lib/platformSuccess';
import { Chip } from '../kit';

export function HealthChip({ score, status }: { score: number | null; status: HealthStatus | null }) {
  if (score === null || !status) return <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">Not scored yet</Chip>;
  return <Chip className={HEALTH[status].chip}>{score} · {HEALTH[status].label}</Chip>;
}

export function HealthBar({ score, status, className = 'w-24' }: { score: number | null; status: HealthStatus | null; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full bg-page ${className}`} title={score === null ? 'Not scored yet' : `${score} / 100`}>
      {score !== null && status && <div className={`h-1.5 rounded-full ${HEALTH[status].bar}`} style={{ width: `${Math.max(3, score)}%` }} />}
    </div>
  );
}

/** The score now against 7 days ago: ▲ 8 / ▼ 12 / — */
export function ScoreDelta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return <span className="text-tiny text-fg-muted">—</span>;
  const d = now - before;
  if (d === 0) return <span className="text-tiny text-fg-muted">±0</span>;
  return <span className={`text-tiny font-medium ${d > 0 ? 'text-success-text' : 'text-danger-text'}`} title="Against 7 days ago">{d > 0 ? '▲' : '▼'} {Math.abs(d)}</span>;
}
