/**
 * Rejected clicks (Everflow standard): a click that isn't sent to the offer is still RECORDED — as an
 * invalid click whose first fraud flag is the reason ("Cap has been exceeded", …) — so the Click report
 * shows the rejected traffic and why, on the partner when they're one of this network's. Nobody is
 * credited: no payout, never stored for attribution, and its click id never leaves the tracker (the
 * visitor goes to the fallback, never to the advertiser). See tracking/app.ts /click.
 *
 * Rejected clicks are invalid clicks (`fraud_flags` non-empty) — admin "Clicks" (net) leave them out —
 * but unlike a fraud-FLAGGED click they never reached the offer, so they don't use up its click cap:
 * Pacing / Caps leave them out of click usage (rejectedClickSql).
 */
export const CLICK_REJECTION_REASONS = [
  'offer_not_active',
  'unknown_partner', 'partner_pending', 'partner_inactive', 'partner_blocked', 'partner_not_approved',
  'ip_blacklisted', 'geo_not_allowed', 'device_not_allowed', 'targeting_not_matched',
  'traffic_control_blocked', 'traffic_blocked', 'fraud_blocked',
  'cap_exceeded', 'partner_cap_exceeded',
] as const;
export type ClickRejectionReason = (typeof CLICK_REJECTION_REASONS)[number];

/** SQL: the click was rejected (not sent to the offer). `alias` qualifies the column (e.g. `cl`). */
export function rejectedClickSql(alias?: string): string {
  const a = alias ? `${alias}.` : '';
  return `(${a}fraud_flags && ARRAY[${CLICK_REJECTION_REASONS.map((r) => `'${r}'`).join(', ')}]::text[])`;
}

/** The same predicate for ClickHouse (`fraud_flags` is Array(String) there). */
export function rejectedClickChSql(alias: string): string {
  return `hasAny(${alias}.fraud_flags, [${CLICK_REJECTION_REASONS.map((r) => `'${r}'`).join(', ')}])`;
}
