/**
 * Clickless conversions by coupon code (Partners › Coupon Codes): an advertiser's postback that carries a coupon
 * (`coupon_code`, `coupon` or `promo_code`) instead of a click id is credited to the coupon's partner on its
 * offer — Everflow / Trackier "coupon code tracking" for sales nobody clicked a link for.
 *
 * The coupon must be active and within its dates. No click row is written (a coupon sale isn't a click, so
 * reports' click counts stay true): recordConversion gets a virtual click — the coupon's offer and partner, the
 * partner's payout override or the offer's default, now — and authenticates, prices, dedupes (a transaction id
 * is strongly advised), caps and pays exactly as for a click. Its click id is `coupon-<hex>`.
 */
import { randomUUID } from 'node:crypto';
import { query } from '../../../lib/db/pool.js';
import { getOfferConfig } from '../offer-cache.js';
import type { StoredClick } from '../click-store.js';

export const COUPON_PARAMS = ['coupon_code', 'coupon', 'promo_code'] as const;

export async function couponClick(networkId: string, code: string): Promise<{ clickId: string; click: StoredClick } | null> {
  const coupon = (await query<{ offer_id: string; publisher_id: string | null }>(
    `SELECT offer_id, publisher_id FROM offer_coupons
      WHERE network_id = $1 AND lower(code) = lower($2) AND status = 'active'
        AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
      ORDER BY created_at DESC LIMIT 1`, [networkId, code.trim()])).rows[0];
  if (!coupon) return null;
  const offer = await getOfferConfig(networkId, coupon.offer_id);
  if (!offer) return null;
  const pub = coupon.publisher_id;
  return {
    clickId: `coupon-${randomUUID().replace(/-/g, '')}`,
    click: {
      offer_id: coupon.offer_id, publisher_id: pub, created_at: new Date().toISOString(),
      resolved_payout: (pub ? offer.partnerPayouts?.[pub] : null) ?? offer.defaultPayout,
      resolved_revenue: offer.defaultRevenue, currency: offer.currency,
      sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
    },
  };
}
