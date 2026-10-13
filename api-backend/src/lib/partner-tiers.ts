/**
 * Partner Tiers (Partners › Tiers) — audit F-17b. A tier's margin prices its members on the offers
 * linked to it with "apply margin": payout = revenue × (1 − margin/100), exact decimals. It slots into
 * the payout precedence after the partner's own rates (an S2S payout param, their Offer Custom
 * Setting, their per-offer payout override) and before the goal / country / offer default payout.
 * "Auto-approve partners" approves a member's access request on a linked offer straight away.
 */
import { query } from './db/pool.js';
import { percentOfMoney, subMoney, moneySign } from './money.js';

/** The tier payout for `revenue` at `marginPct` % margin (never below zero); null when either is missing. */
export function tierPayout(revenue: string | null | undefined, marginPct: string | null | undefined): string | null {
  if (revenue == null || marginPct == null) return null;
  try {
    const keep = subMoney('100', marginPct);
    return moneySign(keep) <= 0 ? '0.0000' : percentOfMoney(revenue, keep);
  } catch {
    return null; // not a decimal — leave the payout to the next rule rather than break the click
  }
}

/** Is the partner in an active tier that auto-approves partners on this offer? */
export async function tierAutoApproves(networkId: string, offerId: string, publisherId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM partner_tier_offers tof
       JOIN partner_tiers t ON t.id = tof.tier_id AND t.network_id = tof.network_id AND t.status = 'active'
       JOIN partner_tier_members m ON m.tier_id = t.id AND m.network_id = t.network_id AND m.publisher_id = $3
      WHERE tof.network_id = $1 AND tof.offer_id = $2 AND tof.auto_approve_partners
      LIMIT 1`,
    [networkId, offerId, publisherId]);
  return rows.length > 0;
}
