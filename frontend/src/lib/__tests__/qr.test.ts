// lib/qr.ts — the encoder's structure (sizes, finder patterns, timing, format bits); the decode itself was
// checked against Chrome's BarcodeDetector for versions 1–20 (see the commit message).
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { qrMatrix } from '../qr.ts';

const finderAt = (m: boolean[][], x0: number, y0: number) => {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
    if (m[y0 + dy]![x0 + dx] !== (ring !== 2)) return false;
  }
  return true;
};

describe('qrMatrix', () => {
  it('picks the smallest version that fits (level M)', () => {
    assert.equal(qrMatrix('hello').length, 21); // v1
    assert.equal(qrMatrix('x'.repeat(14)).length, 21); // v1 holds 14 bytes at M
    assert.equal(qrMatrix('x'.repeat(15)).length, 25); // → v2
    assert.equal(qrMatrix('x'.repeat(666)).length, 97); // v20, the largest
    assert.throws(() => qrMatrix('x'.repeat(667)), /Too long/);
  });

  it('has the three finder patterns, the timing lines and the dark module', () => {
    const m = qrMatrix('otpauth://totp/Tracker:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Tracker');
    const n = m.length;
    assert.ok(finderAt(m, 0, 0) && finderAt(m, n - 7, 0) && finderAt(m, 0, n - 7));
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6]![i], i % 2 === 0); assert.equal(m[i]![6], i % 2 === 0); }
    assert.equal(m[n - 8]![8], true);
  });

  it('the two copies of the format bits agree', () => {
    const m = qrMatrix('two copies');
    const n = m.length;
    const a = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => m[y]![8]).concat([7, 5, 4, 3, 2, 1, 0].map((x) => m[8]![x]));
    const b = Array.from({ length: 8 }, (_, i) => m[8]![n - 1 - i]).concat(Array.from({ length: 7 }, (_, i) => m[n - 7 + i]![8]));
    assert.deepEqual(a, b);
  });
});
