// The shared money formatter (lib/moneyFormat.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { moneyAxisTick, moneyDisplay, moneyExact, moneyIn, parseMoney } from '../moneyFormat.ts';

describe('parseMoney', () => {
  it('null / undefined are missing; a real zero is 0; text that is not a number is NaN', () => {
    assert.strictEqual(parseMoney(null), null);
    assert.strictEqual(parseMoney(undefined), null);
    assert.strictEqual(parseMoney('0'), 0);
    assert.strictEqual(parseMoney('0.0000'), 0);
    assert.strictEqual(parseMoney(' 12.5000 '), 12.5);
    assert.ok(Number.isNaN(parseMoney('')!));
    assert.ok(Number.isNaN(parseMoney('abc')!));
  });
});

describe('moneyDisplay / moneyIn', () => {
  it('"—" only for null / undefined', () => {
    assert.deepStrictEqual(moneyIn(null, 'USD'), { text: '—', muted: true });
    assert.deepStrictEqual(moneyIn(undefined, 'EUR'), { text: '—', muted: true });
  });

  it('a real "0" / "0.0000" renders as 0.00 in its currency', () => {
    assert.strictEqual(moneyIn('0', 'USD').text, '$0.00');
    assert.strictEqual(moneyIn('0.0000', 'EUR').text, '€0.00');
    assert.strictEqual(moneyIn(0, 'USD').muted, false);
  });

  it('formats a decimal string in the resolved currency', () => {
    assert.strictEqual(moneyIn('1234.5000', 'USD').text, '$1,234.50');
    assert.strictEqual(moneyDisplay('30.25', { kind: 'none', currency: 'EUR' }).text, '€30.25');
  });

  it('non-numeric text is flagged, never silently 0', () => {
    assert.deepStrictEqual(moneyIn('abc', 'USD'), { text: 'Invalid amount', muted: true });
  });

  it('a mixed-currency row shows "Mixed" (or the per-currency breakdown when roomy) — never a sum', () => {
    const rc = { kind: 'mixed' as const, currencies: ['EUR', 'USD'] };
    assert.strictEqual(moneyDisplay('43.25', rc).text, 'Mixed');
    const breakdown = { EUR: { revenue: '30.25' }, USD: { revenue: '13.00' } };
    assert.strictEqual(moneyDisplay('43.25', rc, { breakdown, field: 'revenue', roomy: true }).text, '€30.25 · $13.00');
  });
});

describe('moneyIn { decimals }', () => {
  it('fixes the fraction digits without changing the value', () => {
    assert.deepStrictEqual(moneyIn('1.5', 'USD', { decimals: 3 }), { text: '$1.500', muted: false });
    assert.deepStrictEqual(moneyIn(0.1234, 'USD', { decimals: 3 }), { text: '$0.123', muted: false });
    assert.deepStrictEqual(moneyIn('2', 'EUR', { decimals: 3 }), { text: '€2.000', muted: false });
  });
  it('keeps the missing / invalid readings, and the default path is unchanged', () => {
    assert.deepStrictEqual(moneyIn(null, 'USD', { decimals: 3 }), { text: '—', muted: true });
    assert.deepStrictEqual(moneyIn('abc', 'USD', { decimals: 3 }), { text: 'Invalid amount', muted: true });
    assert.deepStrictEqual(moneyIn('1.5', 'USD'), moneyIn('1.5', 'USD', {}));
  });
  it('falls back to "CODE 1.500" for a code Intl rejects', () => {
    assert.strictEqual(moneyIn('1.5', 'NOTACODE', { decimals: 3 }).text, 'NOTACODE 1.500');
  });
});

describe('moneyAxisTick / moneyExact', () => {
  it('compact ticks in one currency', () => {
    assert.strictEqual(moneyAxisTick(0, 'USD'), '$0');
    assert.strictEqual(moneyAxisTick(1500, 'USD'), '$1.5K');
    assert.strictEqual(moneyAxisTick(2_300_000, 'EUR'), '€2.3M');
  });

  it('falls back to the code for a currency Intl rejects', () => {
    assert.strictEqual(moneyAxisTick(1500, 'NOT-A-CODE'), 'NOT-A-CODE 1.5K');
  });

  it('exact amounts keep two decimals', () => {
    assert.strictEqual(moneyExact(46120, 'USD'), '$46,120.00');
  });
});
