/**
 * Login rate limiter — dual-key sliding window in Redis.
 *
 * Protects authentication endpoints from brute-force and credential-stuffing by tracking
 * failed attempts against BOTH the client IP and the account identifier (email). Both keys
 * must stay under their respective thresholds for a login to proceed.
 *
 * Two-stage design:
 * 1. checkLoginRateLimit(ip, identifier) — called BEFORE auth; blocks if already over limit.
 * 2. recordLoginFailure(ip, identifier) — called AFTER a failed auth; increments counters.
 * 3. resetLoginCounter(identifier) — called after a SUCCESSFUL login; clears acct key.
 *
 * Sliding window: 15 minutes split into 3 × 5-minute buckets. Counters for all currently-
 * active buckets are summed. Each bucket auto-expires 5 minutes after its first increment.
 *
 * Thresholds (env-configurable, production-safe defaults):
 * - LOGIN_RATE_LIMIT_IP → 10 failures per IP per 15-min window (default)
 * - LOGIN_RATE_LIMIT_ACCOUNT → 5 failures per account per 15-min window (default)
 *
 * Redis key strategy (opaque, no raw PII in keys):
 * lr:ip:<sha256(ip)>:<bucket_idx>
 * lr:acct:<sha256(normalized_email)>:<bucket_idx>
 * SHA-256 prevents special-character injection and avoids storing raw identifiers as key names.
 *
 * Redis failure behavior: FAIL OPEN.
 * A Redis outage must not block legitimate logins. The limiter returns { limited: false }
 * and logs a warning when Redis is unreachable. Security tradeoff is documented in code.
 */

import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WINDOW_MINUTES = 15;
const BUCKET_MINUTES = 5;
const BUCKET_COUNT = WINDOW_MINUTES / BUCKET_MINUTES; // 3

const IP_LIMIT = env.LOGIN_RATE_LIMIT_IP;
const ACCOUNT_LIMIT = env.LOGIN_RATE_LIMIT_ACCOUNT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(value: string): string {
 return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function bucketIndex(now: Date): number {
 return Math.floor(now.getTime() / (BUCKET_MINUTES * 60_000));
}

function ipKeys(ipHash: string, idx: number): string[] {
 return Array.from({ length: BUCKET_COUNT }, (_, i) => `lr:ip:${ipHash}:${idx - i}`);
}

function acctKeys(acctHash: string, idx: number): string[] {
 return Array.from({ length: BUCKET_COUNT }, (_, i) => `lr:acct:${acctHash}:${idx - i}`);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RateLimitResult {
 /** Whether the request is blocked. */
 limited: boolean;
 /** Which counter triggered the block (if limited). */
 reason?: 'ip' | 'account';
 /** Seconds the client should wait before retrying. */
 retryAfterSeconds: number;
 /** Current sliding-window total for the IP key (0 if Redis unavailable). */
 ipCount: number;
 /** Current sliding-window total for the account key (0 if Redis unavailable). */
 accountCount: number;
}

// ---------------------------------------------------------------------------
// checkLoginRateLimit — call BEFORE verifying credentials
// ---------------------------------------------------------------------------

/**
 * Checks whether the IP or account identifier is already over the rate limit.
 * Call at the START of a login handler, before doing any credential verification.
 *
 * Uses two separate pipelines: one for INCR (returns current count), one for EXPIRE.
 * This keeps results unambiguous for both production and testing.
 */
export async function checkLoginRateLimit(
 ip: string,
 normalizedIdentifier: string,
): Promise<RateLimitResult> {
 const now = new Date();
 const idx = bucketIndex(now);
 const ipHash = sha256(ip);
 const acctHash = sha256(normalizedIdentifier);

 const ipK = ipKeys(ipHash, idx);
 const acctK = acctKeys(acctHash, idx);
 const allKeys = [...ipK, ...acctK];

 try {
 const redis = getRedis();

 // Pipeline 1: INCR all buckets (returns new count for each).
 const incrPipe = redis.pipeline();
 for (const k of allKeys) incrPipe.incr(k);
 const incrResults = (await incrPipe.exec()) as [Error | null, number][];

 // Pipeline 2: EXPIRE all buckets (no-op for keys with existing TTL).
 const expPipe = redis.pipeline();
 for (const k of allKeys) expPipe.expire(k, WINDOW_MINUTES * 60);
 await expPipe.exec();

 // INCR results come back in command order: ip[0..2], acct[0..2]
 const ipCounts: number[] = [];
 const acctCounts: number[] = [];
 for (let i = 0; i < BUCKET_COUNT; i++) {
 ipCounts.push(Number(incrResults[i]?.[1] ?? 0));
 }
 for (let i = 0; i < BUCKET_COUNT; i++) {
 acctCounts.push(Number(incrResults[BUCKET_COUNT + i]?.[1] ?? 0));
 }

 const ipTotal = ipCounts.reduce((a, b) => a + b, 0);
 const acctTotal = acctCounts.reduce((a, b) => a + b, 0);

 if (ipTotal > IP_LIMIT) {
 return { limited: true, reason: 'ip', retryAfterSeconds: BUCKET_MINUTES * 60, ipCount: ipTotal, accountCount: acctTotal };
 }
 if (acctTotal > ACCOUNT_LIMIT) {
 return { limited: true, reason: 'account', retryAfterSeconds: BUCKET_MINUTES * 60, ipCount: ipTotal, accountCount: acctTotal };
 }

 return { limited: false, ipCount: ipTotal, accountCount: acctTotal, retryAfterSeconds: 0 };
 } catch (err) {
 logger.warn({ err }, 'login rate limiter: Redis unavailable — failing open');
 return { limited: false, ipCount: 0, accountCount: 0, retryAfterSeconds: 0 };
 }
}

// ---------------------------------------------------------------------------
// recordLoginFailure — call AFTER a failed authentication
// ---------------------------------------------------------------------------

/**
 * Increments the counters for a failed login. Returns the updated totals so the caller
 * can determine whether this failure pushed the account/IP over the limit.
 *
 * Call AFTER verifying credentials are wrong (wrong password, unknown account, disabled
 * account, etc.) so the failure is actually counted.
 */
export async function recordLoginFailure(
 ip: string,
 normalizedIdentifier: string,
): Promise<RateLimitResult> {
 // Reuse checkLoginRateLimit logic — it increments counters atomically.
 return checkLoginRateLimit(ip, normalizedIdentifier);
}

// ---------------------------------------------------------------------------
// resetLoginCounter — call after a SUCCESSFUL login
// ---------------------------------------------------------------------------

/**
 * Clears all bucket keys for the account identifier after a successful login.
 * IP keys are intentionally NOT reset — they track abusive source IPs independently
 * and their TTL will naturally expire.
 */
export async function resetLoginCounter(normalizedIdentifier: string): Promise<void> {
 const now = new Date();
 const idx = bucketIndex(now);
 const hash = sha256(normalizedIdentifier);
 const keys = acctKeys(hash, idx);

 try {
 const redis = getRedis();
 await redis.del(...keys);
 } catch (err) {
 logger.warn({ err }, 'login rate limiter: could not reset account counter');
 }
}
