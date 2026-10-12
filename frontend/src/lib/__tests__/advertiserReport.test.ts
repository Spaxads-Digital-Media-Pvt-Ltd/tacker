// Advertiser Report display rules (lib/advertiserReport.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { advertiserDisplay, apiEpc } from '../advertiserReport.ts';

const ID = '7a1c2a4e-1111-4222-8333-944455556666';

describe('advertiserDisplay', () => {
  it('a known advertiser: its name, and its numeric ref as the ID', () => {
    assert.deepStrictEqual(advertiserDisplay(ID, { name: 'Acme', ref: 7 }, '(No advertiser)'), { name: 'Acme', advertiserId: '7', known: true, title: 'Advertiser ID 7' });
  });
  it('a known advertiser without a ref falls back to its uuid', () => {
    assert.strictEqual(advertiserDisplay(ID, { name: 'Acme' }, '(No advertiser)').advertiserId, ID);
  });
  it('an id missing from the list shows the FULL id (never an ambiguous 8-char prefix) and says why', () => {
    const d = advertiserDisplay(ID, undefined, '(No advertiser)');
    assert.strictEqual(d.name, `Unknown advertiser (${ID})`);
    assert.strictEqual(d.advertiserId, ID);
    assert.strictEqual(d.known, false);
    assert.match(d.title ?? '', /not in the network's advertiser list/);
  });
  it('traffic with no advertiser keeps its label and no id', () => {
    assert.deepStrictEqual(advertiserDisplay(null, undefined, '(No advertiser)'), { name: '(No advertiser)', advertiserId: '', known: false, title: 'Traffic not attributed to an advertiser' });
  });
});

describe('apiEpc', () => {
  it('exports the API value (4 dp) — not re-rounded to 2', () => {
    assert.strictEqual(apiEpc({ epc: 0.0123 }), '0.0123'); // toFixed(2) would have written 0.01
    assert.strictEqual(apiEpc({ epc: '1.5' }), '1.5');
    assert.strictEqual(apiEpc({}), '0');
  });
});
