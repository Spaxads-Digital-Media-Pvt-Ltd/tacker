import { describe, it } from 'vitest';
import assert from 'node:assert';
import { buildConditions, parseConditionsText, parseEvents, buildEvents, DEFAULT_RULE } from '../automationRules.ts';

describe('alert rule conditions builder', () => {
  it('builds the grammar the API parses', () => {
    assert.equal(buildConditions({ clauses: [{ metric: 'cr', op: '>', value: '5' }, { metric: 'clicks', op: '>=', value: '100' }], scope: 'offer', window: { amount: 24, unit: 'h' } }),
      'cr > 5 AND clicks >= 100 per offer in 24h');
    assert.equal(buildConditions({ clauses: [{ metric: 'payout', op: '<', value: ' 10.5 ' }, { metric: 'epc', op: '>', value: '' }], scope: null, window: { amount: 30, unit: 'm' } }),
      'payout < 10.5 in 30m');
  });

  it('reads a saved rule back (round trip); the API alias "publisher" is shown as partner', () => {
    const m = parseConditionsText('cr > 5 AND clicks >= 100 per offer in 24h');
    assert.deepEqual(m, { clauses: [{ metric: 'cr', op: '>', value: '5' }, { metric: 'clicks', op: '>=', value: '100' }], scope: 'offer', window: { amount: 24, unit: 'h' } });
    assert.equal(buildConditions(m!), 'cr > 5 AND clicks >= 100 per offer in 24h');
    assert.equal(parseConditionsText('conversions = 0 per publisher in 2d')?.scope, 'partner');
    assert.deepEqual(parseConditionsText('clicks > 10')?.window, { amount: 24, unit: 'h' });
  });

  it('text it cannot show as a builder → null (kept as text)', () => {
    assert.equal(parseConditionsText('cr > 5 && clicks > 1'), null);
    assert.equal(parseConditionsText('conversion rate > 5%'), null);
    assert.equal(parseConditionsText(''), null);
    assert.ok(DEFAULT_RULE.clauses.length === 1);
  });

  it('webhook events ⇄ checkboxes', () => {
    assert.deepEqual(parseEvents('conversion.created, alert.raised'), ['conversion.created', 'alert.raised']);
    assert.equal(buildEvents(['conversion.created', 'alert.raised']), 'conversion.created,alert.raised');
    assert.equal(buildEvents(['*', 'alert.raised']), '*');
  });
});
