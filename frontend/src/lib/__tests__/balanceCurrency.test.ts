// Partner balances per currency (lib/balanceCurrency.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { balanceParts, balanceText, formatParts, requestedBalancesMessage, sumPartsByCurrency } from '../balanceCurrency.ts';

describe('sumPartsByCurrency', () => {
  it('adds exactly within a currency and never across', () => {
    assert.deepStrictEqual(
      sumPartsByCurrency([
        { currency: 'USD', amount: '0.1' }, { currency: 'EUR', amount: '30.25' }, { currency: 'USD', amount: '0.2' },
        { currency: 'USD', amount: '12.7000' },
      ]),
      [{ currency: 'EUR', amount: '30.25' }, { currency: 'USD', amount: '13.0000' }],
    );
  });
  it('is empty for no parts', () => assert.deepStrictEqual(sumPartsByCurrency([]), []));
});

describe('balanceParts', () => {
  it('prefers the balances list (normalised, same currency merged)', () => {
    assert.deepStrictEqual(
      balanceParts({ balance: null, currency: null, balances: [{ currency: 'usd', balance: '1.50' }, { currency: 'EUR', balance: '2' }, { currency: 'USD', balance: '0.50' }] }),
      [{ currency: 'EUR', amount: '2' }, { currency: 'USD', amount: '2.00' }],
    );
  });
  it('falls back to balance + currency, or balance + balanceCurrency', () => {
    assert.deepStrictEqual(balanceParts({ balance: '5.0000', currency: 'eur' }), [{ currency: 'EUR', amount: '5.0000' }]);
    assert.deepStrictEqual(balanceParts({ balance: '5', balanceCurrency: 'GBP', balances: [] }), [{ currency: 'GBP', amount: '5' }]);
  });
  it('an empty balances list with no currency is "no balance"', () => {
    assert.deepStrictEqual(balanceParts({ balance: '0', currency: null, balances: [] }), []);
  });
  it('is null without currency information (older API) or for malformed entries', () => {
    assert.strictEqual(balanceParts({ balance: '12.00' }), null);
    assert.strictEqual(balanceParts({ balances: [{ currency: 'USD', balance: 'abc' }] }), null);
    assert.strictEqual(balanceParts({ balances: [{ balance: '1' }] }), null);
    assert.strictEqual(balanceParts(null), null);
  });
});

describe('balanceText', () => {
  it('formats one currency in that currency', () => {
    assert.deepStrictEqual(balanceText({ balance: '30.2500', currency: 'EUR', balances: [{ currency: 'EUR', balance: '30.2500' }] }), { text: '€30.25', muted: false });
  });
  it('shows several currencies as their parts, never a sum', () => {
    const t = balanceText({ balance: null, currency: null, balances: [{ currency: 'USD', balance: '13' }, { currency: 'EUR', balance: '30.25' }] });
    assert.strictEqual(t?.text, '€30.25 · $13.00');
    assert.match(t?.title ?? '', /EUR, USD/);
    assert.strictEqual(t?.muted, false);
  });
  it('zero balance in the fallback currency', () => {
    assert.deepStrictEqual(balanceText({ balance: '0', balances: [] }, 'USD'), { text: '$0.00', muted: false });
  });
  it('"Mixed" when balance is null without parts; null (caller keeps old display) for an older API', () => {
    assert.strictEqual(balanceText({ balance: null })?.text, 'Mixed');
    assert.strictEqual(balanceText({ balance: '12.00' }), null);
    assert.strictEqual(balanceText({ balance: undefined }), null);
  });
});

describe('formatParts', () => {
  it('joins each part in its own currency', () => {
    assert.strictEqual(formatParts([{ currency: 'EUR', amount: '1' }, { currency: 'USD', amount: '2.5' }]), '€1.00 · $2.50');
  });
});

describe('requestedBalancesMessage', () => {
  const names: Record<string, string> = { a: 'Acme', b: 'Beta', c: 'Core' };
  const nameOf = (id: string) => names[id] ?? id;

  it('totals per currency, exactly', () => {
    assert.strictEqual(
      requestedBalancesMessage([
        { publisherId: 'a', balance: '10.10', currency: 'USD', balances: [{ currency: 'USD', balance: '10.10' }] },
        { publisherId: 'b', balance: '0.20', currency: 'USD', balances: [{ currency: 'USD', balance: '0.20' }] },
      ], nameOf),
      'Recorded outstanding balance for 2 partners (total $10.30).',
    );
  });
  it('keeps currencies apart and lists a mixed partner with its breakdown', () => {
    assert.strictEqual(
      requestedBalancesMessage([
        { publisherId: 'a', balance: null, currency: null, balances: [{ currency: 'USD', balance: '3' }, { currency: 'EUR', balance: '10' }] },
        { publisherId: 'b', balance: '20.25', currency: 'EUR', balances: [{ currency: 'EUR', balance: '20.25' }] },
        { publisherId: 'c', balance: '10', currency: 'USD', balances: [{ currency: 'USD', balance: '10' }] },
      ], nameOf),
      'Recorded outstanding balance for 3 partners (total €30.25 · $13.00). Several currencies — Acme: €10.00 · $3.00.',
    );
  });
  it('an older API (no currency) gets no combined total — partners listed instead', () => {
    assert.strictEqual(
      requestedBalancesMessage([{ publisherId: 'a', balance: '12.50' }, { publisherId: 'b', balance: '1' }], nameOf),
      'Recorded outstanding balance for 2 partners. Currency not reported, not totalled — Acme 12.50; Beta 1.',
    );
  });
  it('never adds an unknown-currency balance into a known total', () => {
    assert.strictEqual(
      requestedBalancesMessage([
        { publisherId: 'a', balance: '5', currency: 'USD', balances: [{ currency: 'USD', balance: '5' }] },
        { publisherId: 'b', balance: '7' },
      ], nameOf),
      'Recorded outstanding balance for 2 partners (total $5.00). Currency not reported, not totalled — Beta 7.',
    );
  });
  it('no balances at all', () => {
    assert.strictEqual(
      requestedBalancesMessage([{ publisherId: 'a', balance: '0', currency: null, balances: [] }]),
      'Recorded outstanding balance for 1 partner (no outstanding balance).',
    );
  });
});
