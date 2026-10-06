import { describe, it, expect } from 'vitest';
import { addMoney, subMoneyFloorZero, percentOfMoney } from '../../src/lib/money.js';
import { applyAction } from '../../src/lib/tiered-commissions/evaluate.js';

describe('exact decimal money helpers', () => {
  it('adds without float drift', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3000');
    expect(addMoney('9999999999.9999', '0.0001')).toBe('10000000000.0000');
  });

  it('subtracts and clamps at zero', () => {
    expect(subMoneyFloorZero('5.0000', '1.2500')).toBe('3.7500');
    expect(subMoneyFloorZero('1.0000', '3.0000')).toBe('0.0000');
  });

  it('rounds percentages half-up at 4 dp where float toFixed gets it wrong', () => {
    // 0.009 × 5% = 0.00045 exactly → 0.0005 half-up. The old float path produced 0.0004.
    expect(((0.009 * 5) / 100).toFixed(4)).toBe('0.0004');
    expect(percentOfMoney('0.009', 5)).toBe('0.0005');
    expect(percentOfMoney('0.007', 15)).toBe('0.0011');
    expect(percentOfMoney('200', '12.5')).toBe('25.0000');
    expect(percentOfMoney('19.99', 15)).toBe('2.9985');
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => percentOfMoney('abc', 10)).toThrow();
    expect(() => percentOfMoney('10', '1e3')).toThrow();
  });
});

describe('tiered commission actions use exact decimals', () => {
  it('applies flat and percentage adjustments', () => {
    expect(applyAction('10.0000', 'increase_flat', '2.5')).toBe('12.5000');
    expect(applyAction('10.0000', 'decrease_flat', '12')).toBe('0.0000');
    expect(applyAction('24.6910', 'increase_pct', '5')).toBe('25.9256');
    expect(applyAction('24.6910', 'decrease_pct', '5')).toBe('23.4564');
  });

  it('leaves the base untouched with no action', () => {
    expect(applyAction('7.0000', null, '5')).toBe('7.0000');
  });
});
