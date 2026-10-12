// Mixed-currency handling of the report pages (lib/reportCurrency.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveCurrency, currenciesOf, combineCurrencies, withRowCurrency, comparableTo, isMoneyMetricKey,
  mixedTitle, withCurrenciesMetric, MIXED_EXPORT, REPORT_MONEY_EXPORT_KEYS,
} from '../reportCurrency.ts';
import { toCsv } from '../export.ts';

describe('resolveCurrency', () => {
  it('single: the row’s one currency, not the network’s', () => {
    assert.deepStrictEqual(resolveCurrency(['USD'], 'EUR'), { kind: 'single', currency: 'USD' });
  });
  it('mixed: every distinct currency, de-duplicated, upper-cased and sorted', () => {
    assert.deepStrictEqual(resolveCurrency(['usd', 'EUR', 'USD'], 'EUR'), { kind: 'mixed', currencies: ['EUR', 'USD'] });
  });
  it('none: [] (no money-bearing conversions) → the fallback currency', () => {
    assert.deepStrictEqual(resolveCurrency([], 'EUR'), { kind: 'none', currency: 'EUR' });
  });
  it('absent (older API) or malformed → the fallback, i.e. today’s behaviour', () => {
    assert.deepStrictEqual(resolveCurrency(undefined, 'GBP'), { kind: 'none', currency: 'GBP' });
    assert.deepStrictEqual(resolveCurrency('USD', 'GBP'), { kind: 'none', currency: 'GBP' });
    assert.deepStrictEqual(resolveCurrency([null, '', 3], 'GBP'), { kind: 'none', currency: 'GBP' });
  });
  it('reads `currencies` out of a metrics bag', () => {
    assert.deepStrictEqual(currenciesOf({ clicks: 3, currencies: ['EUR'] }), ['EUR']);
    assert.strictEqual(currenciesOf({ clicks: 3 }), undefined);
    assert.strictEqual(currenciesOf(null), undefined);
  });
});

describe('combineCurrencies', () => {
  it('two single-currency rows in different currencies are mixed together', () => {
    assert.deepStrictEqual(combineCurrencies([['USD'], ['EUR'], []], 'USD'), { kind: 'mixed', currencies: ['EUR', 'USD'] });
  });
  it('rows sharing one currency stay single; no rows / older API → fallback', () => {
    assert.deepStrictEqual(combineCurrencies([['USD'], ['USD'], []], 'EUR'), { kind: 'single', currency: 'USD' });
    assert.deepStrictEqual(combineCurrencies([], 'EUR'), { kind: 'none', currency: 'EUR' });
    assert.deepStrictEqual(combineCurrencies([undefined, undefined], 'EUR'), { kind: 'none', currency: 'EUR' });
  });
});

describe('withRowCurrency (export rows)', () => {
  const row = { offer: 'Acme', clicks: 10, cvr: '1.00%', cpc: '0.10', revenue: '5.00', payout: '2.00', profit: '3.00', margin: '60.00%' };

  it('mixed: money columns left empty and currency "MIXED" — never a summed number', () => {
    const out = withRowCurrency(row, { kind: 'mixed', currencies: ['EUR', 'USD'] });
    assert.deepStrictEqual(out, { offer: 'Acme', clicks: 10, cvr: '1.00%', cpc: '', revenue: '', payout: '', profit: '', margin: '', currency: MIXED_EXPORT });
    assert.strictEqual(toCsv([out]), 'offer,clicks,cvr,cpc,revenue,payout,profit,margin,currency\nAcme,10,1.00%,,,,,,MIXED');
  });
  it('single: the row’s currency as the trailing column, money untouched', () => {
    assert.deepStrictEqual(withRowCurrency(row, { kind: 'single', currency: 'USD' }), { ...row, currency: 'USD' });
  });
  it('a mixed row next to single ones keeps the same columns (CSV header from the first row)', () => {
    const csv = toCsv([
      withRowCurrency({ offer: 'A', payout: '1.00' }, { kind: 'single', currency: 'USD' }),
      withRowCurrency({ offer: 'B', payout: '9.00' }, { kind: 'mixed', currencies: ['EUR', 'USD'] }),
    ]);
    assert.strictEqual(csv, 'offer,payout,currency\nA,1.00,USD\nB,,MIXED');
  });
  it('none: the fallback currency; an existing currency key is replaced and moved last', () => {
    const out = withRowCurrency({ currency: 'XXX', payout: '0.00', offer: 'A' }, { kind: 'none', currency: 'EUR' });
    assert.deepStrictEqual(Object.keys(out), ['payout', 'offer', 'currency']);
    assert.strictEqual(out['currency'], 'EUR');
  });
  it('custom money keys; a key the row lacks is not added', () => {
    const out = withRowCurrency({ actual: '9.00', dailyCap: '10.00' }, { kind: 'mixed', currencies: ['EUR', 'USD'] }, ['actual', 'dailyCapUsed']);
    assert.deepStrictEqual(out, { actual: '', dailyCap: '10.00', currency: 'MIXED' });
  });
  it('the default key list covers every money column of the aggregate exports', () => {
    for (const k of ['cpc', 'cpa', 'epc', 'rpc', 'rpa', 'revenue', 'payout', 'profit', 'margin']) {
      assert.ok((REPORT_MONEY_EXPORT_KEYS as readonly string[]).includes(k), k);
    }
  });
  it('does not mutate the input', () => {
    const src = { payout: '1.00' };
    withRowCurrency(src, { kind: 'mixed', currencies: ['A', 'B'] });
    assert.deepStrictEqual(src, { payout: '1.00' });
  });
});

describe('helpers', () => {
  it('mixedTitle names the currencies and says nothing was converted', () => {
    assert.strictEqual(mixedTitle(['EUR', 'USD']), 'Mixed currencies (EUR, USD) — not added together; no FX conversion yet');
  });
  it('comparableTo: only no money or the same single currency', () => {
    assert.strictEqual(comparableTo({ kind: 'none', currency: 'EUR' }, 'USD'), true);
    assert.strictEqual(comparableTo({ kind: 'single', currency: 'EUR' }, 'eur'), true);
    assert.strictEqual(comparableTo({ kind: 'single', currency: 'USD' }, 'EUR'), false);
    assert.strictEqual(comparableTo({ kind: 'mixed', currencies: ['EUR', 'USD'] }, 'EUR'), false);
  });
  it('payout/revenue are the money metric filters; counts are not', () => {
    assert.strictEqual(isMoneyMetricKey('payout'), true);
    assert.strictEqual(isMoneyMetricKey('revenue'), true);
    assert.strictEqual(isMoneyMetricKey('clicks'), false);
    assert.strictEqual(isMoneyMetricKey('cv'), false);
  });
  it('withCurrenciesMetric appends the currencies metric', () => {
    assert.strictEqual(withCurrenciesMetric('clicks,revenue'), 'clicks,revenue,currencies');
  });
});
