/**
 * Atomic cap counters (spec §5 step 5). Daily click caps enforced with a single Lua script so the
 * check-and-increment is atomic (no check-then-act race). Daily keys carry a TTL that auto-resets.
 * A null cap means unlimited (skip). A "day" is the cap time zone's local day (the offer's Cap time
 * zone, else the network's, else UTC — capTimeZoneOf); the key is stamped with that local date.
 */
import { getRedis } from '../../lib/redis.js';
import { capBucket, capLimits, type CustomSettingConfig } from '../../lib/offer-settings/custom-settings.js';
import { localDate } from '../../lib/reporting/time-zone.js';

// Increment only if strictly below the limit. Returns the new count, or -1 if capped.
const CAP_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur >= tonumber(ARGV[1]) then return -1 end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
return n
`;

const DAY_TTL = 2 * 24 * 60 * 60; // keep the daily bucket ~2 days then let it expire

/** YYYYMMDD of the local day in the cap time zone. */
export function dayStamp(d = new Date(), tz = 'UTC'): string {
  return localDate(d, tz).replace(/-/g, '');
}

/** @returns true if the click is CAPPED (should be rejected — "Cap has been exceeded"). */
export async function isClickCapped(offerId: string, dailyClickCap: number | null, tz = 'UTC'): Promise<boolean> {
  if (dailyClickCap == null || dailyClickCap <= 0) return false; // unlimited
  const key = `cap:click:${offerId}:${dayStamp(new Date(), tz)}`;
  const res = (await getRedis().eval(CAP_LUA, 1, key, String(dailyClickCap), String(DAY_TTL))) as number;
  return res === -1;
}

/** Read-only: is today's click cap already full? (/sl skips such offers instead of dead-ending — F-17b.) */
export async function clickCapReached(offerId: string, dailyClickCap: number | null, tz = 'UTC'): Promise<boolean> {
  if (dailyClickCap == null || dailyClickCap <= 0) return false;
  const n = Number((await getRedis().get(`cap:click:${offerId}:${dayStamp(new Date(), tz)}`)) ?? 0);
  return n >= dailyClickCap;
}

// Check every key against its limit first; only when ALL are below, increment them all (so a click
// capped by one window isn't counted against the others). ARGV = limits…, then TTLs… (0 = no TTL).
const MULTI_CAP_LUA = `
for i = 1, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then return -1 end
end
for i = 1, #KEYS do
  local n = redis.call('INCR', KEYS[i])
  local ttl = tonumber(ARGV[#KEYS + i])
  if n == 1 and ttl > 0 then redis.call('EXPIRE', KEYS[i], ttl) end
end
return 1
`;

/**
 * Per-partner click caps from Offer Custom Settings › Caps (F-12) — daily / weekly / monthly / global
 * windows, counted per setting + partner. `settings` are the caps settings that apply to this click.
 * @returns true if any window is full (divert the click).
 */
export async function isCustomClickCapped(settings: CustomSettingConfig[], publisherId: string, tz = 'UTC'): Promise<boolean> {
  const keys: string[] = [];
  const limits: string[] = [];
  const ttls: string[] = [];
  for (const s of settings) {
    for (const [interval, limit] of capLimits(s.caps, 'clicks')) {
      const { bucket, ttl } = capBucket(interval, new Date(), tz);
      keys.push(`cap:cs:${s.id}:${publisherId}:${bucket}`);
      limits.push(String(limit));
      ttls.push(String(ttl));
    }
  }
  if (!keys.length) return false;
  return (await getRedis().eval(MULTI_CAP_LUA, keys.length, ...keys, ...limits, ...ttls)) === -1;
}
