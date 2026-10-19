/**
 * Over caps (Everflow model): a conversion past a cap — the offer's or an event's daily / total
 * conversion cap, a partner's Custom Settings caps — is HELD as pending with the cap as its reason, for
 * an admin to approve or reject. It is recorded, never dropped (it used to be rejected).
 *
 * What USES UP a cap: every conversion that isn't rejected, except the ones held because the cap was
 * already full — counting those would show usage past the cap, and keep counting them after the cap
 * is raised. Once approved, a held conversion counts like any other. Enforcement
 * (tracking/conversions/record.ts) and the Pacing / Caps reports share this one definition.
 */
import { billingRowSql } from './offer-settings/billing.js';

export const OVER_CAP_REASONS = [
  'daily_conversion_cap_reached', 'total_conversion_cap_reached',
  'goal_daily_conversion_cap_reached', 'goal_total_conversion_cap_reached',
  'custom_conversion_cap_reached', 'custom_payout_cap_reached', 'custom_revenue_cap_reached',
] as const;
export type OverCapReason = (typeof OVER_CAP_REASONS)[number];

const OVER_CAP_ARRAY = `ARRAY[${OVER_CAP_REASONS.map((r) => `'${r}'`).join(', ')}]::text[]`;

/** SQL: the conversion is held because a cap was full (pending, with a cap reason). */
export function heldOverCapSql(alias?: string): string {
  const a = alias ? `${alias}.` : '';
  return `(${a}status = 'pending' AND COALESCE(${a}reason, '') = ANY(${OVER_CAP_ARRAY}))`;
}

/** SQL: the conversion uses up a cap. `alias` qualifies the columns (e.g. `c` → `c.status`). Billing rows (CPC
 * paid clicks / CPM bookings — lib/offer-settings/billing.ts) are money, not conversions: they never use up one. */
export function capCountedSql(alias?: string): string {
  const a = alias ? `${alias}.` : '';
  return `(${a}status <> 'rejected' AND NOT ${heldOverCapSql(alias)} AND NOT ${billingRowSql(alias)})`;
}
