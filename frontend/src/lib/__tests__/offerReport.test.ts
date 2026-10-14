// Offer Report display / export rules (lib/offerReport.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { exactMoney, offerDisplay } from '../offerReport.ts';

const ID = '3f1c2a4e-1111-4222-8333-944455556666';

describe('offerDisplay', () => {
  it('a known offer: its name, and its numeric ref as the ID', () => {
    assert.deepStrictEqual(offerDisplay(ID, { name: 'Summer Promo', ref: 42 }, '(No offer)'), { name: 'Summer Promo', offerId: '42', known: true, title: 'Offer ID 42' });
  });
  it('a known offer without a ref falls back to its uuid', () => {
    assert.strictEqual(offerDisplay(ID, { name: 'X' }, '(No offer)').offerId, ID);
  });
  it('an id missing from the offer list shows the FULL id (never an ambiguous 8-char prefix) and says why', () => {
    const d = offerDisplay(ID, undefined, '(No offer)');
    assert.strictEqual(d.name, `Unknown offer (${ID})`);
    assert.strictEqual(d.offerId, ID);
    assert.strictEqual(d.known, false);
    assert.match(d.title ?? '', /not in the network's offer list/);
  });
  it('traffic with no offer keeps its label and no id', () => {
    assert.deepStrictEqual(offerDisplay(null, undefined, '(No offer)'), { name: '(No offer)', offerId: '', known: false, title: 'Traffic not attributed to an offer' });
  });
});

describe('exactMoney', () => {
  it('returns the API\'s exact decimal text — no float re-rounding', () => {
    const m = { payout: '12.3456', revenue: '0.0050', margin: '-0.0001' };
    assert.strictEqual(exactMoney(m, 'payout'), '12.3456');
    assert.strictEqual(exactMoney(m, 'revenue'), '0.0050'); // toFixed(2) would have written 0.01
    assert.strictEqual(exactMoney(m, 'margin'), '-0.0001'); // …and -0.00
  });
  it('missing → "0"; a numeric value passes through as text', () => {
    assert.strictEqual(exactMoney({}, 'payout'), '0');
    assert.strictEqual(exactMoney({ revenue: 5 }, 'revenue'), '5');
  });
});
