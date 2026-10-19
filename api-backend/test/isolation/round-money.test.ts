/**
 * roundMoney (O9): amounts from outside the app (offer feeds) are parsed and rounded exactly — never
 * through a float — half away from zero to 4 dp, exponent notation included; junk is refused.
 */
import { describe, it, expect } from 'vitest';
import { roundMoney, MoneyFormatError } from '../../src/lib/money.js';

describe('roundMoney', () => {
  it('keeps exact decimals and pads to 4 dp', () => {
    expect(roundMoney('12')).toBe('12.0000');
    expect(roundMoney('12.5')).toBe('12.5000');
    expect(roundMoney(8.5)).toBe('8.5000');
    expect(roundMoney('0')).toBe('0.0000');
    expect(roundMoney('-0.00001')).toBe('0.0000');
  });
  it('rounds half away from zero on the 5th decimal — exactly', () => {
    expect(roundMoney('1.23455')).toBe('1.2346');
    expect(roundMoney('1.234549999999999999')).toBe('1.2345');
    expect(roundMoney('-1.23455')).toBe('-1.2346');
    expect(roundMoney('0.00005')).toBe('0.0001');
    expect(roundMoney('9999999999.99994')).toBe('9999999999.9999');
  });
  it('a float would get these wrong; the source text does not', () => {
    // 1.005 is 1.00499999999999989… as a double: toFixed(2) gives 1.00. Exact text math gives 1.0050.
    expect(roundMoney('1.00005')).toBe('1.0001');
    expect(roundMoney('0.1')).toBe('0.1000');
    expect(roundMoney('123456789.12345')).toBe('123456789.1235');
  });
  it('expands exponent notation exactly', () => {
    expect(roundMoney('1e3')).toBe('1000.0000');
    expect(roundMoney('1.5e-3')).toBe('0.0015');
    expect(roundMoney('12.345E1')).toBe('123.4500');
    expect(roundMoney('5e-5')).toBe('0.0001');
    expect(roundMoney(1e-7)).toBe('0.0000');
  });
  it('refuses junk and amounts that do not fit numeric(14,4)', () => {
    for (const bad of ['abc', '', '1,000.00', '$5', '1.2.3', 'NaN', '12e9999']) {
      expect(() => roundMoney(bad), bad).toThrow(MoneyFormatError);
    }
    expect(() => roundMoney(Number.NaN)).toThrow(MoneyFormatError);
    expect(() => roundMoney('10000000000')).toThrow(/too large/);
    expect(() => roundMoney('9999999999.99995')).toThrow(/too large/); // rounds up past the column
  });
});
