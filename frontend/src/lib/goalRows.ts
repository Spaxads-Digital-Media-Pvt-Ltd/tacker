/**
 * Event Report rows (`/api/reports/goals`): one per (offer, goal_id). Conversions recorded without a
 * goal (imports / manual entry with no matching goal) come as their own rows with `goal_id: null`
 * and `unmatched: true`, labelled by their event name ('(no event)' when they have none) — so two
 * rows of one offer can share a label and the label alone is not a key. Pure — tested in
 * lib/__tests__/goalRows.test.ts.
 */
export interface GoalRowIdentity { offer_id: string; goal: string; goal_id?: string | null; unmatched?: boolean }

/** Stable React key: offer + goal id, or offer + 'event:' + label for a row without a goal. */
export function goalRowKey(r: GoalRowIdentity): string {
  return `${r.offer_id}:${r.goal_id ?? `event:${r.goal}`}`;
}

/** True for a row whose conversions matched no goal (older APIs omit the flag → false). */
export const isUnmatchedGoalRow = (r: GoalRowIdentity): boolean => r.unmatched === true;

export const UNMATCHED_GOAL_TITLE = 'Conversion has no goal — recorded by import or manual entry without a matching goal';
