import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkConversionAbuse, CONV_ABUSE_LIMIT, CONV_ABUSE_KEY_TTL_S } from '../../src/lib/conversion-abuse.js';

// The guard counts a click's new conversions (with or without a transaction id); past the offer's
// limit the caller holds the next ones for review — it never decides to drop anything.
describe('checkConversionAbuse (T-2)', () => {
 beforeEach(() => {
 vi.resetModules();
 });

 function makeRedis(counts: Record<string, number> = {}) {
 return {
 incr: vi.fn(async (key: string) => {
 const next = (counts[key] ?? 0) + 1;
 counts[key] = next;
 return next;
 }),
 expire: vi.fn(async () => true),
 };
 }

 it('returns not-limited on the first conversion', async () => {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis, 'click-1', 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(1);
 expect(redis.expire).toHaveBeenCalledWith('convabuse:net-1:click-1', CONV_ABUSE_KEY_TTL_S);
 });

 it('returns limited once the count exceeds the default CONV_ABUSE_LIMIT', async () => {
 const redis = makeRedis();
 for (let i = 0; i < CONV_ABUSE_LIMIT; i++) {
 const r = await checkConversionAbuse(redis, 'click-1', 'net-1');
 expect(r.limited).toBe(false);
 }
 const r = await checkConversionAbuse(redis, 'click-1', 'net-1');
 expect(r.limited).toBe(true);
 expect(r.count).toBe(CONV_ABUSE_LIMIT + 1);
 });

 it("follows the offer's own limit", async () => {
 const redis = makeRedis();
 for (let i = 0; i < 3; i++) expect((await checkConversionAbuse(redis, 'click-1', 'net-1', 3)).limited).toBe(false);
 expect((await checkConversionAbuse(redis, 'click-1', 'net-1', 3)).limited).toBe(true);
 });

 it('a limit of 0 or null turns the guard off — nothing is counted', async () => {
 for (const limit of [0, null]) {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis, 'click-1', 'net-1', limit);
 expect(result).toEqual({ limited: false, count: 0 });
 expect(redis.incr).not.toHaveBeenCalled();
 }
 });

 it('scopes keys by networkId + clickId (no cross-tenant bleed)', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 await checkConversionAbuse(redis, 'click-A', 'net-1');
 await checkConversionAbuse(redis, 'click-A', 'net-1');
 await checkConversionAbuse(redis, 'click-B', 'net-2');
 expect(counts['convabuse:net-1:click-A']).toBe(2);
 expect(counts['convabuse:net-2:click-B']).toBe(1);
 });

 it('sets expiry only on the first increment', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 await checkConversionAbuse(redis, 'click-1', 'net-1');
 await checkConversionAbuse(redis, 'click-1', 'net-1');
 await checkConversionAbuse(redis, 'click-1', 'net-1');
 expect(redis.expire).toHaveBeenCalledTimes(1);
 expect(redis.expire).toHaveBeenCalledWith('convabuse:net-1:click-1', CONV_ABUSE_KEY_TTL_S);
 });

 it('returns fail-open when redis.incr throws', async () => {
 const redis = {
 incr: vi.fn(async () => { throw new Error('Redis down'); }),
 expire: vi.fn(async () => true),
 };
 const result = await checkConversionAbuse(redis, 'click-1', 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(0);
 });

 it('returns fail-open when redis.expire throws (TTL failure is non-fatal, count preserved)', async () => {
 const redis = {
 incr: vi.fn(async () => 1),
 expire: vi.fn(async () => { throw new Error('Redis down'); }),
 };
 const result = await checkConversionAbuse(redis, 'click-1', 'net-1');
 expect(result.limited).toBe(false);
 // incr succeeded (count=1), expire threw but is swallowed — count is still 1
 expect(result.count).toBe(1);
 });

 it('builds the key as convabuse:${networkId}:${clickId}', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 await checkConversionAbuse(redis, 'click-abc', 'net-999');
 expect(redis.incr).toHaveBeenCalledWith('convabuse:net-999:click-abc');
 });
});
