/**
 * Short-lived click record in Redis for FAST, race-free attribution (spec §6). Written on the
 * click hot path so a conversion can be attributed even before the click is persisted to Postgres
 * (async) — and without a DB read on the conversion path. Older conversions (past this TTL) fall
 * back to the durable `clicks` table.
 *
 * TTL is min(offer attribution window, cap) to bound Redis memory at scale.
 */
import { getRedis } from '../../lib/redis.js';

export interface StoredClick {
  offer_id: string;
  publisher_id: string | null;
  created_at: string;
  resolved_payout: string | null;
  resolved_revenue: string | null;
  currency: string | null;
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
}

const MAX_TTL = 7 * 24 * 60 * 60; // cap: 7 days in Redis; DB covers longer windows
const key = (networkId: string, clickId: string) => `click:${networkId}:${clickId}`;

export async function storeClickForAttribution(
  networkId: string,
  clickId: string,
  rec: StoredClick,
  attributionWindowS: number,
): Promise<void> {
  const ttl = Math.max(60, Math.min(attributionWindowS, MAX_TTL));
  await getRedis().set(key(networkId, clickId), JSON.stringify(rec), 'EX', ttl);
}

export async function getStoredClick(networkId: string, clickId: string): Promise<StoredClick | null> {
  const raw = await getRedis().get(key(networkId, clickId));
  return raw ? (JSON.parse(raw) as StoredClick) : null;
}
