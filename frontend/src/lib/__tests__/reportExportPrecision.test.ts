// Export precision (lib/reportMath `exportRatio`, lib/reportExportCells `moneyExportCells`, the Offer /
// Flex ratio cells) — the real modules, against the real on-screen formatter (reportMath `money`) and
// the real mixed-currency blanking (reportCurrency `withRowCurrency`).
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { exportRatio, money, deriveRow } from '../reportMath.ts';
import { moneyExportCells } from '../reportExportCells.ts';
import { flexExportRow } from '../flexReport.ts';
import { withRowCurrency, MIXED_EXPORT, REPORT_MONEY_EXPORT_KEYS } from '../reportCurrency.ts';

/** What the table shows for a value, without the symbol / grouping. */
const screen = (v: number) => money(v, 'USD').replace('$', '').replace(/,/g, '');

describe('exportRatio — calculated ratios round like the screen', () => {
  it('the values toFixed(2) got wrong now match the table', () => {
    // toFixed(2) gave 3.00 / 2.67 / 1.00 (it rounds the binary float, e.g. 1.00499…).
    assert.strictEqual(exportRatio(3.005), '3.01');
    assert.strictEqual(exportRatio(2.675), '2.68');
    assert.strictEqual(exportRatio(1.005), '1.01');
    for (const v of [3.005, 2.675, 1.005]) assert.strictEqual(exportRatio(v), screen(v));
  });
  it('ordinary values: 10/3, 0, 0.125, 1.2345', () => {
    assert.strictEqual(exportRatio(10 / 3), '3.33');
    assert.strictEqual(exportRatio(0), '0.00');
    assert.strictEqual(exportRatio(0.125), '0.13');
    assert.strictEqual(exportRatio(1.2345), '1.23');
  });
  it('no thousands separator or symbol (a CSV number), and non-finite input is 0.00', () => {
    assert.strictEqual(exportRatio(1234567.891), '1234567.89');
    assert.strictEqual(exportRatio(Number.NaN), '0.00');
    assert.strictEqual(exportRatio(Number.POSITIVE_INFINITY), '0.00');
  });
  it('agrees with the on-screen money() for every ratio of 4-decimal amounts tried', () => {
    // payout / revenue are numeric(14,4); a ratio is amount ÷ count — sweep real-shaped quotients.
    let checked = 0;
    for (let cents = 0; cents <= 20_000; cents += 7) {
      const amount = cents / 10_000 * 37; // 4-decimal-ish amounts up to ~74
      for (const count of [1, 2, 3, 7, 11, 40]) {
        const v = amount / count;
        assert.strictEqual(exportRatio(v), screen(v), `amount ${amount} / ${count}`);
        checked++;
      }
    }
    assert.ok(checked > 10_000);
  });
});

describe('moneyExportCells — Partner / Smart Link / Daily / Hourly / Nested export cells', () => {
  const metrics = { clicks: 8, invalid_clicks: 6, conversions: 1, total_conversions: 3, payout: '1.2345', revenue: '3.0050', margin: '1.7705', epc: 0.1543 };
  const d = deriveRow(metrics);

  it('stored money is the exact API text — never re-rounded', () => {
    const c = moneyExportCells(d, metrics);
    assert.deepStrictEqual({ revenue: c['revenue'], payout: c['payout'], profit: c['profit'] }, { revenue: '3.0050', payout: '1.2345', profit: '1.7705' });
  });
  it('ratios use the screen rounding (RPA 3.005 → 3.01, not toFixed\'s 3.00)', () => {
    const c = moneyExportCells(d, metrics);
    // 2 valid clicks (8 − 6), 1 approved conversion.
    assert.deepStrictEqual({ cpc: c['cpc'], cpa: c['cpa'], rpc: c['rpc'], rpa: c['rpa'] }, { cpc: '0.62', cpa: '1.23', rpc: '1.50', rpa: '3.01' });
    assert.strictEqual(c['rpa'], screen(d.rpa));
  });
  it('EPC only when asked (Partner), as the API value, in column order cpc, cpa, epc, rpc, rpa, revenue, payout, profit', () => {
    assert.ok(!('epc' in moneyExportCells(d, metrics)));
    const c = moneyExportCells(d, metrics, { epc: true });
    assert.strictEqual(c['epc'], '0.1543');
    assert.deepStrictEqual(Object.keys(c), ['cpc', 'cpa', 'epc', 'rpc', 'rpa', 'revenue', 'payout', 'profit']);
    assert.deepStrictEqual(Object.keys(moneyExportCells(d, metrics)), ['cpc', 'cpa', 'rpc', 'rpa', 'revenue', 'payout', 'profit']);
  });
  it('a row without conversions exports zero money as the API sent it and 0.00 ratios', () => {
    const m = { clicks: 4, invalid_clicks: 0, conversions: 0, total_conversions: 0, payout: '0.0000', revenue: '0.0000', margin: '0.0000', epc: 0 };
    assert.deepStrictEqual(moneyExportCells(deriveRow(m), m, { epc: true }),
      { cpc: '0.00', cpa: '0.00', epc: '0', rpc: '0.00', rpa: '0.00', revenue: '0.0000', payout: '0.0000', profit: '0.0000' });
  });
  it('mixed-currency behavior is unchanged: every money/ratio cell blanked, currency MIXED', () => {
    const row = withRowCurrency({ partner: 'P', ...moneyExportCells(d, metrics, { epc: true }) }, { kind: 'mixed', currencies: ['EUR', 'USD'] });
    for (const k of ['cpc', 'cpa', 'epc', 'rpc', 'rpa', 'revenue', 'payout', 'profit']) {
      assert.ok((REPORT_MONEY_EXPORT_KEYS as readonly string[]).includes(k), k);
      assert.strictEqual(row[k], '', k);
    }
    assert.strictEqual(row['currency'], MIXED_EXPORT);
    const single = withRowCurrency({ ...moneyExportCells(d, metrics) }, { kind: 'single', currency: 'EUR' });
    assert.deepStrictEqual({ revenue: single['revenue'], rpa: single['rpa'], currency: single['currency'] }, { revenue: '3.0050', rpa: '3.01', currency: 'EUR' });
  });
});

describe('Flex export ratios', () => {
  it('RPA / CPA use the screen rounding; money and EPC stay exact', () => {
    const metrics = { clicks: 8, invalid_clicks: 6, conversions: 1, total_conversions: 3, payout: '1.2345', revenue: '3.0050', margin: '1.7705', epc: 0.1543 };
    const r = flexExportRow([{ label: 'Offer', name: 'A' }], deriveRow(metrics), metrics);
    assert.deepStrictEqual({ rpa: r['rpa'], cpa: r['cpa'], revenue: r['revenue'], epc: r['epc'] }, { rpa: '3.01', cpa: '1.23', revenue: '3.0050', epc: '0.1543' });
  });
});
