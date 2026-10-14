// Add Conversion amount check (lib/moneyInput.ts) — imports the real module; same rule as the backend.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { checkMoneyInput } from '../moneyInput.ts';

const errorOf = (v: string): string | null => {
  const r = checkMoneyInput(v);
  return r.ok ? null : r.error;
};

describe('checkMoneyInput', () => {
  it('accepts non-negative decimals with up to 4 decimals (trimmed)', () => {
    for (const v of ['0', '5', '5.2', '5.25', '1234.5678', '0.0001', '9999999999.9999']) {
      assert.deepStrictEqual(checkMoneyInput(v), { ok: true, value: v });
    }
    assert.deepStrictEqual(checkMoneyInput('  8.00 '), { ok: true, value: '8.00' });
  });
  it('rejects empty input', () => assert.strictEqual(errorOf('  '), 'Enter an amount'));
  it('rejects negatives', () => {
    assert.strictEqual(errorOf('-1'), 'Amount cannot be negative');
    assert.strictEqual(errorOf('-0.50'), 'Amount cannot be negative');
  });
  it('rejects thousands separators', () => {
    for (const v of ['1,234.50', '1 234', "1'234", '1,5']) assert.match(errorOf(v) ?? '', /thousands separators/, v);
  });
  it('rejects more than 4 decimals', () => assert.strictEqual(errorOf('1.23456'), 'At most 4 decimal places'));
  it('rejects more than 10 integer digits', () => assert.strictEqual(errorOf('12345678901'), 'Amount is too large'));
  it('rejects anything else that is not a plain decimal', () => {
    for (const v of ['abc', '$5', '5.', '.5', '+5', '1e3', '5..2', 'NaN']) {
      assert.strictEqual(errorOf(v), 'Enter a number like 5 or 5.25', v);
    }
  });
});
