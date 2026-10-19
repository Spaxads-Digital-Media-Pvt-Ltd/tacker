// Platform billing helpers (lib/platformBilling.ts) — amounts are text and never pass through a float.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { formatAmount, money, centsToAmount, amountToCents, invoiceState, planPrice } from '../platformBilling.ts';

describe('platform billing helpers', () => {
  it('formats decimal text with grouping and two places', () => {
    assert.strictEqual(formatAmount('1234567.8'), '1,234,567.80');
    assert.strictEqual(formatAmount('99'), '99.00');
    assert.strictEqual(formatAmount('0.05'), '0.05');
    assert.strictEqual(formatAmount('000123.456'), '123.45');
    assert.strictEqual(formatAmount('99999999999999999.99'), '99,999,999,999,999,999.99'); // beyond a float's precision
    assert.strictEqual(money('116.82', 'USD'), 'USD 116.82');
  });
  it('converts cents and typed amounts both ways without floats', () => {
    assert.strictEqual(centsToAmount(9900), '99.00');
    assert.strictEqual(centsToAmount(1999), '19.99');
    assert.strictEqual(centsToAmount(5), '0.05');
    assert.strictEqual(amountToCents('19.99'), 1999);
    assert.strictEqual(amountToCents('99.5'), 9950);
    assert.strictEqual(amountToCents(' 250 '), 25000);
    assert.strictEqual(amountToCents('1.234'), null);
    assert.strictEqual(amountToCents('-1'), null);
  });
  it('names an open invoice past its due date "overdue"; prices plans by their interval', () => {
    assert.strictEqual(invoiceState({ status: 'open', overdue: true }), 'overdue');
    assert.strictEqual(invoiceState({ status: 'open', overdue: false }), 'open');
    assert.strictEqual(invoiceState({ status: 'paid', overdue: false }), 'paid');
    assert.strictEqual(planPrice({ price_cents: 9900, currency: 'USD', billing_interval: 'month' }), 'USD 99.00 / month');
    assert.strictEqual(planPrice({ price_cents: 0, currency: 'USD', billing_interval: 'year' }), 'Free');
  });
});
