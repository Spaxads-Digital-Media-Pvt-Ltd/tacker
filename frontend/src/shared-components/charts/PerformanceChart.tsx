import { useState, type MouseEvent } from 'react';
import { TrendingUp, BarChart3 } from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Catmull-Rom → cubic Bézier: polyline → gently flowing curve. `tension` 0 = straight, ~0.2 =
 * smooth. Identical to the private helper in Sparkline (small enough to duplicate rather than add
 * a shared module).
 *
 * `yBounds` clamps the two control-point Y values into the plot's vertical range. A cubic Bézier
 * segment always stays inside the convex hull of its 4 points; the endpoints are real data (already
 * in range), so clamping the control points guarantees the drawn curve can never leave [min,max] —
 * however sharp the transition (e.g. a peak dropping straight into a run of zeros). This is
 * targeted: only control points that would have overshot move, so in-range curves are unchanged.
 */
function smoothPath(
  pts: ReadonlyArray<readonly [number, number]>,
  tension = 0.16,
  yBounds?: readonly [number, number],
): string {
  const start = pts[0];
  if (!start) return '';
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  }
  const clampY = yBounds
    ? (y: number) => Math.min(Math.max(y, yBounds[0]), yBounds[1])
    : (y: number) => y;
  const out = [`M${start[0].toFixed(2)},${start[1].toFixed(2)}`];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    const prev = pts[i - 2] ?? a;
    const next = pts[i + 1] ?? b;
    const c1x = a[0] + (b[0] - prev[0]) * tension;
    const c1y = clampY(a[1] + (b[1] - prev[1]) * tension);
    const c2x = b[0] - (next[0] - a[0]) * tension;
    const c2y = clampY(b[1] - (next[1] - a[1]) * tension);
    out.push(`C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`);
  }
  return out.join(' ');
}

