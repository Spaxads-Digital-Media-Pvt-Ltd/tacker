// TimeSeriesChart geometry (charts/chartMath.ts) — nice ticks, clamped curves, gap runs.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { curvePath, curveSegments, estimateLabelWidth, niceTicks, pickXLabels, runs, type Pt } from '../chartMath.ts';

describe('niceTicks', () => {
  it('round steps covering the domain', () => {
    assert.deepStrictEqual(niceTicks(0, 58_000), [0, 20_000, 40_000, 60_000]);
    assert.deepStrictEqual(niceTicks(0, 7), [0, 2, 4, 6, 8]);
    assert.deepStrictEqual(niceTicks(0, 1), [0, 0.25, 0.5, 0.75, 1]);
  });

  it('steps are 1 / 2 / 2.5 / 5 × 10ⁿ and the ends bracket the data', () => {
    for (const [min, max] of [[0, 3], [0, 9.9], [-40, 130], [0, 123_456], [0, 0.07]] as const) {
      const t = niceTicks(min, max);
      assert.ok(t[0]! <= min && t[t.length - 1]! >= max, `${min}..${max} → ${t}`);
      const step = t[1]! - t[0]!;
      const norm = step / 10 ** Math.floor(Math.log10(step));
      assert.ok([1, 2, 2.5, 5].some((s) => Math.abs(norm - s) < 1e-9), `step ${step}`);
    }
  });

  it('a flat or empty domain still gets a usable axis', () => {
    assert.deepStrictEqual(niceTicks(0, 0), [0, 0.25, 0.5, 0.75, 1]);
    assert.ok(niceTicks(5, 5).length >= 2);
    assert.deepStrictEqual(niceTicks(Infinity, -Infinity), [0, 1]);
  });

  it('no float noise in tick values', () => {
    for (const v of niceTicks(0, 0.3)) assert.strictEqual(v, Number(v.toPrecision(12)));
  });
});

describe('curveSegments (clamped Catmull-Rom)', () => {
  // SVG y grows downward; a spike then a zero day — an unclamped curve would dip below the zero line.
  const pts: Pt[] = [{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 0 }, { x: 30, y: 100 }, { x: 40, y: 100 }];

  it('every control point stays within its segment y-range (no overshoot)', () => {
    const segs = curveSegments(pts);
    assert.strictEqual(segs.length, pts.length - 1);
    segs.forEach((s, i) => {
      const lo = Math.min(pts[i]!.y, pts[i + 1]!.y);
      const hi = Math.max(pts[i]!.y, pts[i + 1]!.y);
      for (const c of [s.c1, s.c2]) assert.ok(c.y >= lo && c.y <= hi, `segment ${i}: ${c.y} outside [${lo}, ${hi}]`);
      assert.deepStrictEqual(s.to, pts[i + 1]);
    });
  });

  it('a flat run stays exactly flat', () => {
    const flat = curveSegments([{ x: 0, y: 50 }, { x: 10, y: 50 }, { x: 20, y: 50 }]);
    for (const s of flat) assert.ok(s.c1.y === 50 && s.c2.y === 50);
  });

  it('control x stays between the segment ends (monotone x)', () => {
    curveSegments(pts).forEach((s, i) => {
      for (const c of [s.c1, s.c2]) assert.ok(c.x >= pts[i]!.x && c.x <= pts[i + 1]!.x);
    });
  });

  it('path data: a move then one cubic per segment; empty and single-point inputs', () => {
    const d = curvePath(pts);
    assert.ok(d.startsWith('M0,100'));
    assert.strictEqual((d.match(/ C/g) ?? []).length, pts.length - 1);
    assert.strictEqual(curvePath([]), '');
    assert.strictEqual(curvePath([{ x: 3, y: 4 }]), 'M3,4');
  });
});

describe('runs (null gaps)', () => {
  const at = (i: number, v: number): Pt => ({ x: i, y: v });

  it('splits on null / non-finite values, keeping isolated points as their own run', () => {
    assert.deepStrictEqual(runs([1, 2, null, 3, null, null, 4, 5], at), [
      [{ x: 0, y: 1 }, { x: 1, y: 2 }],
      [{ x: 3, y: 3 }],
      [{ x: 6, y: 4 }, { x: 7, y: 5 }],
    ]);
    assert.deepStrictEqual(runs([null, NaN, null], at), []);
  });

  it('a zero is a value, not a gap', () => {
    assert.deepStrictEqual(runs([0, 0], at), [[{ x: 0, y: 0 }, { x: 1, y: 0 }]]);
  });
});

