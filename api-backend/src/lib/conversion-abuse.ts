/**
 * Per-click conversion volume guard (T-2).
 *
 * Counts the new conversions one click sends (every authenticated, non-duplicate attempt — with or
 * without a transaction id) in a window that starts with the first. Past the offer's limit
 * (Edit Offer › Revenue: "Hold for review after N conversions from one click in 10 minutes",
 * default CONV_ABUSE_LIMIT), the caller HOLDS the next ones as pending for review ("Unusual
 * volume") — they are recorded, never dropped: a lead-gen or rev-share offer can legitimately send
 * many conversions per click, and a dropped one is lost money.
 *
 * A limit of null / 0 turns the guard off (nothing is counted). Redis failure: fail open (not held)
 * so legitimate conversions are never blocked by infra issues.
 */

export const CONV_ABUSE_LIMIT = 10;
export const CONV_ABUSE_KEY_TTL_S = 600;

export interface ConversionAbuseResult {
  limited: boolean;
  count: number;
}

export interface ConversionAbuseRedis {
  incr(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<number | boolean>;
}

export async function checkConversionAbuse(
  redis: ConversionAbuseRedis,
  clickId: string,
  networkId: string,
  limit: number | null = CONV_ABUSE_LIMIT,
): Promise<ConversionAbuseResult> {
  if (limit == null || limit <= 0) return { limited: false, count: 0 };

  try {
    const key = `convabuse:${networkId}:${clickId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      try { await redis.expire(key, CONV_ABUSE_KEY_TTL_S); } catch { /* TTL failure is non-fatal */ }
    }
    return { limited: count > limit, count };
  } catch {
    return { limited: false, count: 0 };
  }
}
