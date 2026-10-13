// Flex Report sort / export rules (lib/flexReport.ts) — imports the real module and the real
// deriveRow the page uses for its Clicks column.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FLEX_COLUMN_SORT, DEFAULT_FLEX_ORDER, flexOrderBy, flexExportRow } from '../flexReport.ts';
import { deriveRow } from '../reportMath.ts';

describe('Flex Report sorting', () => {
  it('the Clicks column sorts by the net clicks it shows (valid_clicks), not gross clicks', () => {
    assert.strictEqual(FLEX_COLUMN_SORT.Clicks, 'valid_clicks');
    // What the column shows for a row with fraud-flagged clicks: gross 8 − invalid 6 = 2.
    assert.strictEqual(deriveRow({ clicks: 8, invalid_clicks: 6 }).clicks, 2);
  });
  it('every other sortable column keeps its own metric', () => {
    assert.deepStrictEqual(
      { tcv: FLEX_COLUMN_SORT['Total CV'], rev: FLEX_COLUMN_SORT.Revenue, pay: FLEX_COLUMN_SORT.Payout, profit: FLEX_COLUMN_SORT.Profit },
      { tcv: 'total_conversions', rev: 'revenue', pay: 'payout', profit: 'margin' },
    );
  });
  it('defaults to the Clicks column sort', () => {
    assert.strictEqual(DEFAULT_FLEX_ORDER, 'valid_clicks');
    assert.strictEqual(flexOrderBy(null), 'valid_clicks');
    assert.strictEqual(flexOrderBy(''), 'valid_clicks');
  });
  it('reads a legacy `orderBy=clicks` link or saved report as the Clicks column', () => {
    assert.strictEqual(flexOrderBy('clicks'), 'valid_clicks');
  });
  it('keeps a known sort and falls back on an unknown one', () => {
    for (const k of ['valid_clicks', 'total_conversions', 'payout', 'revenue', 'margin']) assert.strictEqual(flexOrderBy(k), k);
    assert.strictEqual(flexOrderBy('epc'), 'valid_clicks');
    assert.strictEqual(flexOrderBy("x' OR 1=1"), 'valid_clicks');
  });
});

describe('Flex Report export row', () => {
  const metrics = { clicks: 8, invalid_clicks: 6, conversions: 1, total_conversions: 3, payout: '1.2345', revenue: '3.0050', margin: '1.7705', epc: 0.1543 };
  const row = flexExportRow([{ label: 'Offer', name: 'Offer A' }, { label: 'Partner', name: 'Partner 1' }], deriveRow(metrics), metrics);

  it('starts with the picked dimension columns, by label', () => {
    assert.deepStrictEqual(Object.keys(row).slice(0, 2), ['Offer', 'Partner']);
    assert.strictEqual(row['Offer'], 'Offer A');
    assert.strictEqual(row['Partner'], 'Partner 1');
  });
  it('exports the net clicks the table shows and all-status Total CV', () => {
    assert.strictEqual(row['clicks'], 2);
    assert.strictEqual(row['totalCv'], 3);
  });
  it('exports money as the exact API decimal text — never a re-rounded float', () => {
    assert.strictEqual(row['payout'], '1.2345');
    assert.strictEqual(row['revenue'], '3.0050');
    assert.strictEqual(row['profit'], '1.7705');
  });
  it('exports the API EPC unrounded', () => {
    assert.strictEqual(row['epc'], '0.1543');
  });
  it('a row without conversions exports zero money, not an empty or NaN cell', () => {
    const m = { clicks: 4, invalid_clicks: 0, conversions: 0, total_conversions: 0, payout: '0.0000', revenue: '0.0000', margin: '0.0000', epc: 0 };
    const r = flexExportRow([{ label: 'Country', name: 'US' }], deriveRow(m), m);
    assert.deepStrictEqual(
      { payout: r['payout'], revenue: r['revenue'], profit: r['profit'], epc: r['epc'], cvr: r['cvr'], margin: r['margin'] },
      { payout: '0.0000', revenue: '0.0000', profit: '0.0000', epc: '0', cvr: '0.00%', margin: '0.00%' },
    );
  });
});
