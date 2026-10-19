// Customer Value rule form / list rules (lib/customerValueRules.ts) — the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { toDateInput, formatRuleDate, ruleAmountField, formatRuleAmount, conditionError, groupingLabel, SEPARATELY_BY_LABEL, SEPARATELY_BY_HINT, deleteFailureMeansGone } from '../customerValueRules.ts';

describe('"Separately By" is labelled as not yet applied', () => {
  it('list cell, filter / form option and hint all say so', () => {
    assert.strictEqual(groupingLabel('separately_by'), 'Separately By (not yet applied)');
    assert.strictEqual(groupingLabel('all_together'), 'All Together');
    assert.match(SEPARATELY_BY_LABEL, /not yet applied/);
    assert.match(SEPARATELY_BY_HINT, /not yet applied/);
  });
});

describe('goal conditions — checked against the data point type (same rule as the API)', () => {
  it('valid text and number conditions', () => {
    assert.strictEqual(conditionError('text', 'exact_match', 'any_value', 'US'), null);
    assert.strictEqual(conditionError('number', 'greater_than', 'any_value', '100'), null);
    assert.strictEqual(conditionError('number', 'less_than_or_equal_to', 'sum_of_values', '99.5'), null);
    assert.strictEqual(conditionError('number', 'equal_to', 'any_value', '-3'), null);
  });
  it('text: only Any Value + Exact Match, with a value', () => {
    assert.match(conditionError('text', 'greater_than', 'any_value', 'US') ?? '', /Exact Match/);
    assert.match(conditionError('text', 'exact_match', 'sum_of_values', 'US') ?? '', /Any Value/);
    assert.match(conditionError('text', 'exact_match', 'any_value', '  ') ?? '', /Enter a value/);
  });
  it('number: a number operator and a numeric value', () => {
    assert.match(conditionError('number', 'exact_match', 'any_value', '100') ?? '', /number operator/);
    for (const v of ['abc', '1,000', '$5', '1e3', '']) assert.ok(conditionError('number', 'greater_than', 'any_value', v), v);
  });
  it('no data point chosen', () => {
    assert.match(conditionError(undefined, 'exact_match', 'any_value', 'x') ?? '', /data point/);
  });
});

describe('rule amounts — exact decimal text, invalid input shown (never silently dropped)', () => {
  it('valid amounts are sent as the exact text typed', () => {
    for (const v of ['0.0005', '12.3456', '200', '0', '9999999999.9999']) assert.deepStrictEqual(ruleAmountField(v), { value: v, error: null }, v);
    assert.deepStrictEqual(ruleAmountField('  1.5 '), { value: '1.5', error: null });
  });
  it('empty = not set (null), not an error', () => {
    assert.deepStrictEqual(ruleAmountField(''), { value: null, error: null });
    assert.deepStrictEqual(ruleAmountField('   '), { value: null, error: null });
  });
  it('negative, more than 4 decimals, separators, symbols, text → an error, and no value to send', () => {
    const cases: [string, RegExp][] = [
      ['-1', /negative/], ['1.23456', /4 decimal/], ['1,000', /thousands/], ['$5', /number/], ['abc', /number/], ['1e3', /number/],
    ];
    for (const [v, re] of cases) {
      const r = ruleAmountField(v);
      assert.strictEqual(r.value, null, v);
      assert.match(r.error ?? '', re, v);
    }
  });
  it('the list shows the exact stored amount, no assumed "$"', () => {
    assert.strictEqual(formatRuleAmount('12.3456'), '12.3456');
    assert.strictEqual(formatRuleAmount('0.0005'), '0.0005');
    assert.strictEqual(formatRuleAmount(null), '—');
  });
});

describe('rule dates — the calendar day, never shifted by a timezone', () => {
  it('the edit form shows the saved YYYY-MM-DD and an untouched save sends the same day back', () => {
    for (const d of ['2026-12-31', '2027-01-01', '2026-03-01']) assert.strictEqual(toDateInput(d), d);
    assert.strictEqual(toDateInput('2026-12-31T00:00:00.000Z'), '2026-12-31'); // an older API's timestamp keeps its day
  });
  it('no date / not a date → empty input', () => {
    for (const v of [null, undefined, '', 'not a date', '31/12/2026']) assert.strictEqual(toDateInput(v), '', String(v));
  });
  it('the list shows that day in the viewer\'s format', () => {
    assert.strictEqual(formatRuleDate('2026-12-31', 'en-US'), '12/31/2026');
    assert.strictEqual(formatRuleDate('2027-01-01', 'en-GB'), '01/01/2027');
    assert.strictEqual(formatRuleDate(null), '—');
    assert.strictEqual(formatRuleDate('garbage'), '—');
  });
  it('the old display shifted the day for a viewer west of UTC; this one does not (process TZ: ' + (process.env.TZ ?? 'default') + ')', () => {
    // What `new Date('2026-12-31').toLocaleDateString()` showed a viewer in Los Angeles:
    assert.strictEqual(new Date('2026-12-31').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }), '12/30/2026');
    assert.strictEqual(formatRuleDate('2026-12-31', 'en-US'), '12/31/2026');
  });
});

describe('a failed rule delete refreshes the list only when the rule is gone', () => {
  it('404 (already deleted elsewhere) → refresh', () => {
    assert.strictEqual(deleteFailureMeansGone({ name: 'ApiError', code: 'not_found', message: 'Rule not found', status: 404 }), true);
  });
  it('server error, conflict, forbidden, network failure or no error → keep the row', () => {
    for (const status of [500, 409, 403, 400]) assert.strictEqual(deleteFailureMeansGone({ code: 'x', message: 'x', status }), false);
    assert.strictEqual(deleteFailureMeansGone(new TypeError('Failed to fetch')), false);
    assert.strictEqual(deleteFailureMeansGone({ kind: 'network', message: 'Failed to fetch' }), false);
    assert.strictEqual(deleteFailureMeansGone({ status: '404' }), false);
    assert.strictEqual(deleteFailureMeansGone(null), false);
    assert.strictEqual(deleteFailureMeansGone(undefined), false);
  });
});
