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
});
