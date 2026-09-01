import { useState } from 'react';
import { TrendingUp, BarChart3 } from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

  const revLine = revenue.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yRev(v).toFixed(1)}`).join(' ');
  const revArea = `${revLine} L${x(n - 1).toFixed(1)},${padT + plotH} L${x(0).toFixed(1)},${padT + plotH} Z`;
  const clickLine = clicks.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yClick(v).toFixed(1)}`).join(' ');
  const barW = Math.max(2, (plotW / n) * 0.55);

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

      <div className="mt-2 flex-1">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="perf-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--chart))" stopOpacity="0.12" />
              <stop offset="100%" stopColor="rgb(var(--chart))" stopOpacity="0" />
            </linearGradient>
          </defs>

          {mode === 'area' ? (
            <>
              <path d={revArea} fill="url(#perf-rev)" />
              <path d={revLine} fill="none" stroke="rgb(var(--chart))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            revenue.map((v, i) => (
              <rect key={i} x={x(i) - barW / 2} y={yRev(v)} width={barW} height={padT + plotH - yRev(v)} rx="1.5" fill="rgb(var(--accent))" fillOpacity="0.55" />
            ))
          )}
          <path d={clickLine} fill="none" stroke="#C9BFB8" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />

          {HOURS.filter((h2) => h2 % 4 === 0).map((h2) => (
            <text key={h2} x={x(h2)} y={h - 6} fontSize="9" textAnchor="middle" fill="rgb(var(--text-muted))">
              {String(h2).padStart(2, '0')}:00
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-border pt-2 text-tiny text-fg-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />Revenue: <strong className="font-semibold text-fg">{revenueLabel}</strong></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-fg-muted" />Clicks: <strong className="font-semibold text-fg">{clicksLabel}</strong></span>
      </div>
    </div>
  );
}
