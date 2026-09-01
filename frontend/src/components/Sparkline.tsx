/** Tiny inline SVG sparkline (area + line) for the dashboard KPI cards. No chart dependency. */

/**
 * Catmull-Rom → cubic Bézier: turns a polyline into a gently flowing curve with no control
 * handles to tune per-call. `tension` 0 = straight segments, ~0.2 = smooth. Kept in sync with the
 * identical helper in PerformanceChart (small enough to duplicate rather than add a shared file).
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

export function Sparkline({ data, color = 'rgb(var(--accent))', height = 40 }: { data: number[]; color?: string; height?: number }) {
  const w = 100;
  const max = Math.max(1, ...data);
  const n = data.length;
  const pts = data.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * w;
    const y = height - (v / max) * (height - 4) - 2;
    return [x, y] as const;
  });
  // Clamp the curve to the same inset the data points use (y ∈ [2, height-2]) so a hard
  // spike-into-zeros transition can't bow the smoothed line past the drawing area.
  const line = smoothPath(pts, 0.16, [2, height - 2]);
  const area = n <= 1 ? '' : `${line} L${w},${height} L0,${height} Z`;
  // Sanitize to a valid SVG id — `color` may be a hex string or a CSS value like
  // "rgb(var(--accent))", and `url(#id)` breaks if the id contains parens/spaces.
  const id = `sg-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
