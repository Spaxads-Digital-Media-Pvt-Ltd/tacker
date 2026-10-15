/**
 * Tracking surface rate limiter (AP-1 finding / Task 9.3.3).
 *
 * Protects the public tracking endpoints from abuse using a Redis-backed sliding
 * window counter, scoped by IP (or click id) + endpoint.
 *
 * Sliding window: 5 x 1-minute buckets. A request is counted ONCE, in the current minute's bucket;
 * the window total is that bucket plus the 4 before it. A bucket lives 5 minutes (EXPIRE in
 * seconds) after its last count — long enough to be read for the rest of the window, no longer.
 * (O3: it used to INCR all 5 buckets, counting every request 3–5 times, and EXPIRE took
 * milliseconds as seconds, so keys lived ~3.5 days.)
 *
 * Key structure: tr:<scope>:<sha256(id)>:<bucket_idx>
 * - tr: prefix separates tracking RL keys from login (lr:*) keys
 * - scope: endpoint dimension (click, postback, pixel, iframe, sl, postback_click, signup)
 * - sha256(id): prevents raw IP / click id exposure and special-char injection
 * - bucket_idx: floor(now_ms / 60000)
 *
 * Thresholds (env-configurable, production-safe defaults):
 * - TRACKING_RL_CLICK_LIMIT → 120 requests/IP per 5-min window
 * - TRACKING_RL_POSTBACK_LIMIT → 60 FAILED postbacks/IP per 5-min window (O3: an authenticated
 *   postback is never throttled — see peekTrackingRateLimit / chargeTrackingRateLimit)
 *
 * Redis failure: FAIL OPEN. A Redis outage must not block legitimate affiliate
 * traffic. The limiter returns { limited: false } and logs a warning. Security
 * tradeoff is documented here and in the final report.
 */

import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getRedis } from './redis.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BUCKET_MS = 60_000; // 1 minute
const BUCKET_COUNT = 5; // 5-minute window
/** How long a bucket lives after its last count, in SECONDS (EXPIRE's unit). */
const BUCKET_TTL_S = (BUCKET_MS * BUCKET_COUNT) / 1000;

export const CLICK_LIMIT = env.TRACKING_RL_CLICK_LIMIT;
export const POSTBACK_LIMIT = env.TRACKING_RL_POSTBACK_LIMIT;
/** Failed postbacks per click_id — pass the click_id as the identifier with endpoint 'postback_click'. */
export const POSTBACK_PER_CLICK_LIMIT = env.TRACKING_RL_POSTBACK_PER_CLICK_LIMIT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 'signup' = the dashboard's unauthenticated partner sign-up (F-04), which reuses this limiter. */
export type TrackingEndpoint = 'click' | 'postback' | 'pixel' | 'iframe' | 'sl' | 'postback_click' | 'signup';

function sha256(value: string): string {
 return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function bucketIndex(now: Date): number {
 return Math.floor(now.getTime() / BUCKET_MS);
}

function scopeKeys(scope: string, ipHash: string, idx: number): string[] {
 return Array.from({ length: BUCKET_COUNT }, (_, i) => `tr:${scope}:${ipHash}:${idx - i}`);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RateLimitResult {
 /** Whether the request should be blocked. */
 limited: boolean;
 /** Seconds the client should wait before retrying. */
 retryAfterSeconds: number;
 /** Current sliding-window total (0 if Redis unavailable). */
 count: number;
}

// ---------------------------------------------------------------------------
// checkTrackingRateLimit — call at the start of each handler
// ---------------------------------------------------------------------------

/**
 * Counts this request and checks the window (current minute + the 4 before): limited when the
 * total is over `limit`. One pipeline: INCR + EXPIRE the current bucket, GET the 4 earlier ones.
 *
 * Redis failures fail open (returns limited: false) so legitimate traffic
 * is never blocked by infrastructure issues.
 */
export async function checkTrackingRateLimit(
 identifier: string,
 endpoint: TrackingEndpoint,
 limit: number,
): Promise<RateLimitResult> {
 const keys = scopeKeys(endpoint, sha256(identifier), bucketIndex(new Date()));
 try {
 const pipe = getRedis().pipeline();
 pipe.incr(keys[0]!);
 pipe.expire(keys[0]!, BUCKET_TTL_S);
 for (const k of keys.slice(1)) pipe.get(k);
 const res = (await pipe.exec()) as [Error | null, unknown][];
 const count = Number(res[0]?.[1] ?? 0) + res.slice(2).reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
 if (count > limit) {
 // Retry after: one bucket granularity — the oldest counts roll off in ~60s.
 return { limited: true, retryAfterSeconds: BUCKET_MS / 1000, count };
 }
 return { limited: false, retryAfterSeconds: 0, count };
 } catch (err) {
 logger.warn({ err, endpoint }, 'tracking rate limiter: Redis unavailable — failing open');
 return { limited: false, retryAfterSeconds: 0, count: 0 };
 }
}

/** Read-only: how many have been counted for `identifier` in the window (0 when Redis is down). */
export async function peekTrackingRateLimit(identifier: string, endpoint: TrackingEndpoint): Promise<number> {
 const keys = scopeKeys(endpoint, sha256(identifier), bucketIndex(new Date()));
 try {
 const vals = await getRedis().mget(...keys);
 return vals.reduce((sum, v) => sum + (Number(v) || 0), 0);
 } catch (err) {
 logger.warn({ err, endpoint }, 'tracking rate limiter: Redis unavailable — failing open');
 return 0;
 }
}

/** Count one against `identifier` without checking — e.g. a postback that failed (O3). */
export async function chargeTrackingRateLimit(identifier: string, endpoint: TrackingEndpoint): Promise<void> {
 const key = scopeKeys(endpoint, sha256(identifier), bucketIndex(new Date()))[0]!;
 try {
 await getRedis().pipeline().incr(key).expire(key, BUCKET_TTL_S).exec();
 } catch (err) {
 logger.warn({ err, endpoint }, 'tracking rate limiter: Redis unavailable — failing open');
 }
}
