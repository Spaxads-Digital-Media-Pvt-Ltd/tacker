// TimeSeriesChart geometry (charts/chartMath.ts) — nice ticks, clamped curves, gap runs.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { curvePath, curveSegments, niceTicks, runs, type Pt } from '../chartMath.ts';

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
