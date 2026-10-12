// Regression tests for the shared report math (lib/reportMath.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deriveRow, daysAgo, money, todayStr } from '../reportMath.ts';

describe('deriveRow', () => {
  // 100 gross clicks, 10 invalid → 90 valid; 20 conversions of every status, 6 approved.
  const m = { clicks: 100, unique_clicks: 80, invalid_clicks: 10, total_conversions: 20, conversions: 6, payout: '30.0000', revenue: '60.0000', margin: '30.0000' };
  const d = deriveRow(m);

  it('CVR = approved conversions ÷ valid clicks (not all-status conversions)', () => {
    assert.strictEqual(d.cvr, 6 / 90);
  });
  it('CVR can no longer exceed 100% because of pending/rejected conversions', () => {
    const r = deriveRow({ clicks: 2, conversions: 1, total_conversions: 5 });
    assert.ok(r.cvr <= 1, `cvr ${r.cvr}`);
  });
  it('RPA = revenue ÷ approved conversions (revenue is approved-only)', () => {
    assert.strictEqual(d.rpa, 60 / 6);
  });
  it('CPA, CPC, RPC, margin %, dup and invalid clicks', () => {
    assert.strictEqual(d.cpa, 30 / 6);
    assert.strictEqual(d.cpc, 30 / 90);
    assert.strictEqual(d.rpc, 60 / 90);
    assert.strictEqual(d.marginPct, 0.5);
    assert.strictEqual(d.dupClicks, 20);
    assert.strictEqual(d.clicks, 90);
    assert.strictEqual(d.invalidPct, 0.1);
  });
  it('divides by zero safely', () => {
    const z = deriveRow({});
    assert.deepStrictEqual([z.cvr, z.cpa, z.cpc, z.rpc, z.rpa, z.marginPct, z.invalidPct], [0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('UTC date helpers', () => {
  it('daysAgo steps back whole UTC days, whatever the local clock says', () => {
    // 00:30 UTC on 1 March — local time in UTC+5:30 is still 06:00 the same day, in UTC-8 it is 28 Feb.
    const now = new Date('2026-03-01T00:30:00.000Z');
    assert.strictEqual(daysAgo(0, now), '2026-03-01');
    assert.strictEqual(daysAgo(1, now), '2026-02-28');
    assert.strictEqual(daysAgo(7, now), '2026-02-22');
    assert.strictEqual(todayStr(now), '2026-03-01');
  });
  it('daysAgo crosses month and year boundaries', () => {
    assert.strictEqual(daysAgo(1, new Date('2026-01-01T23:59:59.000Z')), '2025-12-31');
  });
});

describe('money', () => {
  it('formats in the given currency (USD by default)', () => {
    assert.strictEqual(money(1234.5), '$1,234.50');
    assert.strictEqual(money(1234.5, 'EUR'), '€1,234.50');
    assert.strictEqual(money(-3, 'USD'), '-$3.00');
  });
  it('falls back to the code for a currency Intl does not know', () => {
    assert.strictEqual(money(2, 'ZZZZ'), 'ZZZZ 2.00');
  });
});
