import { useState, type MouseEvent } from 'react';

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

export function InteractiveSingleSeriesChart({
  data,
  color = 'rgb(var(--accent))',
  mode,
  height = 80,
  labelFormat = (v: number) => v.toString(),
}: {
  data: number[];
  color?: string;
  mode: 'area' | 'bar';
  height?: number;
  labelFormat?: (v: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Geometry
  const w = 400;
  const h = height;
  const padL = 0, padR = 0, padT = 10, padB = 0;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const n = data.length || 1;
  const minVal = 0;
  const maxVal = Math.max(1, ...data) * 1.1; // 10% headroom

  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const yPos = (v: number) => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

  const pts = data.map((v, i) => [x(i), yPos(v)] as const);
  const linePath = smoothPath(pts, 0.16, [padT, padT + plotH]);
  const areaPath = `${linePath} L${x(n - 1)},${padT + plotH} L${x(0)},${padT + plotH} Z`;

  const barW = Math.max(2, (plotW / n) * 0.6);

  // Hover logic
  const handleMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(mx * (n - 1));
    if (idx >= 0 && idx < n) setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hoverVal = hoverIdx != null ? data[hoverIdx]! : 0;
  const hoverX = hoverIdx != null ? x(hoverIdx) : 0;
  const hoverY = hoverIdx != null ? yPos(hoverVal) : 0;
  const leftPct = hoverIdx != null ? (hoverX / w) * 100 : 0;

  const hourLabel = hoverIdx != null ? `${String(hoverIdx).padStart(2, '0')}:00` : '';
  const tipX = leftPct > 50 ? '-100%' : '0%';
  const tipOffset = leftPct > 50 ? -12 : 12;
  const tipStyle = { left: `calc(${leftPct}% + ${tipOffset}px)`, transform: `translateY(-50%) translateX(${tipX})` };

  const id = `chart-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="relative w-full" style={{ height: `${h}px` }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible touch-none"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) handleMove({ clientX: t.clientX, currentTarget: e.currentTarget } as any);
        }}
        onTouchEnd={handleLeave}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id="glow-filter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {mode === 'area' ? (
          <>
            <path d={areaPath} fill={`url(#${id})`} className="animate-fade-in" />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" filter="url(#glow-filter)" className="animate-draw-line" style={{ strokeDasharray: 2000, strokeDashoffset: 2000 }} vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          data.map((v, i) => (
            <rect key={i} x={x(i) - barW / 2} y={yPos(v)} width={barW} height={padT + plotH - yPos(v)} rx="1.5" fill={color} fillOpacity="0.6" className="animate-fade-in" style={{ animationDelay: `${i * 15}ms` }} />
          ))
        )}

        {hoverIdx != null && (
          <line
            x1={hoverX} y1={padT} x2={hoverX} y2={padT + plotH}
            stroke="rgb(var(--text-secondary))" strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {hoverIdx != null && (
        <>
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
            style={{ left: `${leftPct}%`, top: `${(hoverY / h) * 100}%`, backgroundColor: color }}
          />
          <div
            className="pointer-events-none absolute top-1/2 z-10 w-32 rounded-[var(--radius)] border border-border bg-elevated px-2.5 py-1.5 shadow-elevated transition-all"
            style={tipStyle}
          >
            <div className="mb-1 text-tiny font-medium tabular-nums text-fg-secondary">{hourLabel}</div>
            <div className="flex items-center gap-1.5 text-tiny text-fg-secondary">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              <strong className="font-semibold tabular-nums text-fg">{labelFormat(hoverVal)}</strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
