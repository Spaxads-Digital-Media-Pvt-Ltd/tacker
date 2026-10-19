/**
 * Tracking rate limiter (AP-1, O3) — unit, on an in-memory Redis that really counts.
 *
 * O3: a request counts ONCE (it used to INCR all 5 buckets — counted 3–5 times, so 120 clicks / 5 min
 * meant ~24–40), and a bucket lives 5 minutes in SECONDS (EXPIRE took milliseconds as seconds: ~3.5
 * days). peek / charge back the postback rule: only failed postbacks use up a budget.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memoryRedis, type MemoryRedis } from '../helpers/memory-redis.js';

let redis: MemoryRedis;
let down = false;
vi.mock('../../src/lib/redis.js', () => ({
 getRedis: () => { if (down) throw new Error('Redis down'); return redis; },
}));

import { checkTrackingRateLimit, peekTrackingRateLimit, chargeTrackingRateLimit, POSTBACK_PER_CLICK_LIMIT } from '../../src/lib/tracking-rate-limit.js';

describe('tracking rate limiter', () => {
 beforeEach(() => { redis = memoryRedis(); down = false; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T10:00:30Z')); });
 afterEach(() => { vi.useRealTimers(); });

 it('counts each request once: the 120th click in 5 minutes passes, the 121st is limited', async () => {
 for (let i = 1; i < 120; i++) await checkTrackingRateLimit('1.2.3.4', 'click', 120);
 expect(await checkTrackingRateLimit('1.2.3.4', 'click', 120)).toMatchObject({ limited: false, count: 120 });
 expect(await checkTrackingRateLimit('1.2.3.4', 'click', 120)).toMatchObject({ limited: true, count: 121, retryAfterSeconds: 60 });
 // Another IP is unaffected.
 expect((await checkTrackingRateLimit('5.6.7.8', 'click', 120)).count).toBe(1);
 });

 it('the window slides minute by minute, and keys live 5 minutes (in seconds)', async () => {
 for (let i = 0; i < 10; i++) await checkTrackingRateLimit('1.2.3.4', 'click', 120);
 for (const k of redis.keys()) expect(await redis.ttl(k)).toBeLessThanOrEqual(300);
 vi.setSystemTime(new Date('2026-10-15T10:03:30Z'));
 expect((await checkTrackingRateLimit('1.2.3.4', 'click', 120)).count).toBe(11); // still inside the window
 vi.setSystemTime(new Date('2026-10-15T10:05:10Z'));
 expect((await checkTrackingRateLimit('1.2.3.4', 'click', 120)).count).toBe(2); // the 10:00 minute rolled off
 vi.setSystemTime(new Date('2026-10-15T10:20:00Z'));
 expect(redis.keys()).toHaveLength(0); // nothing lingers for days
 });

 it('peek reads without counting; charge counts without checking (failed postbacks)', async () => {
 expect(await peekTrackingRateLimit('9.9.9.9', 'postback')).toBe(0);
 await chargeTrackingRateLimit('9.9.9.9', 'postback');
 await chargeTrackingRateLimit('9.9.9.9', 'postback');
 expect(await peekTrackingRateLimit('9.9.9.9', 'postback')).toBe(2);
 expect(await peekTrackingRateLimit('9.9.9.9', 'postback')).toBe(2);
 });

 it('fails open when Redis is down', async () => {
 down = true;
 expect(await checkTrackingRateLimit('1.2.3.4', 'click', 120)).toMatchObject({ limited: false, count: 0 });
 expect(await peekTrackingRateLimit('1.2.3.4', 'postback')).toBe(0);
 await expect(chargeTrackingRateLimit('1.2.3.4', 'postback')).resolves.toBeUndefined();
 });

 it('postback_click (F-01) scopes the window to a hashed click_id, never the raw id', async () => {
 const clickId = '4505ad77c1eb455c8a1c8a9ebda1f519';
 await chargeTrackingRateLimit(clickId, 'postback_click');
 expect(POSTBACK_PER_CLICK_LIMIT).toBeGreaterThan(0);
 const keys = redis.keys();
 expect(keys).toHaveLength(1);
 expect(keys[0]).toMatch(/^tr:postback_click:[0-9a-f]{64}:\d+$/);
 expect(keys.some((k) => k.includes(clickId))).toBe(false);
 });
});
