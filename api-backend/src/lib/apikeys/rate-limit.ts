/**
 * Per-key rate limiting (spec §8A) — in addition to Cloudflare/global limits. Fixed one-minute
 * window in Redis, keyed by the API key id, with a per-tier ceiling.
 */
import { getRedis } from '../redis.js';

const TIER_LIMITS: Record<string, number> = {
  default: 600, // requests/minute
  high: 6000,
  unlimited: Number.MAX_SAFE_INTEGER,
};

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
}

export async function checkRateLimit(keyId: string, tier: string): Promise<RateResult> {
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS['default']!;
  const minute = Math.floor(Date.now() / 60_000);
  const key = `apirl:${keyId}:${minute}`;
  const n = await getRedis().incr(key);
  if (n === 1) await getRedis().expire(key, 60);
  return { allowed: n <= limit, limit, remaining: Math.max(0, limit - n) };
}
