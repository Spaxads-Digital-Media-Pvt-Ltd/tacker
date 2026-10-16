/**
 * Building blocks for the Super Admin panels (Overview, Sales, Customer success, Support, Revenue): KPI tiles
 * (an icon, a value, a hint, a link), panels with a "View all" link, amounts per currency (never summed
 * across currencies), a bar list, a trend chart (SVG; hover shows the values), initials avatars.
 */
import { useState, type ElementType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

const TONES = {
  accent: 'bg-accent-subtle text-accent-text',
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  info: 'bg-info-bg text-info-text',
} as const;
export type Tone = keyof typeof TONES;

export function KpiTile({ label, children, hint, to, icon: Icon, tone = 'accent' }: {
  label: string; children: ReactNode; hint?: ReactNode; to?: string; icon?: ElementType; tone?: Tone;
}) {
  const body = (
    <div className="card h-full transition-colors hover:border-slate-400/50">
      <div className="flex items-start justify-between gap-3">
        <p className="text-small font-medium text-fg-secondary">{label}</p>
        {Icon && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONES[tone]}`}><Icon size={16} aria-hidden /></span>}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-fg">{children}</div>
      {hint && <p className="mt-1 text-tiny text-fg-muted">{hint}</p>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

export function Panel({ title, to, linkLabel = 'View all', action, children, className = '' }: {
  title: ReactNode; to?: string; linkLabel?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`card !p-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-h3 font-medium text-fg">{title}</h3>
        <div className="flex items-center gap-3">
          {action}
          {to && <Link to={to} className="text-tiny font-medium text-accent-text hover:underline">{linkLabel}</Link>}
        </div>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-3 text-small text-fg-secondary">{children}</p>;

/** One line per currency — amounts are never summed across currencies. */
export function PerCurrency<T extends { currency: string }>({ rows, render, none = '—' }: { rows: T[]; render: (r: T) => ReactNode; none?: ReactNode }) {
  return rows.length === 0 ? <span>{none}</span> : <div className="space-y-0.5">{rows.map((r) => <div key={r.currency}>{render(r)}</div>)}</div>;
}

/** Horizontal bars, each against the largest value. */
export function BarList({ rows, format = (n) => n.toLocaleString(), color = 'bg-accent' }: {
  rows: { key: string; label: ReactNode; value: number; hint?: ReactNode }[]; format?: (n: number) => string; color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5 px-4 py-3">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-small">
            <span className="min-w-0 truncate text-fg">{r.label}</span>
            <span className="shrink-0 font-medium text-fg">{format(r.value)}{r.hint && <span className="ml-1.5 text-tiny font-normal text-fg-muted">{r.hint}</span>}</span>
          </div>
          <div className="h-1.5 rounded-full bg-page"><div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/**
 * Grouped bars over time (weeks, months): one bar per series at each point; hover a point for its values.
 * `series[i]` names the i-th value of every point.
 */
export function TrendChart({ points, series, height = 160, format = (n) => n.toLocaleString() }: {
  points: { label: string; values: number[] }[]; series: { name: string; className: string }[]; height?: number; format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const n = series.length;
  const hovered = hover === null ? null : points[hover];
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-tiny text-fg-secondary">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${s.className}`} />{s.name}</span>)}
        <span className="ml-auto min-h-[1em] text-fg">
          {hovered ? <>{hovered.label}: {series.map((s, i) => `${s.name} ${format(hovered.values[i] ?? 0)}`).join(' · ')}</> : null}
        </span>
      </div>
      <div className="relative flex items-end gap-1" style={{ height }} onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <div key={p.label} className={`flex h-full flex-1 items-end justify-center gap-[2px] rounded-sm ${hover === i ? 'bg-page' : ''}`}
            onMouseEnter={() => setHover(i)} title={`${p.label}: ${series.map((s, j) => `${s.name} ${format(p.values[j] ?? 0)}`).join(', ')}`}>
            {p.values.slice(0, n).map((v, j) => (
              <div key={j} className={`w-full max-w-[18px] rounded-t-sm ${series[j]!.className}`} style={{ height: `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {points.map((p, i) => (
          <span key={p.label} className="flex-1 truncate text-center text-[10px] text-fg-muted">{i % Math.ceil(points.length / 6) === 0 ? p.label : ''}</span>
        ))}
      </div>
    </div>
  );
}

export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  const initials = (name ?? '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span title={name ?? undefined}
      className={`inline-grid shrink-0 place-items-center rounded-full bg-accent-subtle font-semibold text-accent-text ${size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-tiny'}`}>
      {initials}
    </span>
  );
}

/** A small status chip with its own colour classes. */
export function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-tiny font-semibold ${className}`}>{children}</span>;
}

/** "1–50 of 312" with previous / next. */
export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit && offset === 0) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-3 text-small text-fg-secondary">
      <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
      <button type="button" className="btn-ghost !px-3 !py-1.5" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
      <button type="button" className="btn-ghost !px-3 !py-1.5" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</button>
    </div>
  );
}
