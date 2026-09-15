/**
 * Per-click conversion abuse guard (T-2).
 *
 * Counts distinct txnId-bearing conversion attempts per click within a rolling window.
 * The guard is keyed by (network_id, click_id) and incremented on each new txnId
 * submission. Once the count exceeds CONV_ABUSE_LIMIT within TTL seconds, further
 * attempts are rejected.
 *
 * Null/empty txnId calls return { limited: false } — those are handled by the
 * idempotency key (which is per txnId).
 *
 * Redis failure: fail-open (returns not limited) so legitimate conversions are
 * never blocked by infra issues.
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
  txnId: string | null,
  networkId: string,
): Promise<ConversionAbuseResult> {
  if (!txnId || txnId.trim().length === 0) {
    return { limited: false, count: 0 };
  }

  try {
    const key = `convabuse:${networkId}:${clickId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      try { await redis.expire(key, CONV_ABUSE_KEY_TTL_S); } catch { /* TTL failure is non-fatal */ }
    }
    return { limited: count > CONV_ABUSE_LIMIT, count };
  } catch {
    return { limited: false, count: 0 };
  }
}
