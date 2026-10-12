// Honest Browser / OS display (lib/userAgentDisplay.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { displayBrowser, displayOs, uaDimensionLabel } from '../userAgentDisplay.ts';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0';
const ANDROID_REDUCED = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';

describe('displayBrowser', () => {
  it('reduced UA keeps only the major version the request carried', () => {
    assert.deepStrictEqual(displayBrowser('Chrome 155.0.0.0').text, 'Chrome 155');
    assert.deepStrictEqual(displayBrowser('Edge 155.0.0.0').text, 'Edge 155');
    assert.match(displayBrowser('Chrome 155.0.0.0').note!, /major version/);
  });
  it('real (unreduced) versions are shown as sent — Firefox, Safari, full Chrome', () => {
    assert.deepStrictEqual(displayBrowser('Firefox 133.0'), { text: 'Firefox 133.0' });
    assert.deepStrictEqual(displayBrowser('Safari 18.2'), { text: 'Safari 18.2' });
    assert.deepStrictEqual(displayBrowser('Chrome 120.0.6099.109'), { text: 'Chrome 120.0.6099.109' });
  });
  it('missing values stay missing (never a default browser)', () => {
    for (const v of [null, undefined, '', '   ']) assert.deepStrictEqual(displayBrowser(v), { text: null });
  });
});

describe('displayOs', () => {
  it('"Windows NT 10.0" → Windows 10/11 (indistinguishable)', () => {
    assert.strictEqual(displayOs('Windows 10', CHROME_WIN).text, 'Windows 10/11');
    assert.strictEqual(displayOs('Windows 10', null).text, 'Windows 10/11');
  });
  it('older Windows versions and a versionless "Windows" are real and stay (no collision)', () => {
    assert.strictEqual(displayOs('Windows 7', 'Mozilla/5.0 (Windows NT 6.1)').text, 'Windows 7');
    assert.deepStrictEqual(displayOs('Windows', null), { text: 'Windows' });
  });
  it('frozen macOS (Chrome/Safari 10_15_7, Firefox 10.15) → Mac OS 10.15+; an older macOS stays', () => {
    assert.strictEqual(displayOs('Mac OS 10.15.7', SAFARI_MAC).text, 'Mac OS 10.15+');
    assert.strictEqual(displayOs('Mac OS 10.15', FIREFOX_MAC).text, 'Mac OS 10.15+');
    assert.strictEqual(displayOs('Mac OS 10.14.6', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6)').text, 'Mac OS 10.14.6');
    assert.deepStrictEqual(displayOs('Mac OS', null), { text: 'Mac OS' });
  });
  it('reduced Android "10; K" → Android 10+; a real Android 10 (or no UA to prove it) stays', () => {
    assert.strictEqual(displayOs('Android 10', ANDROID_REDUCED).text, 'Android 10+');
    assert.strictEqual(displayOs('Android 10', 'Mozilla/5.0 (Linux; Android 10; SM-G973F)').text, 'Android 10');
    assert.strictEqual(displayOs('Android 10', null).text, 'Android 10');
  });
  it('iOS / Linux / unknown are shown as stored; missing stays missing', () => {
    assert.strictEqual(displayOs('iOS 18.2', null).text, 'iOS 18.2');
    assert.strictEqual(displayOs('Linux', null).text, 'Linux');
    for (const v of [null, undefined, '']) assert.deepStrictEqual(displayOs(v, CHROME_WIN), { text: null });
  });
});

describe('uaDimensionLabel (Analytics / aggregated rows — no User-Agent available)', () => {
  it('reduced Chrome, Windows, macOS are shown with honest precision', () => {
    assert.strictEqual(uaDimensionLabel('browser', 'Chrome 155.0.0.0'), 'Chrome 155');
    assert.strictEqual(uaDimensionLabel('os', 'Windows 10'), 'Windows 10/11');
    assert.strictEqual(uaDimensionLabel('os', 'Mac OS 10.15.7'), 'Mac OS 10.15+');
  });
  it('labels never merge with a versionless stored value (separate rows stay distinguishable)', () => {
    assert.notStrictEqual(uaDimensionLabel('os', 'Windows 10'), uaDimensionLabel('os', 'Windows'));
    assert.notStrictEqual(uaDimensionLabel('os', 'Mac OS 10.15.7'), uaDimensionLabel('os', 'Mac OS'));
    assert.notStrictEqual(uaDimensionLabel('browser', 'Chrome 155.0.0.0'), uaDimensionLabel('browser', 'Chrome'));
  });
  it('Firefox / real versions and Android (no UA to prove reduction) stay as stored', () => {
    assert.strictEqual(uaDimensionLabel('browser', 'Firefox 133.0'), 'Firefox 133.0');
    assert.strictEqual(uaDimensionLabel('os', 'Android 10'), 'Android 10');
    assert.strictEqual(uaDimensionLabel('os', 'iOS 18.2'), 'iOS 18.2');
  });
  it('missing values and other dimensions are untouched (raw stays the key / filter value)', () => {
    assert.strictEqual(uaDimensionLabel('os', ''), '');
    assert.strictEqual(uaDimensionLabel('browser', '   '), '   ');
    assert.strictEqual(uaDimensionLabel('device', 'Windows 10'), 'Windows 10');
    assert.strictEqual(uaDimensionLabel('sub1', 'Chrome 155.0.0.0'), 'Chrome 155.0.0.0');
  });
});
