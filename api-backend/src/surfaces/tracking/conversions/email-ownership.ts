/**
 * Email Ownership (Attribution › Enable Email Ownership — Everflow's model). A conversion that carries the
 * customer's email (`email=` / `customer_email=`, or its sha256 as `email_sha256=`) makes its partner the
 * OWNER of that customer on the offer:
 *   - method 'first' — the first partner keeps the customer; 'last' — ownership moves to the latest converting
 *     partner;
 *   - optional window: ownership ends `emailOwnershipWindowDays` after it began ('static') or after the
 *     customer's latest conversion ('dynamic'); an ended ownership goes to the next converting partner.
 * A later S2S postback with the email and the offer (`offer_id`) but NO click id — a subscription rebill, a
 * repeat order — is credited to the owner: it becomes a conversion of that partner (priced at their payout on
 * the offer, else the offer's default), marked attribution 'email'. A conversion with a click id is always
 * credited to its click.
 *
 * Only the sha256 of the lower-cased, trimmed address is stored (email_owners) — never the address.
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query } from '../../../lib/db/pool.js';
import type { AttributionSettings } from '../../../lib/offer-settings/index.js';
import type { OfferConfig } from '../offer-cache.js';
import type { StoredClick } from '../click-store.js';

export const EMAIL_PARAMS = ['email', 'customer_email', 'user_email'] as const;
export const EMAIL_HASH_PARAMS = ['email_sha256', 'email_hash'] as const;
const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{1,63}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const param = (params: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const k of keys) {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  return null;
};

/** The customer's email as its sha256 (hex) — from the address, or a hash the advertiser sent — else null. */
export function emailHashOf(params: Record<string, unknown>): string | null {
  const email = param(params, EMAIL_PARAMS)?.toLowerCase() ?? null;
  if (email && EMAIL_RE.test(email)) return createHash('sha256').update(email).digest('hex');
  const hashed = param(params, EMAIL_HASH_PARAMS)?.toLowerCase() ?? null;
  return hashed && SHA256_RE.test(hashed) ? hashed : null;
}

/** SQL: the ownership row `o` has ended under the window ($n = days, $m = mode). */
const endedSql = (days: string, mode: string) =>
  `(${days}::int IS NOT NULL AND (CASE WHEN ${mode} = 'dynamic' THEN o.last_conversion_at ELSE o.owned_since END) < now() - make_interval(days => ${days}::int))`;

/**
 * The owner of this customer on the offer as the conversion's "click" — or null (no owner, ownership ended, or
 * the offer doesn't use email ownership).
 */
export async function emailOwnerClick(networkId: string, offer: OfferConfig, emailHash: string): Promise<{ clickId: string; click: StoredClick } | null> {
  const a = offer.attribution;
  if (!a?.emailOwnership) return null;
  const { rows } = await query<{ publisher_id: string }>(
    `SELECT o.publisher_id FROM email_owners o
      WHERE o.network_id = $1 AND o.offer_id = $2 AND o.email_hash = $3 AND NOT ${endedSql('$4', '$5')}`,
    [networkId, offer.id, emailHash, a.emailOwnershipWindowDays ?? null, a.emailOwnershipWindowMode ?? 'static'],
  );
  const owner = rows[0]?.publisher_id;
  if (!owner) return null;
  return {
    // Stable per customer, so the offer's duplicate rule applies per customer (send a txn_id per rebill).
    clickId: `em-${emailHash.slice(0, 29)}`,
    click: {
      offer_id: offer.id, publisher_id: owner, created_at: new Date().toISOString(),
      resolved_payout: offer.partnerPayouts?.[owner] ?? offer.defaultPayout, resolved_revenue: offer.defaultRevenue,
      currency: offer.currency, sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
    },
  };
}

/** After a conversion with an email (not rejected), in its transaction: record / refresh / move the ownership. */
export async function recordEmailOwnership(
  client: PoolClient,
  args: { networkId: string; offerId: string; emailHash: string; publisherId: string; settings: Pick<AttributionSettings, 'emailOwnershipMethod' | 'emailOwnershipWindowDays' | 'emailOwnershipWindowMode'> },
): Promise<void> {
  const takeOver = `($5::boolean OR ${endedSql('$6', '$7')})`;
  await client.query(
    `INSERT INTO email_owners AS o (network_id, offer_id, email_hash, publisher_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (network_id, offer_id, email_hash) DO UPDATE SET
       publisher_id = CASE WHEN ${takeOver} THEN EXCLUDED.publisher_id ELSE o.publisher_id END,
       owned_since = CASE WHEN ${takeOver} AND o.publisher_id <> EXCLUDED.publisher_id THEN now() ELSE o.owned_since END,
       last_conversion_at = CASE WHEN ${takeOver} OR o.publisher_id = EXCLUDED.publisher_id THEN now() ELSE o.last_conversion_at END,
       conversions = o.conversions + 1`,
    [args.networkId, args.offerId, args.emailHash, args.publisherId,
      args.settings.emailOwnershipMethod === 'last', args.settings.emailOwnershipWindowDays ?? null, args.settings.emailOwnershipWindowMode ?? 'static'],
  );
}
