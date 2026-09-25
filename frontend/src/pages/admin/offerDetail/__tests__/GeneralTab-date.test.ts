// Regression test: simulate the date-input onChange handler from GeneralTab.tsx (lines 130–132).
// Verifies: valid dates are accepted, empty/invalid strings are ignored (no crash).
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Reproduces the EXACT handler logic (guard order matters: isNaN check before toISOString).
function dateHandler(field: 'from' | 'to', value: string, state: { from: string; to: string }) {
  const v = value;
  if (!v) return state;                              // empty string: keep state unchanged
  const d = new Date(v);
  if (isNaN(d.getTime())) return state;              // malformed: keep state unchanged
  return { ...state, [field]: d.toISOString() };      // valid: update field
}

describe('GeneralTab date onChange guard', () => {
  const base = { from: '2026-09-24T00:00:00.000Z', to: '2026-09-24T00:00:00.000Z' };

  it('accepts a valid date string', () => {
    const result = dateHandler('from', '2026-08-01', base);
    assert.ok(result.from.includes('2026-08-01'));
    assert.ok(!isNaN(new Date(result.from).getTime()));
  });

  it('ignores an empty string without throwing', () => {
    const result = dateHandler('from', '', base);
    assert.deepStrictEqual(result, base);
  });

  it('ignores a malformed date string without throwing', () => {
    const result = dateHandler('to', 'not-a-date', base);
    assert.deepStrictEqual(result, base);
  });

  it('does not throw for whitespace-only input', () => {
    assert.doesNotThrow(() => dateHandler('from', '   ', base));
  });

  it('does not throw for null-ish strings', () => {
    assert.doesNotThrow(() => dateHandler('from', 'null', base));
    assert.doesNotThrow(() => dateHandler('from', 'undefined', base));
  });

  it('only updates the targeted field, preserves the other', () => {
    const result = dateHandler('to', '2026-08-31', base);
    assert.ok(result.to.includes('2026-08-31'));
    assert.strictEqual(result.from, base.from);
  });
});
