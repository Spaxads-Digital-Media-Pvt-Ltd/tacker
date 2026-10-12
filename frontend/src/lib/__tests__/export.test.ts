// Regression tests for CSV export (lib/export.ts) — formula injection + RFC 4180 quoting.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { csvCell, toCsv, withCurrencyColumn } from '../export.ts';

describe('csvCell', () => {
  it('neutralises spreadsheet formulas in text', () => {
    assert.strictEqual(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
    assert.strictEqual(csvCell('+cmd'), "'+cmd");
    assert.strictEqual(csvCell('-2+3'), "'-2+3");
    assert.strictEqual(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.strictEqual(csvCell('\tx'), "'\tx");
  });
  it('keeps real numbers (including negatives) numeric', () => {
    assert.strictEqual(csvCell('-5.0000'), '-5.0000');
    assert.strictEqual(csvCell(-3), '-3');
    assert.strictEqual(csvCell('+12'), '+12');
    assert.strictEqual(csvCell(0), '0');
  });
  it('quotes commas, quotes and line breaks; empty for null', () => {
    assert.strictEqual(csvCell('a,b'), '"a,b"');
    assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
    assert.strictEqual(csvCell('two\nlines'), '"two\nlines"');
    assert.strictEqual(csvCell(null), '');
    assert.strictEqual(csvCell(undefined), '');
  });
});

describe('toCsv', () => {
  it('writes a header row from the first row and one line per row', () => {
    assert.strictEqual(toCsv([{ name: 'Acme', payout: '1.5000' }, { name: '=evil', payout: '-2.0000' }]),
      "name,payout\nAcme,1.5000\n'=evil,-2.0000");
  });
  it('is empty for no rows', () => {
    assert.strictEqual(toCsv([]), '');
  });
});

describe('withCurrencyColumn', () => {
  it('appends the currency as the last column and leaves money as plain decimals', () => {
    const rows = withCurrencyColumn([{ offer: 'Acme', revenue: '1.05', payout: '0.50' }], 'EUR');
    assert.deepStrictEqual(rows, [{ offer: 'Acme', revenue: '1.05', payout: '0.50', currency: 'EUR' }]);
    assert.strictEqual(toCsv(rows), 'offer,revenue,payout,currency\nAcme,1.05,0.50,EUR');
  });
  it('keeps a row’s own currency', () => {
    assert.deepStrictEqual(withCurrencyColumn([{ revenue: '2.00', currency: 'GBP' }], 'USD'), [{ revenue: '2.00', currency: 'GBP' }]);
  });
  it('does not mutate the input and is empty for no rows', () => {
    const src = [{ revenue: '1.00' }];
    withCurrencyColumn(src, 'USD');
    assert.deepStrictEqual(src, [{ revenue: '1.00' }]);
    assert.deepStrictEqual(withCurrencyColumn([], 'USD'), []);
  });
});
