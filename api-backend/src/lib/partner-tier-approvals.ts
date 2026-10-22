/**
 * Partner Tiers › "auto-approve partners" for requests made BEFORE the tier applied (lib/partner-tiers.ts
 * handles a request at the moment it is made). Its own module so the tracking surface, which imports
 * partner-tiers for tierPayout, doesn't pull in the mailer.
 */
import { query } from './db/pool.js';
import { invalidateOfferConfig } from '../surfaces/tracking/offer-cache.js';
import { notifyOfferApplication } from './email/notifications.js';

/**
 * Approve the access requests still pending that a tier now auto-approves: a member of an ACTIVE tier
 * linked to the offer with "auto-approve partners". A request is auto-approved when it is made
 * (tierAutoApproves); this covers what changes afterwards — a partner added to the tier, the tier
 * linked to the offer or (re)activated. Only `pending` requests: one an admin rejected stays rejected.
 * Each approval refreshes the offer's cached click config and tells the partner (like an admin approval).
 * Returns what was approved, for the caller's audit log.
 */
export async function approvePendingTierRequests(networkId: string, tierId: string): Promise<{ id: string; offerId: string; publisherId: string }[]> {
  const { rows } = await query<{ id: string; offer_id: string; publisher_id: string }>(
    `UPDATE offer_publisher_access opa
        SET access = 'allow', approval_status = 'approved'
       FROM partner_tier_offers tof
       JOIN partner_tiers t ON t.id = tof.tier_id AND t.network_id = tof.network_id AND t.status = 'active'
       JOIN partner_tier_members m ON m.tier_id = t.id AND m.network_id = t.network_id
      WHERE t.network_id = $1 AND t.id = $2 AND tof.auto_approve_partners
        AND opa.network_id = t.network_id AND opa.offer_id = tof.offer_id AND opa.publisher_id = m.publisher_id
        AND opa.approval_status = 'pending'
      RETURNING opa.id, opa.offer_id, opa.publisher_id`,
    [networkId, tierId]);
  for (const offerId of new Set(rows.map((r) => r.offer_id))) await invalidateOfferConfig(networkId, offerId);
  for (const r of rows) void notifyOfferApplication(networkId, r.publisher_id, r.offer_id, true);
  return rows.map((r) => ({ id: r.id, offerId: r.offer_id, publisherId: r.publisher_id }));
}
