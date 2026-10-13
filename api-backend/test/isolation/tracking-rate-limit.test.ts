import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/redis.js', () => ({
 getRedis: () => (globalThis as any).__mockRedis,
 }));

describe('checkTrackingRateLimit', () => {
 beforeEach(() => {
 vi.resetModules();
 });

 it('returns limited:false when under the threshold', async () => {
 const pipeline = {
 incr: vi.fn(async () => pipeline),
 expire: vi.fn(async () => pipeline),
 exec: vi.fn(async () => Array.from({ length: 5 }, () => [null, 1])),
 };
 (globalThis as any).__mockRedis = { pipeline: () => pipeline };
 const { checkTrackingRateLimit: fn } = await import('../../src/lib/tracking-rate-limit.js');
 const result = await fn('1.2.3.4', 'click', 120);
 expect(result.limited).toBe(false);
 expect(result.count).toBe(5);
 });

 it('returns limited:true when over the threshold', async () => {
 const pipeline = {
 incr: vi.fn(async () => pipeline),
 expire: vi.fn(async () => pipeline),
 exec: vi.fn(async () => Array.from({ length: 5 }, () => [null, 30])),
 };
 (globalThis as any).__mockRedis = { pipeline: () => pipeline };
 const { checkTrackingRateLimit: fn } = await import('../../src/lib/tracking-rate-limit.js');
 const result = await fn('1.2.3.4', 'click', 120);
 expect(result.limited).toBe(true);
 expect(result.retryAfterSeconds).toBe(60);
 });

 it('returns limited:false when Redis throws (fail open)', async () => {
 const pipeline = {
 incr: vi.fn(async () => { throw new Error('Redis down'); }),
 expire: vi.fn(async () => pipeline),
 exec: vi.fn(async () => []),
 };
 (globalThis as any).__mockRedis = { pipeline: () => pipeline };
 const { checkTrackingRateLimit: fn } = await import('../../src/lib/tracking-rate-limit.js');
 const result = await fn('1.2.3.4', 'click', 120);
 expect(result.limited).toBe(false);
 expect(result.count).toBe(0);
 });

 it('returns limited:false for postback endpoint', async () => {
 const pipeline = {
 incr: vi.fn(async () => pipeline),
 expire: vi.fn(async () => pipeline),
 exec: vi.fn(async () => Array.from({ length: 5 }, () => [null, 1])),
 };
 (globalThis as any).__mockRedis = { pipeline: () => pipeline };
 const { checkTrackingRateLimit: fn } = await import('../../src/lib/tracking-rate-limit.js');
 const result = await fn('5.6.7.8', 'postback', 60);
 expect(result.limited).toBe(false);
 });

 it('returns limited:false for sl endpoint', async () => {
 const pipeline = {
 incr: vi.fn(async () => pipeline),
 expire: vi.fn(async () => pipeline),
 exec: vi.fn(async () => Array.from({ length: 5 }, () => [null, 1])),
 };
 (globalThis as any).__mockRedis = { pipeline: () => pipeline };
 const { checkTrackingRateLimit: fn } = await import('../../src/lib/tracking-rate-limit.js');
 const result = await fn('5.6.7.8', 'sl', 120);
 expect(result.limited).toBe(false);
 });
 it('postback_click (F-01) scopes the window to a hashed click_id, never the raw id', async () => {
 const keys: string[] = [];
 const pipeline = {
 incr: vi.fn((k: string) => { keys.push(k); return pipeline; }),
 expire: vi.fn(async () => pipeline),
 exec: vi.fn(async () => Array.from({ length: 5 }, () => [null, 25])),
 };
 (globalThis as unknown as { __mockRedis: unknown }).__mockRedis = { pipeline: () => pipeline };
 const { checkTrackingRateLimit: fn, POSTBACK_PER_CLICK_LIMIT } = await import('../../src/lib/tracking-rate-limit.js');
 const clickId = '4505ad77c1eb455c8a1c8a9ebda1f519';
 const result = await fn(clickId, 'postback_click', POSTBACK_PER_CLICK_LIMIT);
 expect(POSTBACK_PER_CLICK_LIMIT).toBeGreaterThan(0);
 expect(keys).toHaveLength(5);
 expect(keys.every((k) => k.startsWith('tr:postback_click:'))).toBe(true);
 expect(keys.some((k) => k.includes(clickId))).toBe(false);
 expect(result.limited).toBe(5 * 25 > POSTBACK_PER_CLICK_LIMIT);
 });
});
