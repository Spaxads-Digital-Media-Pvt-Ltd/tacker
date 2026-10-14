// Per-currency breakdowns, money sorting, money-filter applicability and period comparisons
// (lib/reportCurrency.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import {
  addDecimal, combineMoneyByCurrency, comparePeriods, currencySpan, filterWithMoneyRule, formatBreakdown, hasMoneyFilter,
  moneyByCurrencyOf, moneyFilterBlockedBy, moneyFilterNote, moneyRowComparator, moneyText, parseMoneyByCurrency,
  showSortedWithinNote, sortMoneyRows, withBreakdownMetrics, MIXED_LABEL, type RowCurrency,
} from '../reportCurrency.ts';

const usd: RowCurrency = { kind: 'single', currency: 'USD' };
const eur: RowCurrency = { kind: 'single', currency: 'EUR' };
const gbp: RowCurrency = { kind: 'single', currency: 'GBP' };
const none: RowCurrency = { kind: 'none', currency: 'USD' };
const mixed: RowCurrency = { kind: 'mixed', currencies: ['EUR', 'USD'] };

describe('parseMoneyByCurrency / moneyByCurrencyOf', () => {
  it('normalises codes and keeps decimal strings only', () => {
    assert.deepStrictEqual(
      parseMoneyByCurrency({ usd: { payout: '13.00', revenue: 20, margin: 'x' }, ' eur ': { payout: '30.25' } }),
      { USD: { payout: '13.00', revenue: '20' }, EUR: { payout: '30.25' } },
    );
  });
  it('absent / malformed (older API) → null; {} stays {}', () => {
    assert.strictEqual(parseMoneyByCurrency(undefined), null);
    assert.strictEqual(parseMoneyByCurrency([]), null);
    assert.strictEqual(parseMoneyByCurrency('USD'), null);
    assert.deepStrictEqual(parseMoneyByCurrency({}), {});
  });
  it('reads the opt-in metric out of a metrics bag', () => {
    assert.deepStrictEqual(moneyByCurrencyOf({ clicks: 1, money_by_currency: { EUR: { revenue: '1.5' } } }), { EUR: { revenue: '1.5' } });
    assert.strictEqual(moneyByCurrencyOf({ clicks: 1 }), null);
  });
  it('the summary metrics list asks for currencies and the breakdown', () => {
    assert.strictEqual(withBreakdownMetrics('clicks,payout'), 'clicks,payout,currencies,money_by_currency');
  });
});

describe('addDecimal / combineMoneyByCurrency', () => {
  it('adds exact decimal text without float drift', () => {
    assert.strictEqual(addDecimal('0.1', '0.2'), '0.3');
    assert.strictEqual(addDecimal('10.0000', '-12.5'), '-2.5000');
    assert.strictEqual(addDecimal('5', '0.05'), '5.05');
  });
  it('adds per currency only — never across currencies', () => {
    const a = { EUR: { payout: '10.00', revenue: '20.00' }, USD: { payout: '1.00', revenue: '2.00' } };
    const b = { EUR: { payout: '0.25', revenue: '0.50' } };
    assert.deepStrictEqual(combineMoneyByCurrency([a, b]), { EUR: { payout: '10.25', revenue: '20.50' }, USD: { payout: '1.00', revenue: '2.00' } });
  });
  it('null when no part has a breakdown; a field missing from one part is dropped', () => {
    assert.strictEqual(combineMoneyByCurrency([null, undefined]), null);
    assert.deepStrictEqual(combineMoneyByCurrency([{ EUR: { payout: '1', revenue: '2' } }, { EUR: { payout: '1' } }]), { EUR: { payout: '2' } });
  });
});

