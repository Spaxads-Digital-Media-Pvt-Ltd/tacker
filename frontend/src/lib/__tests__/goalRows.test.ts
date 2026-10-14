// Event Report row identity (lib/goalRows.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { goalRowKey, isUnmatchedGoalRow } from '../goalRows.ts';

describe('goalRowKey', () => {
  it('uses offer + goal id for a matched row', () => {
    assert.strictEqual(goalRowKey({ offer_id: 'o1', goal: 'Sale', goal_id: 'g1' }), 'o1:g1');
  });
  it('two goals of one offer with the same name stay distinct', () => {
    assert.notStrictEqual(goalRowKey({ offer_id: 'o1', goal: 'Sale', goal_id: 'g1' }), goalRowKey({ offer_id: 'o1', goal: 'Sale', goal_id: 'g2' }));
  });
  it('an unmatched row is keyed by its event label, never colliding with a goal id', () => {
    const k = goalRowKey({ offer_id: 'o1', goal: 'purchase', goal_id: null, unmatched: true });
    assert.strictEqual(k, 'o1:event:purchase');
    assert.notStrictEqual(k, goalRowKey({ offer_id: 'o1', goal: 'purchase', goal_id: 'purchase' }));
    assert.notStrictEqual(k, goalRowKey({ offer_id: 'o1', goal: '(no event)', goal_id: null, unmatched: true }));
  });
  it('the same event label on two offers stays distinct', () => {
    assert.notStrictEqual(goalRowKey({ offer_id: 'o1', goal: 'lead', goal_id: null }), goalRowKey({ offer_id: 'o2', goal: 'lead', goal_id: null }));
  });
  it('older APIs (no goal_id) still key by offer + label', () => {
    assert.strictEqual(goalRowKey({ offer_id: 'o2', goal: 'lead' }), 'o2:event:lead');
  });
});

describe('isUnmatchedGoalRow', () => {
  it('only an explicit unmatched: true counts', () => {
    assert.strictEqual(isUnmatchedGoalRow({ offer_id: 'o', goal: 'x', goal_id: null, unmatched: true }), true);
    assert.strictEqual(isUnmatchedGoalRow({ offer_id: 'o', goal: 'x', goal_id: 'g', unmatched: false }), false);
    assert.strictEqual(isUnmatchedGoalRow({ offer_id: 'o', goal: 'x' }), false);
  });
});
