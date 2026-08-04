/**
 * Atomic cap counters (spec §5 step 5). Daily click caps enforced with a single Lua script so the
 * check-and-increment is atomic (no check-then-act race). Daily keys carry a TTL that auto-resets.
 * A null cap means unlimited (skip). Conversion caps reuse the same primitive in Phase 3.
 */
import { getRedis } from '../../lib/redis.js';

// Increment only if strictly below the limit. Returns the new count, or -1 if capped.
const CAP_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur >= tonumber(ARGV[1]) then return -1 end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
return n
`;

const DAY_TTL = 2 * 24 * 60 * 60; // keep the daily bucket ~2 days then let it expire

function dayStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD (UTC)
}

/** @returns true if the click is CAPPED (should be diverted to fallback). */
export async function isClickCapped(offerId: string, dailyClickCap: number | null): Promise<boolean> {
  if (dailyClickCap == null || dailyClickCap <= 0) return false; // unlimited
  const key = `cap:click:${offerId}:${dayStamp()}`;
  const res = (await getRedis().eval(CAP_LUA, 1, key, String(dailyClickCap), String(DAY_TTL))) as number;
  return res === -1;
}
