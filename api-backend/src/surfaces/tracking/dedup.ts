/**
 * Unique/dedup check (spec §5 step 6). SETNX on an ip+offer key with a TTL = the offer's dedup
 * window → the first click in the window is unique, repeats within it are not. The IP is hashed so
 * raw IPs never sit in Redis keys (privacy, spec §3A).
 */
import { createHash } from 'node:crypto';
import { getRedis } from '../../lib/redis.js';

function ipHash(ip: string): string {
  return createHash('sha1').update(ip).digest('hex').slice(0, 16);
}

export async function markUnique(offerId: string, ip: string, dedupWindowS: number): Promise<boolean> {
  if (dedupWindowS <= 0) return true;
  const key = `dedup:${offerId}:${ipHash(ip)}`;
  // SET key 1 NX EX window → 'OK' if newly set (unique), null if it already existed.
  const res = await getRedis().set(key, '1', 'EX', dedupWindowS, 'NX');
  return res === 'OK';
}
