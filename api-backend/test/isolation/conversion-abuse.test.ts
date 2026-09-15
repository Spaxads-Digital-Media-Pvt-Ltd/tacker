import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkConversionAbuse, CONV_ABUSE_LIMIT, CONV_ABUSE_KEY_TTL_S } from '../../src/lib/conversion-abuse.js';

describe('checkConversionAbuse (T-2)', () => {
 beforeEach(() => {
 vi.resetModules();
 });

 function makeRedis(counts: Record<string, number> = {}): {
 incr: ReturnType<typeof vi.fn>;
 expire: ReturnType<typeof vi.fn>;
 } {
 return {
 incr: vi.fn(async (key: string) => {
 const next = (counts[key] ?? 0) + 1;
 counts[key] = next;
 return next;
 }),
 expire: vi.fn(async () => true),
 };
 }

 it('returns not-limited on first attempt with a txnId', async () => {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis as any, 'click-1', 'txn-1', 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(1);
 expect(redis.expire).toHaveBeenCalledWith('convabuse:net-1:click-1', CONV_ABUSE_KEY_TTL_S);
 });

 it('returns not-limited under the threshold', async () => {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis as any, 'click-1', 'txn-1', 'net-1');
 expect(result.count).toBe(1);
 expect(result.limited).toBe(false);
 });

 it('returns limited when count exceeds CONV_ABUSE_LIMIT', async () => {
 const redis = makeRedis();
 // Call 11 times: count goes 1..11, limit is 10
 for (let i = 0; i < 10; i++) {
 const r = await checkConversionAbuse(redis as any, 'click-1', `txn-${i}`, 'net-1');
 expect(r.limited).toBe(false);
 }
 // 11th call: count = 11 > 10
 const r = await checkConversionAbuse(redis as any, 'click-1', 'txn-last', 'net-1');
 expect(r.limited).toBe(true);
 expect(r.count).toBe(11);
 });

 it('returns limited exactly at CONV_ABUSE_LIMIT + 1', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 for (let i = 0; i <= CONV_ABUSE_LIMIT; i++) {
 await checkConversionAbuse(redis as any, 'click-1', `txn-${i}`, 'net-1');
 }
 expect(counts['convabuse:net-1:click-1']).toBe(CONV_ABUSE_LIMIT + 1);
 });

 it('allows same txnId replay (idempotency handled separately)', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 // Same txnId each time — the guard increments per call regardless;
 // the idempotency key prevents DB writes. The guard is a hard circuit-breaker.
 const r1 = await checkConversionAbuse(redis as any, 'click-1', 'same-txn', 'net-1');
 expect(r1.limited).toBe(false);
 const r2 = await checkConversionAbuse(redis as any, 'click-1', 'same-txn', 'net-1');
 expect(r2.count).toBe(2);
 expect(r2.limited).toBe(false);
 });

 it('returns not-limited for null txnId', async () => {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis as any, 'click-1', null, 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(0);
 expect(redis.incr).not.toHaveBeenCalled();
 });

 it('returns not-limited for empty-string txnId', async () => {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis as any, 'click-1', '', 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(0);
 expect(redis.incr).not.toHaveBeenCalled();
 });

 it('returns not-limited for whitespace-only txnId', async () => {
 const redis = makeRedis();
 const result = await checkConversionAbuse(redis as any, 'click-1', ' ', 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(0);
 expect(redis.incr).not.toHaveBeenCalled();
 });

 it('scopes keys by networkId + clickId (no cross-tenant bleed)', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 await checkConversionAbuse(redis as any, 'click-A', 'txn-1', 'net-1');
 await checkConversionAbuse(redis as any, 'click-A', 'txn-2', 'net-1');
 await checkConversionAbuse(redis as any, 'click-B', 'txn-1', 'net-2');
 expect(counts['convabuse:net-1:click-A']).toBe(2);
 expect(counts['convabuse:net-2:click-B']).toBe(1);
 });

 it('sets expiry only on the first increment', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 await checkConversionAbuse(redis as any, 'click-1', 'txn-1', 'net-1');
 await checkConversionAbuse(redis as any, 'click-1', 'txn-2', 'net-1');
 await checkConversionAbuse(redis as any, 'click-1', 'txn-3', 'net-1');
 expect(redis.expire).toHaveBeenCalledTimes(1);
 expect(redis.expire).toHaveBeenCalledWith('convabuse:net-1:click-1', CONV_ABUSE_KEY_TTL_S);
 });

 it('returns fail-open when redis.incr throws', async () => {
 const redis = {
 incr: vi.fn(async () => { throw new Error('Redis down'); }),
 expire: vi.fn(async () => true),
 };
 const result = await checkConversionAbuse(redis as any, 'click-1', 'txn-1', 'net-1');
 expect(result.limited).toBe(false);
 expect(result.count).toBe(0);
 });

 it('returns fail-open when redis.expire throws (TTL failure is non-fatal, count preserved)', async () => {
 const redis = {
 incr: vi.fn(async () => 1),
 expire: vi.fn(async () => { throw new Error('Redis down'); }),
 };
 const result = await checkConversionAbuse(redis as any, 'click-1', 'txn-1', 'net-1');
 expect(result.limited).toBe(false);
 // incr succeeded (count=1), expire threw but is swallowed — count is still 1
 expect(result.count).toBe(1);
 });

 it('builds the key as convabuse:${networkId}:${clickId}', async () => {
 const counts: Record<string, number> = {};
 const redis = makeRedis(counts);
 await checkConversionAbuse(redis as any, 'click-abc', 'txn-xyz', 'net-999');
 expect(redis.incr).toHaveBeenCalledWith('convabuse:net-999:click-abc');
 });
});
