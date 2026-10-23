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

/**
 * Conservative rendered width (px) of an axis label: ~0.6 em per character (Inter's tabular digits
 * are 0.6 em; most letters are narrower) plus 2 px, so a selection made with it never collides.
 */
export function estimateLabelWidth(text: string, fontPx = 12): number {
  return Math.ceil(text.length * fontPx * 0.6) + 2;
}

export interface AxisLabel { index: number; x: number }

/**
 * Which x-axis labels to draw, and where. `xs` are the label centres (data positions), `widths` their
 * rendered widths, `bounds` the plot's horizontal extent. Every box is shifted inside the bounds (an
 * edge label is never cut off — the first one ends up start-aligned, the last end-aligned) and drawn
 * centred at the returned `x`. The first and last labels are always kept (when both fit at all);
 * intermediates are every k-th index for the smallest k at which no two kept boxes are closer than
 * `minGap`, and any intermediate that would crowd the first or last label is dropped.
 */
export function pickXLabels(
  xs: readonly number[], widths: readonly number[], bounds: { left: number; right: number }, minGap = 8,
): AxisLabel[] {
  const n = xs.length;
  if (n === 0) return [];
  const span = Math.max(0, bounds.right - bounds.left);
  const centre = (i: number) => {
    const half = Math.min(widths[i] ?? 0, span) / 2;
    return Math.min(Math.max(xs[i]!, bounds.left + half), bounds.right - half);
  };
  const c = xs.map((_, i) => centre(i));
  const clear = (a: number, b: number) => c[a]! + (widths[a] ?? 0) / 2 + minGap <= c[b]! - (widths[b] ?? 0) / 2;
  const last = n - 1;
  const at = (i: number): AxisLabel => ({ index: i, x: c[i]! });
  if (n === 1) return [at(0)];
  if (!clear(0, last)) return [at(last)];
  for (let k = 1; k < last; k++) {
    const kept = [0];
    let ok = true;
    for (let i = k; i < last; i += k) {
      if (!clear(0, i) || !clear(i, last)) continue;
      if (!clear(kept[kept.length - 1]!, i)) { ok = false; break; }
      kept.push(i);
    }
    if (ok) return [...kept, last].map(at);
  }
  return [at(0), at(last)];
}
