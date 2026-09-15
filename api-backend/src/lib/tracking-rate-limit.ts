/**
 * Tracking surface rate limiter (AP-1 finding / Task 9.3.3).
 *
 * Protects the public tracking endpoints from abuse using a Redis-backed sliding
 * window counter, scoped by IP + endpoint path.
 *
 * Sliding window: 5 x 1-minute buckets. Counter sums all active buckets within
 * the window. Each bucket auto-expires 5 minutes after its first increment.
 *
 * Key structure: tr:<scope>:<sha256(ip)>:<bucket_idx>
 * - tr: prefix separates tracking RL keys from login (lr:*) keys
 * - scope: endpoint dimension (click, postback, pixel, iframe, sl)
 * - sha256(ip): prevents raw IP exposure and special-char injection
 * - bucket_idx: floor(now_ms / 60000)
 *
 * Thresholds (env-configurable, production-safe defaults):
 * - TRACKING_RL_CLICK_LIMIT → 120 requests/IP per 5-min window
 * - TRACKING_RL_POSTBACK_LIMIT → 60 requests/IP per 5-min window
 *
 * Redis failure: FAIL OPEN. A Redis outage must not block legitimate affiliate
 * traffic. The limiter returns { limited: false } and logs a warning. Security
 * tradeoff is documented here and in the final report.
 */

import crypto from 'node:crypto';
import { getRedis } from './redis.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BUCKET_MS = 60_000; // 1 minute
const BUCKET_COUNT = 5; // 5-minute window

export const CLICK_LIMIT = Number.parseInt(process.env.TRACKING_RL_CLICK_LIMIT ?? '120', 10);
export const POSTBACK_LIMIT = Number.parseInt(process.env.TRACKING_RL_POSTBACK_LIMIT ?? '60', 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type TrackingEndpoint = 'click' | 'postback' | 'pixel' | 'iframe' | 'sl';

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
 * Checks and enforces the rate limit for a tracking endpoint.
 *
 * Uses a single Redis pipeline: INCR all buckets, then EXPIRE all buckets.
 * This keeps results unambiguous and minimizes round-trips.
 *
 * Redis failures fail open (returns limited: false) so legitimate traffic
 * is never blocked by infrastructure issues.
 */
export async function checkTrackingRateLimit(
 ip: string,
 endpoint: TrackingEndpoint,
 limit: number,
): Promise<RateLimitResult> {
 const now = new Date();
 const idx = bucketIndex(now);
 const ipHash = sha256(ip);
 const keys = scopeKeys(endpoint, ipHash, idx);

 try {
 const redis = getRedis();

 // Pipeline 1: INCR all buckets (returns new count for each).
 const incrPipe = redis.pipeline();
 for (const k of keys) incrPipe.incr(k);
 const incrResults = (await incrPipe.exec()) as [Error | null, number][];

 // Pipeline 2: EXPIRE all buckets (no-op for keys with existing TTL).
 const expPipe = redis.pipeline();
 for (const k of keys) expPipe.expire(k, BUCKET_MS * BUCKET_COUNT);
 await expPipe.exec();

 // Sum active bucket counts.
 const count = incrResults.reduce((sum, [, val]) => sum + (Number(val) || 0), 0);

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