// Currency / count formatting for the y-axis ticks and the hover tooltip. Mirrors the dashboard's
// `money` helper (module-local there, so duplicated rather than exported across a page boundary).
const fmtMoney = (v: number, digits: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const fmtCount = (v: number) => v.toLocaleString('en-US');

/**
 * Dual-axis "today" performance chart — revenue (teal, left axis) and clicks (slate line, right
 * axis) over the current day's 24 hourly points. Inline SVG, no chart dependency, same approach as
 * `Sparkline`. No "vs yesterday" overlay: the API only exposes yesterday as a single scalar, not an
 * hourly series (see dashboard plan), so this deliberately only plots today.
 */
export function PerformanceChart({
  revenue, clicks, revenueLabel, clicksLabel,
}: {
  revenue: number[]; clicks: number[]; revenueLabel: string; clicksLabel: string;
}) {
  const [mode, setMode] = useState<'area' | 'bar'>('area');
  // Hovered hour index (0-23), or null when the pointer is off the plot.
  const [hover, setHover] = useState<number | null>(null);
  const w = 640;
  const h = 220;
  const padL = 8, padR = 8, padT = 12, padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const n = revenue.length || 1;

  const revMax = Math.max(1, ...revenue);
  const clickMax = Math.max(1, ...clicks);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yRev = (v: number) => padT + plotH - (v / revMax) * plotH;
  const yClick = (v: number) => padT + plotH - (v / clickMax) * plotH;

  // Clamp the smoothed curves to the plot's vertical bounds so a hard spike-into-zeros transition
  // can't bow the line below the baseline (or above the top) — see smoothPath's note.
  const yb: readonly [number, number] = [padT, padT + plotH];
  const revLine = smoothPath(revenue.map((v, i) => [x(i), yRev(v)] as const), 0.16, yb);
  const revArea = `${revLine} L${x(n - 1).toFixed(1)},${padT + plotH} L${x(0).toFixed(1)},${padT + plotH} Z`;
  const clickLine = smoothPath(clicks.map((v, i) => [x(i), yClick(v)] as const), 0.16, yb);
  const barW = Math.max(2, (plotW / n) * 0.55);

  // Horizontal gridlines + left-axis revenue ticks, at the same quarter fractions the x-axis hour
  // labels use (0.25 / 0.5 / 0.75 / baseline). A line's value = revMax scaled by distance from top.
  const tickDigits = revMax >= 100 ? 0 : 2;
  const yAxis = [0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + plotH * f,
    label: fmtMoney(revMax * (1 - f), tickDigits),
  }));

  // Pointer → nearest hour. `preserveAspectRatio="none"` stretches the viewBox to exactly fill the
  // element, so fraction-of-width maps linearly onto the plot's x range.
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0) return;
    const frac = (((e.clientX - r.left) / r.width) * w - padL) / plotW;
    setHover(Math.round(Math.min(1, Math.max(0, frac)) * (n - 1)));
  };

  const hi = hover;
  const hoverRev = hi == null ? 0 : revenue[hi] ?? 0;
  const hoverClicks = hi == null ? 0 : clicks[hi] ?? 0;
  const leftPct = hi == null ? 0 : (x(hi) / w) * 100;
  const hourLabel = hi == null ? '' : `${String(hi).padStart(2, '0')}:00`;
  // Anchor the tooltip so it never runs off either edge of the card.
  const tipStyle =
    leftPct < 33 ? { left: `${leftPct}%`, transform: 'translateX(-8px)' }
    : leftPct > 67 ? { left: `${leftPct}%`, transform: 'translateX(calc(-100% + 8px))' }
    : { left: `${leftPct}%`, transform: 'translateX(-50%)' };

  return (
    <div className="card flex h-full flex-col !p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3 font-medium text-fg">Performance</h2>
        <div className="flex items-center gap-1">
          <button
            aria-label="Area view" title="Area view"
            onClick={() => setMode('area')}
            className={`grid h-7 w-7 place-items-center rounded-[var(--radius)] transition-colors ${mode === 'area' ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-accent-subtle hover:text-fg'}`}
          >
            <TrendingUp size={15} />
          </button>
          <button
            aria-label="Bar view" title="Bar view"
            onClick={() => setMode('bar')}
            className={`grid h-7 w-7 place-items-center rounded-[var(--radius)] transition-colors ${mode === 'bar' ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-accent-subtle hover:text-fg'}`}
          >
            <BarChart3 size={15} />
          </button>
        </div>
      </div>

      <div className="relative mt-2 flex-1" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="perf-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.12" />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
            </linearGradient>
          </defs>

          {yAxis.map(({ y }, i) => (
            <line
              key={i} x1={padL} y1={y} x2={w - padR} y2={y}
              stroke="rgb(var(--border))" strokeOpacity="1" strokeWidth="1" vectorEffect="non-scaling-stroke"
            />
          ))}

          {mode === 'area' ? (
            <>
              <path d={revArea} fill="url(#perf-rev)" />
              <path d={revLine} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            revenue.map((v, i) => (
              <rect key={i} x={x(i) - barW / 2} y={yRev(v)} width={barW} height={padT + plotH - yRev(v)} rx="1.5" fill="rgb(var(--accent))" fillOpacity="0.55" />
            ))
          )}
          <path d={clickLine} fill="none" stroke="rgb(var(--text-muted))" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />

          {yAxis.map(({ y, label }, i) => (
            <text key={i} x={padL + 3} y={y - 4} fontSize="9" textAnchor="start" fill="rgb(var(--text-muted))">
              {label}
            </text>
          ))}

          {HOURS.filter((h2) => h2 % 4 === 0).map((h2) => (
            <text key={h2} x={x(h2)} y={h - 6} fontSize="9" textAnchor="middle" fill="rgb(var(--text-muted))">
              {String(h2).padStart(2, '0')}:00
            </text>
          ))}

          {hi != null && (
            <line
              x1={x(hi)} y1={padT} x2={x(hi)} y2={padT + plotH}
              stroke="rgb(var(--text-secondary))" strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hi != null && (
          <>
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
              style={{ left: `${leftPct}%`, top: `${(yRev(hoverRev) / h) * 100}%` }}
            />
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-muted ring-2 ring-surface"
              style={{ left: `${leftPct}%`, top: `${(yClick(hoverClicks) / h) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute top-1 z-10 w-32 rounded-[var(--radius)] border border-border bg-elevated px-2.5 py-1.5 shadow-elevated"
              style={tipStyle}
            >
              <div className="mb-1 text-tiny font-medium tabular-nums text-fg-secondary">{hourLabel}</div>
              <div className="flex items-center gap-1.5 text-tiny text-fg-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />Revenue
                <strong className="ml-auto font-semibold tabular-nums text-fg">{fmtMoney(hoverRev, 2)}</strong>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-tiny text-fg-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />Clicks
                <strong className="ml-auto font-semibold tabular-nums text-fg">{fmtCount(hoverClicks)}</strong>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-border pt-2 text-tiny text-fg-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />Revenue:{' '}
          <strong className="font-semibold tabular-nums text-fg">{hi == null ? revenueLabel : fmtMoney(hoverRev, 2)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-fg-muted" />Clicks:{' '}
          <strong className="font-semibold tabular-nums text-fg">{hi == null ? clicksLabel : fmtCount(hoverClicks)}</strong>
        </span>
        {hi != null && <span className="ml-auto tabular-nums text-fg-muted">at {hourLabel}</span>}
      </div>
    </div>
  );
}