describe('pickXLabels', () => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The bucket labels the app draws: day, hour, week (start day) and month.
  const FORMATS: Record<string, (i: number) => string> = {
    day: (i) => { const d = new Date(Date.UTC(2026, 8, 23 + i)); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; },
    hour: (i) => `${String(i % 24).padStart(2, '0')}:00`,
    week: (i) => { const d = new Date(Date.UTC(2026, 6, 6 + 7 * i)); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; },
    month: (i) => `${MONTHS[i % 12]} ${2020 + Math.floor(i / 12)}`,
  };
  // The chart's own geometry: a y-axis gutter on the left, 12 px on the right; lines put the first and
  // last points on the plot edges, bars put every label at its band centre.
  const layout = (width: number, n: number, kind: 'line' | 'bar') => {
    const left = 40, right = width - 12, plotW = right - left;
    const xs = Array.from({ length: n }, (_, i) => (kind === 'bar' || n === 1 ? left + (plotW / n) * (i + 0.5) : left + (i * plotW) / (n - 1)));
    return { xs, bounds: { left, right } };
  };

  it('never overlaps (≥ 8 px apart), never clips, always keeps the first and last label', () => {
    for (const [name, fmt] of Object.entries(FORMATS)) {
      for (let width = 280; width <= 1100; width += 10) {
        for (let n = 1; n <= 90; n++) {
          for (const kind of ['line', 'bar'] as const) {
            const labels = Array.from({ length: n }, (_, i) => fmt(i));
            const widths = labels.map((l) => estimateLabelWidth(l));
            const { xs, bounds } = layout(width, n, kind);
            const got = pickXLabels(xs, widths, bounds);
            const where = `${name} w=${width} n=${n} ${kind}`;
            assert.strictEqual(got[0]!.index, 0, `first kept: ${where}`);
            assert.strictEqual(got[got.length - 1]!.index, n - 1, `last kept: ${where}`);
            got.forEach((g, k) => {
              const half = widths[g.index]! / 2;
              assert.ok(g.x - half >= bounds.left - 1e-9 && g.x + half <= bounds.right + 1e-9, `inside plot: ${where} #${g.index}`);
              if (k > 0) {
                const p = got[k - 1]!;
                assert.ok(g.index > p.index, `ordered: ${where}`);
                assert.ok(p.x + widths[p.index]! / 2 + 8 <= g.x - half + 1e-9, `gap: ${where} #${p.index}/#${g.index}`);
              }
            });
          }
        }
      }
    }
  });

  it('uses the width it has: a 30-day range shows several labels on a wide chart and fewer on a narrow one', () => {
    const labels = Array.from({ length: 30 }, (_, i) => FORMATS.day!(i));
    const widths = labels.map((l) => estimateLabelWidth(l));
    const wide = pickXLabels(layout(1100, 30, 'line').xs, widths, layout(1100, 30, 'line').bounds);
    const narrow = pickXLabels(layout(320, 30, 'line').xs, widths, layout(320, 30, 'line').bounds);
    assert.ok(wide.length >= 8, `wide ${wide.length}`);
    assert.ok(narrow.length >= 3 && narrow.length < wide.length, `narrow ${narrow.length}`);
  });

  it('keeps edge labels inside the plot: the first starts at the left edge, the last ends at the right', () => {
    const { xs, bounds } = layout(600, 7, 'line');
    const got = pickXLabels(xs, xs.map(() => 40), bounds);
    assert.strictEqual(got[0]!.x, bounds.left + 20);
    assert.strictEqual(got[got.length - 1]!.x, bounds.right - 20);
  });

  it('a single point is one label; labels too wide for the plot fall back to the last one', () => {
    assert.deepStrictEqual(pickXLabels([100], [40], { left: 40, right: 400 }), [{ index: 0, x: 100 }]);
    assert.deepStrictEqual(pickXLabels([], [], { left: 0, right: 100 }), []);
    assert.deepStrictEqual(pickXLabels([0, 50], [60, 60], { left: 0, right: 80 }).map((l) => l.index), [1]);
  });
});
