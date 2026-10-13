/**
 * Click-URL parameter normalization (tracking/click-params.ts) used by /click, /sl and the
 * click-persist worker: blank / whitespace-only → null, a blank alias falls through, populated
 * values are kept exactly as sent and the existing precedence (source_id → source → src) holds.
 */
import { describe, it, expect } from 'vitest';
import { SOURCE_PARAMS, blankToNull, firstNonBlank, isSpeculativeLoad } from '../../src/surfaces/tracking/click-params.js';

describe('isSpeculativeLoad — a browser prefetch / prerender is not a click', () => {
  it("Chrome's address-bar / Speculation Rules loads (Sec-Purpose), any case, any token order", () => {
    for (const v of ['prefetch', 'prefetch;prerender', 'Prefetch; Prerender', 'prefetch;anonymous-client-ip']) {
      expect(isSpeculativeLoad({ 'sec-purpose': v }), v).toBe(true);
    }
  });
  it('older forms: Purpose: prefetch, X-Purpose: preview (Safari), X-Moz: prefetch (Firefox)', () => {
    expect(isSpeculativeLoad({ purpose: 'prefetch' })).toBe(true);
    expect(isSpeculativeLoad({ 'x-purpose': 'preview' })).toBe(true);
    expect(isSpeculativeLoad({ 'x-moz': 'prefetch' })).toBe(true);
    expect(isSpeculativeLoad({ 'sec-purpose': ['prefetch'] })).toBe(true);
  });
  it('an ordinary navigation is a click', () => {
    expect(isSpeculativeLoad({})).toBe(false);
    expect(isSpeculativeLoad({ 'user-agent': 'Mozilla/5.0', accept: 'text/html' })).toBe(false);
    expect(isSpeculativeLoad({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).toBe(false);
  });
  it('unrelated values do not count as speculative', () => {
    expect(isSpeculativeLoad({ 'sec-purpose': 'prefetchx' })).toBe(false);
    expect(isSpeculativeLoad({ purpose: 'preview' })).toBe(false);
    expect(isSpeculativeLoad({ 'x-purpose': 'prefetch-something' })).toBe(false);
  });
});

describe('blankToNull', () => {
  it('missing / blank / whitespace-only → null', () => {
    for (const v of [undefined, null, '', ' ', '   ', '\t', '\n', ' \t\r\n ']) expect(blankToNull(v), JSON.stringify(v)).toBeNull();
  });
  it('populated values are returned unchanged (not trimmed, not lower-cased)', () => {
    for (const v of ['push-1', 'IwAR-x', 'Cj0K', ' padded ', '0']) expect(blankToNull(v)).toBe(v);
  });
});

describe('firstNonBlank', () => {
  it('missing parameter → null', () => {
    expect(firstNonBlank({}, SOURCE_PARAMS)).toBeNull();
    expect(firstNonBlank({ sub1: 'x' }, ['gclid'])).toBeNull();
  });
  it('blank / whitespace-only parameter → null (never "")', () => {
    for (const v of ['', '  ', '\t']) {
      expect(firstNonBlank({ gclid: v }, ['gclid'])).toBeNull();
      expect(firstNonBlank({ source_id: v, source: v, src: v }, SOURCE_PARAMS)).toBeNull();
    }
  });
  it('populated → the value as sent', () => {
    expect(firstNonBlank({ fbclid: 'IwAR-1' }, ['fbclid'])).toBe('IwAR-1');
    expect(firstNonBlank({ src: 'native-9' }, SOURCE_PARAMS)).toBe('native-9');
  });
  it('a blank source_id does not hide a populated source (or src)', () => {
    expect(firstNonBlank({ source_id: '', source: 'push' }, SOURCE_PARAMS)).toBe('push');
    expect(firstNonBlank({ source_id: '  ', source: '', src: 'native' }, SOURCE_PARAMS)).toBe('native');
  });
  it('existing precedence when several are populated: source_id → source → src', () => {
    expect(firstNonBlank({ source_id: 'a', source: 'b', src: 'c' }, SOURCE_PARAMS)).toBe('a');
    expect(firstNonBlank({ source: 'b', src: 'c' }, SOURCE_PARAMS)).toBe('b');
  });
  it('repeated parameter: its first entry counts (same as every other click param)', () => {
    expect(firstNonBlank({ gclid: ['g1', 'g2'] }, ['gclid'])).toBe('g1');
    expect(firstNonBlank({ source_id: ['', 'x'], source: 'push' }, SOURCE_PARAMS)).toBe('push');
    expect(firstNonBlank({ gclid: [42] }, ['gclid'])).toBeNull();
  });
});