describe('formatBreakdown / moneyText', () => {
  const mbc = { USD: { payout: '13', revenue: '20', margin: '7' }, EUR: { payout: '30.25', revenue: '40', margin: '9.75' } };
  it('one amount per currency, ordered by code', () => {
    assert.strictEqual(formatBreakdown(mbc, 'payout'), '€30.25 · $13.00');
  });
  it('null when there is no usable breakdown (empty, absent, or a currency lacks the field)', () => {
    assert.strictEqual(formatBreakdown({}, 'payout'), null);
    assert.strictEqual(formatBreakdown(null, 'payout'), null);
    assert.strictEqual(formatBreakdown({ USD: { payout: '1' }, EUR: {} }, 'payout'), null);
  });
  it('single → its own currency; none → the fallback', () => {
    assert.deepStrictEqual(moneyText(5, eur), { text: '€5.00', muted: false });
    assert.deepStrictEqual(moneyText(0, { kind: 'none', currency: 'GBP' }), { text: '£0.00', muted: false });
  });
  it('mixed + roomy (tiles, totals) → the breakdown', () => {
    const t = moneyText(43.25, mixed, { breakdown: mbc, field: 'payout', roomy: true });
    assert.strictEqual(t.text, '€30.25 · $13.00');
    assert.strictEqual(t.muted, false);
    assert.match(t.title ?? '', /not added together/);
  });
  it('mixed in a table cell → "Mixed", breakdown in the tooltip', () => {
    const t = moneyText(43.25, mixed, { breakdown: mbc, field: 'payout' });
    assert.strictEqual(t.text, MIXED_LABEL);
    assert.match(t.title ?? '', /€30\.25 · \$13\.00/);
  });
  it('mixed without a breakdown (older API) or for a ratio → "Mixed", never the summed number', () => {
    assert.strictEqual(moneyText(43.25, mixed, { field: 'payout', roomy: true }).text, MIXED_LABEL);
    assert.strictEqual(moneyText(1.5, mixed, { breakdown: mbc, roomy: true }).text, MIXED_LABEL);
  });
});

describe('moneyRowComparator / sortMoneyRows', () => {
  interface R { id: string; rc: RowCurrency; v: number }
  const rows: R[] = [
    { id: 'mix1', rc: mixed, v: 999 },
    { id: 'usd5', rc: usd, v: 5 },
    { id: 'none', rc: none, v: 0 },
    { id: 'eur1', rc: eur, v: 1 },
    { id: 'usd9', rc: usd, v: 9 },
    { id: 'mix2', rc: mixed, v: 1 },
    { id: 'eur7', rc: eur, v: 7 },
    { id: 'gbp3', rc: gbp, v: 3 },
  ];
  const ids = (rs: R[]) => rs.map((r) => r.id);
  it('desc: currencies by code, value within each; no-money rows; mixed last in their order', () => {
    assert.deepStrictEqual(ids(sortMoneyRows(rows, (r) => r.rc, (r) => r.v, 'desc')), ['eur7', 'eur1', 'gbp3', 'usd9', 'usd5', 'none', 'mix1', 'mix2']);
  });
  it('asc keeps the partition order, flips only the within-currency order', () => {
    assert.deepStrictEqual(ids(sortMoneyRows(rows, (r) => r.rc, (r) => r.v, 'asc')), ['eur1', 'eur7', 'gbp3', 'usd5', 'usd9', 'none', 'mix1', 'mix2']);
  });
  it('older API (every row "none") sorts by value exactly as before', () => {
    const old: R[] = [{ id: 'a', rc: none, v: 2 }, { id: 'b', rc: none, v: 8 }, { id: 'c', rc: none, v: 5 }];
    assert.deepStrictEqual(ids([...old].sort(moneyRowComparator((r) => r.rc, (r) => r.v, 'desc'))), ['b', 'c', 'a']);
  });
  it('does not mutate its input', () => {
    const before = ids(rows);
    sortMoneyRows(rows, (r) => r.rc, (r) => r.v, 'desc');
    assert.deepStrictEqual(ids(rows), before);
  });
});

