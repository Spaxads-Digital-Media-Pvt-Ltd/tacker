/**
 * Partner ↔ offer access rules, for server paths that attribute a conversion to a partner WITHOUT a
 * tracked click (dashboard Conversion Imports + Add Conversion, via manual-conversion-policy.ts). They
 * mirror what /click enforces before a partner can ever get traffic (surfaces/tracking/app.ts steps
 * 2b/2c, fed by tracking/offer-cache.ts):
 *
 *   - an offer_publisher_access row with access='deny' (any approval_status) blocks the partner;
 *   - a non-public offer (visibility 'private' or 'ask' = "Request access") only runs for a partner
 *     with access='allow' AND approval_status='approved';
 *   - a public offer runs for every partner that isn't denied.
 *
 * The tracking surface keeps its own copy of these checks on its Redis-cached offer config (the hot
 * path must not read Postgres, and tracking code is not edited from here) — keep the two in sync.
 */
import { query } from '../db/pool.js';

/** Publisher status that may earn on an offer (publishers.status CHECK: active | pending | inactive). */
export const ACTIVE_PUBLISHER_STATUS = 'active';

export interface PublisherAccessRow {
  access: 'allow' | 'deny';
  approvalStatus: 'approved' | 'pending' | 'rejected';
}

/** Why a partner may not run an offer; null = allowed. */
export type PublisherAccessDenial = 'denied' | 'not_approved';

/**
 * Pure mirror of /click steps 2b/2c. `visibility` null/undefined is treated as 'public' — the column
 * defaults to 'public' and the tracking config loader does the same (`r.visibility ?? 'public'`).
 */
export function evaluatePublisherOfferAccess(
  visibility: string | null | undefined,
  access: PublisherAccessRow | null,
): PublisherAccessDenial | null {
  if (access?.access === 'deny') return 'denied';
  if ((visibility ?? 'public') !== 'public' && !(access?.access === 'allow' && access.approvalStatus === 'approved')) {
    return 'not_approved';
  }
  return null;
}

/** This partner's access row on this offer (unique per offer+publisher), tenant-scoped; null when none. */
export async function loadPublisherAccess(networkId: string, offerId: string, publisherId: string): Promise<PublisherAccessRow | null> {
  const { rows } = await query<{ access: PublisherAccessRow['access']; approval_status: PublisherAccessRow['approvalStatus'] }>(
    `SELECT access, approval_status FROM offer_publisher_access
      WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3 LIMIT 1`,
    [networkId, offerId, publisherId],
  );
  const r = rows[0];
  return r ? { access: r.access, approvalStatus: r.approval_status } : null;
}
