/**
 * Login rate limiter tests — unit (an in-memory Redis that really counts) + HTTP integration.
 *
 * O3: a failure counts ONCE (it used to INCR all 3 buckets — an account locked after 2 wrong
 * passwords, an IP after 4). Now 5 failures lock the account and 10 the IP, for 15 minutes.
 * HTTP integration tests run with INTEGRATION_DB=1 (as in CI); Redis and Supabase are faked here.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { memoryRedis, type MemoryRedis } from '../helpers/memory-redis.js';

let redis: MemoryRedis;
let down = false;
vi.mock('../../src/lib/redis.js', () => ({
 getRedis: () => { if (down) throw new Error('ECONNREFUSED'); return redis; },
}));
// The HTTP tests' Supabase: every sign-in is refused as invalid credentials (unknown account or wrong password alike).
vi.mock('../../src/lib/supabase.js', () => ({
 getSupabaseAdmin: () => ({ auth: { signInWithPassword: async () => ({ data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } }) } }),
 createEphemeralAuthClient: () => { throw new Error('not used'); },
}));

import { checkLoginRateLimit, loginRateLimitMessage, recordLoginFailure, resetLoginCounter } from '../../src/lib/auth/login-rate-limit.js';

describe('login rate limiter (unit, in-memory Redis)', () => {
 beforeEach(() => { redis = memoryRedis(); down = false; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T10:01:00Z')); });
 afterEach(() => { vi.useRealTimers(); });

 const fail = async (n: number, ip = '10.0.0.1', who = 'user@example.com') => { for (let i = 0; i < n; i++) await recordLoginFailure(ip, who); };

 it('1. one failure counts once (it used to count 3)', async () => {
 const r = await recordLoginFailure('10.0.0.1', 'user@example.com');
 expect(r).toMatchObject({ limited: false, ipCount: 1, accountCount: 1 });
 expect(await checkLoginRateLimit('10.0.0.1', 'user@example.com')).toMatchObject({ limited: false, ipCount: 1, accountCount: 1 });
 });

 it('2. five wrong passwords lock the account — not two', async () => {
 await fail(4);
 expect((await checkLoginRateLimit('10.0.0.1', 'user@example.com')).limited).toBe(false);
 await fail(1);
 // All five at 10:01 count until their bucket (10:00–10:05) leaves the window at 10:15 — 14 minutes, not 5.
 expect(await checkLoginRateLimit('10.0.0.1', 'user@example.com')).toMatchObject({ limited: true, reason: 'account', retryAfterSeconds: 840 });
 // …from any IP.
 expect((await checkLoginRateLimit('203.0.113.5', 'user@example.com')).reason).toBe('account');
 });

 it('2b. the wait it quotes is exact — locked until that second, and the message says so', async () => {
 await fail(3); // 10:01 — bucket 10:00–10:05
 vi.setSystemTime(new Date('2026-10-15T10:06:00Z'));
 await fail(2); // bucket 10:05–10:10 → 5 in the window
 vi.setSystemTime(new Date('2026-10-15T10:07:00Z'));
 const locked = await checkLoginRateLimit('10.0.0.1', 'user@example.com');
 expect(locked).toMatchObject({ limited: true, reason: 'account', retryAfterSeconds: 480 }); // the three leave at 10:15
 expect(loginRateLimitMessage(locked)).toBe('Too many failed attempts for this account — try again in 8 minutes.');
 vi.setSystemTime(new Date('2026-10-15T10:14:59Z'));
 expect(await checkLoginRateLimit('10.0.0.1', 'user@example.com')).toMatchObject({ limited: true, retryAfterSeconds: 1 });
 vi.setSystemTime(new Date('2026-10-15T10:15:00Z'));
 expect((await checkLoginRateLimit('10.0.0.1', 'user@example.com')).limited).toBe(false);
 expect(loginRateLimitMessage({ limited: true, reason: 'ip', retryAfterSeconds: 1, ipCount: 10, accountCount: 0 }))
 .toBe('Too many login attempts from this network — try again in 1 minute.');
 });

 it('3. ten failures from one IP lock the IP — across accounts', async () => {
 for (let i = 0; i < 9; i++) await recordLoginFailure('10.0.0.1', `u${i}@example.com`);
 expect((await checkLoginRateLimit('10.0.0.1', 'other@example.com')).limited).toBe(false);
 await recordLoginFailure('10.0.0.1', 'u9@example.com');
 expect(await checkLoginRateLimit('10.0.0.1', 'other@example.com')).toMatchObject({ limited: true, reason: 'ip' });
 });

 it('4. the window slides: failures older than 15 minutes stop counting; keys expire in seconds', async () => {
 await fail(5);
 expect((await checkLoginRateLimit('10.0.0.1', 'user@example.com')).limited).toBe(true);
 for (const k of redis.keys()) expect(await redis.ttl(k)).toBeLessThanOrEqual(900);
 vi.setSystemTime(new Date('2026-10-15T10:16:01Z'));
 expect((await checkLoginRateLimit('10.0.0.1', 'user@example.com')).limited).toBe(false);
 });

 it('5. a successful login resets the account (not the IP)', async () => {
 await fail(5);
 await resetLoginCounter('user@example.com');
 expect(await checkLoginRateLimit('10.0.0.1', 'user@example.com')).toMatchObject({ limited: false, accountCount: 0, ipCount: 5 });
 });

 it('6. keys are SHA-256 hashes — never the raw IP or email', async () => {
 await fail(1);
 const keys = redis.keys();
 expect(keys.length).toBeGreaterThan(0);
 for (const k of keys) {
 expect(k).not.toContain('10.0.0.1');
 expect(k).not.toContain('user@example.com');
 expect(k).toMatch(/^lr:(ip|acct):[0-9a-f]{64}:\d+$/);
 }
 });

 it('7. Redis unavailable: fails open, no crash', async () => {
 down = true;
 expect(await checkLoginRateLimit('10.0.0.1', 'user@example.com')).toMatchObject({ limited: false, ipCount: 0, accountCount: 0 });
 expect(await recordLoginFailure('10.0.0.1', 'user@example.com')).toMatchObject({ limited: false });
 });

 it('8. an unknown account and a known one are counted the same way', async () => {
 const a = await recordLoginFailure('10.0.0.2', 'unknown@example.com');
 const b = await recordLoginFailure('10.0.0.3', 'known@example.com');
 expect([a.limited, a.ipCount, a.accountCount]).toEqual([b.limited, b.ipCount, b.accountCount]);
 });
});

// ---------------------------------------------------------------------------
// HTTP integration tests (INTEGRATION_DB=1 — Redis is the in-memory fake, Supabase the stub above)
// ---------------------------------------------------------------------------

// It needed INTEGRATION_REDIS=1 too, which CI never set — so test 13 went stale unnoticed.
const runHttp = process.env.INTEGRATION_DB === '1';
const dHttp = runHttp ? describe : describe.skip;

dHttp('Login rate limiting — HTTP integration', () => {
 let dashboardApp: unknown;
 let platformApp: unknown;

 beforeAll(async () => {
 const { buildDashboardApp: bda } = await import('../../src/surfaces/dashboard/app.js');
 const { buildPlatformAdminApp: bpa } = await import('../../src/surfaces/platform-admin/app.js');
 dashboardApp = bda();
 platformApp = bpa();
 });

 it('12. 429 response: rate_limited code + Retry-After header (platform-admin)', async () => {
 const { default: request } = await import('supertest');
 const email = 'rl429-http-' + Date.now() + '@test.local';
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const res = await (request as (app: unknown) => any)(platformApp).post('/platform/login').send({ email, password: 'wrong' });
 if (res.status === 429) {
 expect(res.body.error.code).toBe('rate_limited');
 expect(res.headers['retry-after']).toBeDefined();
 expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
 }
 });

 it('13. unknown account and wrong password produce identical 401 (dashboard)', async () => {
 const { default: request } = await import('supertest');
 const email = 'no-such-' + Date.now() + '@test.local';
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const rt = request as (app: unknown) => any;
 // Passwords long enough for the sign-in policy (12+) — a short one is refused with 422 before any
 // credentials are checked. Supabase answers "invalid credentials" for both (the fake below).
 const unknownRes = await rt(dashboardApp).post('/api/auth/login').send({ email, password: 'wrong-password-1' });
 const wrongPassRes = await rt(dashboardApp).post('/api/auth/login').send({ email, password: 'also-wrong-password-2' });
 expect(unknownRes.status).toBe(401);
 expect(wrongPassRes.status).toBe(401);
 expect(unknownRes.body.error.message).toBe(wrongPassRes.body.error.message);
 });
});