describe('currencySpan / sorted-within note', () => {
  it('several single currencies, or any mixed row, span more than one', () => {
    assert.deepStrictEqual(currencySpan([usd, eur, none]), { currencies: ['EUR', 'USD'], multi: true });
    assert.deepStrictEqual(currencySpan([usd, mixed]), { currencies: ['EUR', 'USD'], multi: true });
    assert.deepStrictEqual(currencySpan([usd, usd, none]), { currencies: ['USD'], multi: false });
    assert.deepStrictEqual(currencySpan([none]), { currencies: [], multi: false });
  });
  it('the note needs the API flag AND rows spanning currencies', () => {
    assert.strictEqual(showSortedWithinNote(true, [usd, eur]), true);
    assert.strictEqual(showSortedWithinNote(true, [usd, usd]), false);
    assert.strictEqual(showSortedWithinNote(undefined, [usd, eur]), false);
  });
});

describe('money metric filters', () => {
  it('blocked (with the currencies) when the loaded rows span several; applicable with one', () => {
    assert.deepStrictEqual(moneyFilterBlockedBy([usd, eur]), ['EUR', 'USD']);
    assert.deepStrictEqual(moneyFilterBlockedBy([usd, mixed]), ['EUR', 'USD']);
    assert.strictEqual(moneyFilterBlockedBy([usd, none, usd]), null);
    assert.strictEqual(moneyFilterBlockedBy([none]), null);
    assert.strictEqual(moneyFilterNote(['EUR', 'USD']), 'Money filters need a single currency — results span EUR, USD');
  });
  it('only a set, numeric Payout/Revenue filter counts as a money filter', () => {
    assert.strictEqual(hasMoneyFilter({ payout: { value: '100' } }), true);
    assert.strictEqual(hasMoneyFilter({ revenue: { value: '' } }), false);
    assert.strictEqual(hasMoneyFilter({ clicks: { value: '5' } }), false);
    assert.strictEqual(hasMoneyFilter({ payout: { value: 'abc' } }), false);
  });
  it('filterWithMoneyRule tells the filter to skip money filters exactly when rows span currencies', () => {
    interface R { rc: RowCurrency; payout: number; clicks: number }
    const passes = (r: R, skipMoney: boolean) => (skipMoney || r.payout > 10) && r.clicks > 0;
    const oneCurrency: R[] = [{ rc: usd, payout: 5, clicks: 1 }, { rc: usd, payout: 50, clicks: 1 }, { rc: none, payout: 0, clicks: 0 }];
    assert.strictEqual(filterWithMoneyRule(oneCurrency, (r) => r.rc, passes).length, 1); // applied
    const spans: R[] = [{ rc: usd, payout: 5, clicks: 1 }, { rc: eur, payout: 50, clicks: 1 }, { rc: mixed, payout: 1, clicks: 0 }];
    assert.strictEqual(filterWithMoneyRule(spans, (r) => r.rc, passes).length, 2); // money skipped, clicks still applied
  });
});

describe('comparePeriods (Variance + Dashboard change %)', () => {
  it('same single currency → comparable in it', () => {
    assert.deepStrictEqual(comparePeriods(eur, eur), { ok: true, currency: 'EUR' });
  });
  it('different currencies → "—" with the reason', () => {
    const c = comparePeriods(eur, usd);
    assert.strictEqual(c.ok, false);
    if (!c.ok) { assert.strictEqual(c.label, '—'); assert.match(c.reason, /EUR vs USD/); }
  });
  it('either period mixed → "Mixed"', () => {
    const c = comparePeriods(usd, mixed);
    assert.strictEqual(c.ok, false);
    if (!c.ok) assert.strictEqual(c.label, MIXED_LABEL);
    assert.strictEqual(comparePeriods(mixed, none).ok, false);
  });
  it('a period without money (zero) compares with a single currency; two without → the fallback (older API)', () => {
    assert.deepStrictEqual(comparePeriods(none, gbp), { ok: true, currency: 'GBP' });
    assert.deepStrictEqual(comparePeriods(usd, none), { ok: true, currency: 'USD' });
    assert.deepStrictEqual(comparePeriods(none, none), { ok: true, currency: 'USD' });
  });
});
