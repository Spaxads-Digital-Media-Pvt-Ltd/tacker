/**
 * Pure geometry for TimeSeriesChart (kept out of the .tsx so it can be unit-tested and so the
 * component file only exports components): nice y ticks, clamped Catmull-Rom curves, gap runs.
 */

/** A "nice" step (1, 2, 2.5, 5 × 10ⁿ) splitting `range` into about `count` parts. */
function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Evenly spaced round ticks covering [min, max]. A flat domain widens to [min, 2·|min|] (or [0, 1]). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max === min) max = min === 0 ? 1 : min + Math.abs(min);
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo, i = 0; v <= hi + step / 2 && i < 50; i++, v = lo + i * step) out.push(Number(v.toPrecision(12)));
  return out;
}

export interface Pt { x: number; y: number }
export interface CurveSegment { c1: Pt; c2: Pt; to: Pt }

/**
 * Catmull-Rom segments through `pts` as cubic Bézier control points, each control point's y clamped
 * to its segment's [min, max] — the curve never overshoots the data (no fake dip below a zero day).
 */
export function curveSegments(pts: readonly Pt[]): CurveSegment[] {
  const out: CurveSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    const clamp = (y: number) => Math.min(hi, Math.max(lo, y));
    out.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) },
      to: p2,
    });
  }
  return out;
}

/** SVG path data for `curveSegments(pts)`. */
export function curvePath(pts: readonly Pt[]): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (const s of curveSegments(pts)) d += ` C${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.to.x},${s.to.y}`;
  return d;
}

/** Split a series into runs of consecutive non-null points (gaps break the line). */
export function runs(values: readonly (number | null)[], at: (i: number, v: number) => Pt): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(at(i, v));
  });
  if (cur.length) out.push(cur);
  return out;
}
