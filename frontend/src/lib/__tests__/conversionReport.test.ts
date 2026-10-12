// Conversion Report display rules (lib/conversionReport.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canModerateConversions, conversionCurrency, conversionMoney, formatDelta } from '../conversionReport.ts';

describe('conversionMoney', () => {
  it('formats in the currency stored on the conversion', () => {
    assert.deepStrictEqual(conversionMoney('1.2345', 'EUR'), { text: '€1.23' });
    assert.deepStrictEqual(conversionMoney('9.5000', 'USD'), { text: '$9.50' });
    assert.deepStrictEqual(conversionMoney('0.0000', 'GBP'), { text: '£0.00' });
  });
  it('a conversion without a currency is a plain amount with a note — never an assumed USD', () => {
    const m = conversionMoney('12.5000', null);
    assert.strictEqual(m.text, '12.50');
    assert.doesNotMatch(m.text, /\$|USD/);
    assert.match(m.title ?? '', /No currency/);
    assert.strictEqual(conversionMoney('3', '  ').text, '3.00');
  });
  it('missing money stays missing', () => {
    for (const v of [null, undefined, '']) assert.deepStrictEqual(conversionMoney(v, 'USD'), { text: '—' });
  });
});

describe('conversionCurrency', () => {
  it('the conversion\'s own currency, or "—" (export / Currency column never invents USD)', () => {
    assert.strictEqual(conversionCurrency('EUR'), 'EUR');
    for (const v of [null, undefined, '', ' ']) assert.strictEqual(conversionCurrency(v), '—');
  });
});

describe('formatDelta', () => {
  it('click → conversion time', () => {
    assert.strictEqual(formatDelta(45), '45s');
    assert.strictEqual(formatDelta(200), '3m 20s');
    assert.strictEqual(formatDelta(26 * 3600 + 5 * 60), '26h 5m');
    assert.strictEqual(formatDelta(null), '—');
  });
});

describe('canModerateConversions', () => {
  it('only the roles the API allows to approve / reject (admin, finance)', () => {
    assert.strictEqual(canModerateConversions('admin'), true);
    assert.strictEqual(canModerateConversions('finance'), true);
    for (const r of ['manager', 'read_only', '', null, undefined]) assert.strictEqual(canModerateConversions(r), false);
  });
});
