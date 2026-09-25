import { useState } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
  secondaryData,
  secondaryLabelFormat = (v: number) => v.toString(),
  primaryName = 'Value',
  secondaryName = 'Secondary',
  showGrid = false,
}: {
  data: number[];
  color?: string;
  mode: 'area' | 'bar';
  height?: number;
  labelFormat?: (v: number) => string;
  secondaryData?: number[];
  secondaryLabelFormat?: (v: number) => string;
  primaryName?: string;
  secondaryName?: string;
  showGrid?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Geometry
  const w = 800;
  const h = height;
  const padL = 0, padR = 0, padT = 10, padB = showGrid ? 20 : 0;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const n = data.length || 1;
  const minVal = 0;
  const maxVal = Math.max(1, ...data) * 1.1; // 10% headroom

  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const yPos = (v: number) => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

  const pts = data.map((v, i) => [x(i), yPos(v)] as const);
  const linePath = smoothPath(pts, 0.16, [padT, padT + plotH]);
  const areaPath = `${linePath} L${x(n - 1).toFixed(2)},${padT + plotH} L${x(0).toFixed(2)},${padT + plotH} Z`;

  // Secondary Series Setup
  const secMaxVal = secondaryData ? Math.max(1, ...secondaryData) * 1.1 : 1;
  const ySec = (v: number) => padT + plotH - ((v - minVal) / (secMaxVal - minVal)) * plotH;
  const secPts = secondaryData ? secondaryData.map((v, i) => [x(i), ySec(v)] as const) : [];
  const secLinePath = secondaryData ? smoothPath(secPts, 0.16, [padT, padT + plotH]) : '';

  const barW = Math.max(2, (plotW / n) * 0.6);

  // Hover logic
  const handleMove = (clientX: number, target: EventTarget & SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.round(mx * (n - 1));
    if (idx >= 0 && idx < n) setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hoverVal = hoverIdx != null ? data[hoverIdx]! : 0;
  const hoverSecVal = hoverIdx != null && secondaryData ? secondaryData[hoverIdx]! : 0;
  const hoverX = hoverIdx != null ? x(hoverIdx) : 0;
  const hoverY = hoverIdx != null ? yPos(hoverVal) : 0;
  const hoverSecY = hoverIdx != null && secondaryData ? ySec(hoverSecVal) : 0;
  const leftPct = hoverIdx != null ? (hoverX / w) * 100 : 0;

  const hourLabel = hoverIdx != null ? `${String(hoverIdx).padStart(2, '0')}:00` : '';
  const tipX = leftPct > 50 ? '-100%' : '0%';
  const tipOffset = leftPct > 50 ? -12 : 12;
  const tipStyle = { left: `calc(${leftPct}% + ${tipOffset}px)`, transform: `translateY(-50%) translateX(${tipX})` };

  const id = `chart-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  const tickDigits = maxVal >= 100 ? 0 : 1;
  const yAxis = [0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + plotH * f,
    label: maxVal * (1 - f),
  }));

  return (
    <div className="relative w-full" style={{ height: `${h}px` }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible touch-none"
        onMouseMove={(e) => handleMove(e.clientX, e.currentTarget)}
        onMouseLeave={handleLeave}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) handleMove(t.clientX, e.currentTarget);
        }}
        onTouchEnd={handleLeave}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showGrid && yAxis.map(({ y }, i) => (
          <line
            key={i} x1={padL} y1={y} x2={w - padR} y2={y}
            stroke="rgb(var(--border))" strokeOpacity="1" strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        ))}

        {mode === 'area' ? (
          <>
            <path d={areaPath} fill={`url(#${id})`} className="animate-fade-in" />
            <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" className="animate-draw-line" style={{ strokeDasharray: 2000, strokeDashoffset: 2000 }} vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          data.map((v, i) => (
            <rect key={i} x={x(i) - barW / 2} y={yPos(v)} width={barW} height={padT + plotH - yPos(v)} rx="1.5" fill={color} fillOpacity="0.6" className="animate-fade-in" style={{ animationDelay: `${i * 15}ms` }} />
          ))
        )}

        {secondaryData && (
          <path d={secLinePath} fill="none" stroke="rgb(var(--text-muted))" strokeWidth="1.5" strokeDasharray="4 3" className="animate-fade-in delay-200" vectorEffect="non-scaling-stroke" />
        )}

        {showGrid && yAxis.map(({ y, label }, i) => (
          <text key={i} x={3} y={y - 4} fontSize="10" textAnchor="start" fill="rgb(var(--text-muted))">
            {label.toFixed(tickDigits)}
          </text>
        ))}

        {showGrid && HOURS.filter((h2) => h2 % 4 === 0).map((h2) => (
          <text key={h2} x={x(h2)} y={h - 6} fontSize="10" textAnchor={h2 === 0 ? 'start' : 'middle'} fill="rgb(var(--text-muted))">
            {String(h2).padStart(2, '0')}:00
          </text>
        ))}

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
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface z-20"
            style={{ left: `${leftPct}%`, top: `${(hoverY / h) * 100}%`, backgroundColor: color }}
          />
          {secondaryData && (
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface bg-fg-muted z-20"
              style={{ left: `${leftPct}%`, top: `${(hoverSecY / h) * 100}%` }}
            />
          )}
          <div
            className="pointer-events-none absolute top-1/2 z-30 min-w-[120px] rounded-[var(--radius)] border border-border bg-elevated px-2.5 py-1.5 shadow-elevated transition-all"
            style={tipStyle}
          >
            <div className="mb-1 text-tiny font-medium tabular-nums text-fg-secondary">{hourLabel}</div>
            <div className="flex items-center gap-1.5 text-tiny text-fg-secondary">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />{primaryName}
              <strong className="ml-auto font-semibold tabular-nums text-fg">{labelFormat(hoverVal)}</strong>
            </div>
            {secondaryData && (
              <div className="mt-0.5 flex items-center gap-1.5 text-tiny text-fg-secondary">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-fg-muted" />{secondaryName}
                <strong className="ml-auto font-semibold tabular-nums text-fg">{secondaryLabelFormat(hoverSecVal)}</strong>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
