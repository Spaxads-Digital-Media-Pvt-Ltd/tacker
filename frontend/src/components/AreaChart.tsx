import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface ChartSeries { key: string; label: string; color: string; data: number[]; format?: (v: number) => string }

/**
 * Multi-series performance chart (no dependency). Each series is normalized to its own 0–100%
 * range so metrics on very different scales (clicks vs. revenue) can be read side-by-side as
 * relative shapes — a legend toggle shows/hides a series, and a hover crosshair reveals the real
 * (un-normalized) value per series at that hour via `format`.
 */
export function AreaChart({ series, xLabels }: { series: ChartSeries[]; xLabels: string[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 1000;
  const h = 260;
  const padL = 8, padR = 8, padT = 12, padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const n = xLabels.length;

  const visible = series.filter((s) => !hidden.has(s.key));
  const paths = useMemo(() => visible.map((s) => {
    const max = Math.max(1, ...s.data);
    const pts = s.data.map((v, i) => {
      const x = padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
      const y = padT + plotH - (v / max) * plotH;
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${(padL + plotW).toFixed(1)},${padT + plotH} L${padL},${padT + plotH} Z`;
    return { key: s.key, color: s.color, line, area, pts };
  }), [visible, n]);

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    const idx = Math.round(((relX - padL) / plotW) * (n - 1));
    setHoverIdx(Math.min(n - 1, Math.max(0, idx)));
  };

  const toggle = (key: string) => setHidden((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const gridY = [0.25, 0.5, 0.75, 1];
  const tickEvery = Math.max(1, Math.round(n / 6));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {series.map((s) => {
          const on = !hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-tiny font-medium transition-colors ${on ? 'border-border bg-surface text-fg' : 'border-transparent bg-subtle text-fg-muted'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? s.color : 'currentColor' }} />
              {s.label}
              {on && hoverIdx !== null && (
                <span className="tabular-nums text-fg-secondary">{(s.format ?? String)(s.data[hoverIdx] ?? 0)}</span>
              )}
            </button>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-64 w-full cursor-crosshair"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        {gridY.map((f) => {
          const y = padT + plotH * (1 - f);
          return <line key={f} x1={padL} x2={padL + plotW} y1={y} y2={y} stroke="rgb(var(--border))" strokeWidth={1} />;
        })}

        {paths.map((p) => (
          <g key={p.key}>
            <defs>
              <linearGradient id={`ac-${p.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={p.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={p.area} fill={`url(#ac-${p.key})`} />
            <path d={p.line} fill="none" stroke={p.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}

        {hoverIdx !== null && (
          <g>
            <line
              x1={padL + (n <= 1 ? 0 : (hoverIdx / (n - 1)) * plotW)}
              x2={padL + (n <= 1 ? 0 : (hoverIdx / (n - 1)) * plotW)}
              y1={padT} y2={padT + plotH}
              stroke="rgb(var(--text-muted))" strokeWidth={1} strokeDasharray="3 3"
            />
            {paths.map((p) => {
              const pt = p.pts[hoverIdx];
              if (!pt) return null;
              return <circle key={p.key} cx={pt[0]} cy={pt[1]} r={3.5} fill={p.color} stroke="white" strokeWidth={1.5} />;
            })}
          </g>
        )}

        {xLabels.map((lbl, i) => {
          if (i % tickEvery !== 0 && i !== n - 1) return null;
          const x = padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
          return (
            <text key={i} x={x} y={h - 6} fontSize={10} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fill="rgb(var(--text-muted))">
              {lbl}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
