/**
 * One policy for conversions an admin records WITHOUT a tracked click — dashboard Conversion Imports
 * (`create` rows, surfaces/dashboard/conversion-imports) and manual Add Conversion
 * (POST /api/offline/conversions). Both callers load the offer with `loadManualConversionOffer` and
 * ask `evaluateManualConversion` whether the conversion may be written and with which status; the
 * callers only differ in how a refusal surfaces (a per-row import error vs a 400/422 response).
 *
 *   - Tenant: the offer is this network's, and the offer's advertiser is in the same network (a
 *     supplied advertiser must be this network's AND the offer's advertiser).
 *   - Partner (optional): this network's, `active`, and allowed on the offer by the rules /click
 *     enforces (publisher-access.ts — explicit deny blocks; private/'ask' offers need allow+approved).
 *     No partner = an administrative record with no partner earning; the route's role guard
 *     (admin/manager) is what authorises it.
 *   - Approval: "Manually Approve Conversions" (metadata.revenue_settings.manualApproval) can't be
 *     bypassed — no status or an explicit 'approved' becomes 'pending' with reason
 *     'manual_approval_required' (same reason as a tracked conversion, tracking/conversions/record.ts);
 *     an explicit 'pending' / 'rejected' is kept as given.
 *   - Not checked, on purpose: the offer's status (historical conversions on draft/paused/archived
 *     offers are allowed) and caps (never enforced here; the rows still count toward them).
 */
import { query } from '../db/pool.js';
import { readRevenue } from '../offer-settings/index.js';
import { ACTIVE_PUBLISHER_STATUS, evaluatePublisherOfferAccess, loadPublisherAccess } from './publisher-access.js';

export const MANUAL_CONVERSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ManualConversionStatus = (typeof MANUAL_CONVERSION_STATUSES)[number];
/** conversions.reason for a conversion held back by the offer's manual-approval setting. */
export const MANUAL_APPROVAL_REASON = 'manual_approval_required';

export interface ManualConversionOffer {
  id: string;
  advertiserId: string;
  /** The offer's currency, the network default when blank. */
  currency: string;
  visibility: string | null;
  /** Offer setting "Manually Approve Conversions". */
  manualApproval: boolean;
  /** offers.advertiser_id is an advertiser of the SAME network (the FK alone doesn't guarantee it). */
  advertiserInNetwork: boolean;
}

/** This network's offer by numeric ref or uuid; null when it isn't one. */
export async function loadManualConversionOffer(networkId: string, offerRef: string): Promise<ManualConversionOffer | null> {
  const r = (await query<{
    id: string; advertiser_id: string; currency: string; visibility: string | null;
    metadata: Record<string, unknown> | null; advertiser_in_network: boolean;
  }>(
    `SELECT o.id, o.advertiser_id, COALESCE(NULLIF(o.currency, ''), n.default_currency) AS currency, o.visibility, o.metadata,
            (a.id IS NOT NULL) AS advertiser_in_network
       FROM offers o JOIN networks n ON n.id = o.network_id
       LEFT JOIN advertisers a ON a.id = o.advertiser_id AND a.network_id = o.network_id
      WHERE o.network_id = $1 AND (o.ref::text = $2 OR o.id::text = $2)`,
    [networkId, offerRef],
  )).rows[0];
  if (!r) return null;
  return {
    id: r.id, advertiserId: r.advertiser_id, currency: r.currency, visibility: r.visibility,
    manualApproval: readRevenue(r.metadata).manualApproval, advertiserInNetwork: r.advertiser_in_network === true,
  };
}

/**
 * Pure approval rule. `requested` undefined = no status given (imports: no/blank status cell).
 * Only an approval is held back; 'pending' / 'rejected' are never upgraded or changed.
 */
export function resolveManualConversionStatus(
  requested: ManualConversionStatus | undefined,
  manualApproval: boolean,
): { status: ManualConversionStatus; reason: string | null } {
  const want = requested ?? 'approved';
  if (want === 'approved' && manualApproval) return { status: 'pending', reason: MANUAL_APPROVAL_REASON };
  return { status: want, reason: null };
}

export type ManualConversionDenial =
  | 'advertiser_not_in_network' | 'advertiser_not_found' | 'advertiser_mismatch'
  | 'partner_not_found' | 'partner_inactive' | 'partner_denied' | 'partner_not_approved';

export type ManualConversionDecision =
  | { ok: true; publisherId: string | null; status: ManualConversionStatus; reason: string | null }
  | { ok: false; error: { code: ManualConversionDenial; message: string } };

export interface ManualConversionInput {
  networkId: string;
  offer: ManualConversionOffer;
  /** How the caller named the offer (ref or uuid) — used in messages. */
  offerLabel: string;
  /** Partner ref or uuid; null/undefined/blank = no partner. */
  publisherRef?: string | null;
  /** Advertiser ref or uuid, when the caller supplied one; it must be the offer's advertiser. */
  advertiserRef?: string | null;
  requestedStatus?: ManualConversionStatus;
}

const deny = (code: ManualConversionDenial, message: string): ManualConversionDecision => ({ ok: false, error: { code, message } });

export async function evaluateManualConversion(input: ManualConversionInput): Promise<ManualConversionDecision> {
  const { networkId, offer, offerLabel } = input;
  if (!offer.advertiserInNetwork) return deny('advertiser_not_in_network', `offer "${offerLabel}" has no advertiser in this network`);

  const advRef = input.advertiserRef?.trim();
  if (advRef) {
    const adv = (await query<{ id: string }>(
      `SELECT id FROM advertisers WHERE network_id = $1 AND (ref::text = $2 OR id::text = $2)`,
      [networkId, advRef],
    )).rows[0];
    if (!adv) return deny('advertiser_not_found', `advertiser "${advRef}" not found`);
    if (adv.id !== offer.advertiserId) return deny('advertiser_mismatch', `advertiser "${advRef}" is not the advertiser of offer "${offerLabel}"`);
  }

  let publisherId: string | null = null;
  const pubRef = input.publisherRef?.trim();
  if (pubRef) {
    const pub = (await query<{ id: string; status: string }>(
      `SELECT id, status FROM publishers WHERE network_id = $1 AND (ref::text = $2 OR id::text = $2)`,
      [networkId, pubRef],
    )).rows[0];
    if (!pub) return deny('partner_not_found', `partner "${pubRef}" not found`);
    if (pub.status !== ACTIVE_PUBLISHER_STATUS) return deny('partner_inactive', `partner "${pubRef}" is not active (status: ${pub.status})`);
    const denial = evaluatePublisherOfferAccess(offer.visibility, await loadPublisherAccess(networkId, offer.id, pub.id));
    if (denial === 'denied') return deny('partner_denied', `partner "${pubRef}" is blocked on offer "${offerLabel}"`);
    if (denial === 'not_approved') {
      const kind = offer.visibility === 'ask' ? 'request-access' : 'private';
      return deny('partner_not_approved', `partner "${pubRef}" is not approved on ${kind} offer "${offerLabel}"`);
    }
    publisherId = pub.id;
  }

  return { ok: true, publisherId, ...resolveManualConversionStatus(input.requestedStatus, offer.manualApproval) };
}
