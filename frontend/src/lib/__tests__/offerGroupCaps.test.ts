// Regression tests for offer-group cap display (lib/offerGroupCaps.ts) — legacy malformed caps.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { capValue } from '../offerGroupCaps.ts';

describe('capValue', () => {
  it('keeps real positive caps (numbers or numeric strings)', () => {
    assert.strictEqual(capValue(100), 100);
    assert.strictEqual(capValue(12.5), 12.5);
    assert.strictEqual(capValue('50'), 50);
  });
  it('treats malformed, zero and negative caps as no cap', () => {
    for (const v of ['abc', '', '   ', -5, 0, '0', Infinity, NaN, null, undefined, {}, []]) {
      assert.strictEqual(capValue(v), null, `value ${String(v)}`);
    }
  });
});
