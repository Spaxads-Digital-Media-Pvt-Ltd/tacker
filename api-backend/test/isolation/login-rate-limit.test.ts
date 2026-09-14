/**
 * Login rate limiter tests — unit (mocked Redis) + HTTP integration.
 *
 * Unit tests run in all environments by mocking the Redis singleton.
 * HTTP integration tests require INTEGRATION_DB=1 + INTEGRATION_REDIS=1.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeRedis = any;

function makeMockRedis() {
 const incrResults: [Error | null, number | null][] = [];
 const store = new Map<string, number>();

 const chainable: FakeRedis = {
 exec: async () => {
 const r: [Error | null, number | null][] = [];
 for (const pair of incrResults) r.push([pair[0], pair[1]]);
 return r;
 },
 incr: (_k: string) => chainable,
 expire: (_k: string) => chainable,
 };

 const instance: FakeRedis = {
 incr: async (key: string) => {
 const cur = store.get(key) ?? 0;
 store.set(key, cur + 1);
 return cur + 1;
 },
 expire: async () => 1,
 del: async (...keys: string[]) => { for (const k of keys) store.delete(k); return 0; },
 pipeline: () => chainable,
 };

 function setResults(results: [Error | null, number | null][]) {
 incrResults.length = 0;
 for (const r of results) incrResults.push([r[0], r[1]]);
 }

 return { instance, setResults };
}

// ---------------------------------------------------------------------------
// Unit tests: checkLoginRateLimit
// ---------------------------------------------------------------------------

describe('checkLoginRateLimit (unit, mocked Redis)', () => {
 let fake: FakeRedis;
 let sr: (r: [Error | null, number | null][]) => void;
 let getRedisMock: ReturnType<typeof vi.fn>;

 beforeEach(() => {
 const { instance, setResults } = makeMockRedis();
 fake = instance;
 sr = setResults;
 getRedisMock = vi.fn(() => fake);
 vi.doMock('../../src/lib/redis.js', () => ({ getRedis: getRedisMock }));
 });

 afterEach(() => {
 vi.doUnmock('../../src/lib/redis.js');
 vi.resetModules();
 });

 async function mod() {
 return import('../../src/lib/auth/login-rate-limit.js');
 }

 function fr(ipVals: number[], acctVals: number[]): [Error | null, number | null][] {
 const r: [Error | null, number | null][] = [];
 for (const v of ipVals) r.push([null, v]);
 for (const v of acctVals) r.push([null, v]);
 return r;
 }

 it('1. below threshold: limited=false, counts=3+3=6', async () => {
 sr(fr([1, 1, 1], [1, 1, 1]));
 const m = await mod();
 const result = await m.checkLoginRateLimit('10.0.0.1', 'user@example.com');
 expect(result.limited).toBe(false);
 expect(result.ipCount).toBe(3);
 expect(result.accountCount).toBe(3);
 });

 it('2. IP limit exceeded (11>10): limited=true, reason=ip', async () => {
 sr(fr([5, 4, 2], [0, 0, 0]));
 const m = await mod();
 const result = await m.checkLoginRateLimit('10.0.0.1', 'user@example.com');
 expect(result.limited).toBe(true);
 expect(result.reason).toBe('ip');
 expect(result.retryAfterSeconds).toBe(300);
 });

 it('3. account limit exceeded (6>5): limited=true, reason=account', async () => {
 sr(fr([2, 0, 0], [3, 2, 1]));
 const m = await mod();
 const result = await m.checkLoginRateLimit('10.0.0.1', 'user@example.com');
 expect(result.limited).toBe(true);
 expect(result.reason).toBe('account');
 expect(result.retryAfterSeconds).toBe(300);
 });

 it('4. different accounts same IP: IP limit enforced', async () => {
 sr(fr([5, 4, 2], [1, 0, 0]));
 const m = await mod();
 const result = await m.checkLoginRateLimit('10.0.0.1', 'other@example.com');
 expect(result.limited).toBe(true);
 expect(result.reason).toBe('ip');
 });

 it('5. same account different IP: account limit enforced', async () => {
 sr(fr([0, 0, 0], [3, 2, 1]));
 const m = await mod();
 const result = await m.checkLoginRateLimit('203.0.113.5', 'user@example.com');
 expect(result.limited).toBe(true);
 expect(result.reason).toBe('account');
 });

 it('6. recordLoginFailure increments counters (shared impl)', async () => {
 sr(fr([1, 1, 1], [1, 1, 1]));
 const m = await mod();
 const result = await m.recordLoginFailure('10.0.0.1', 'user@example.com');
 expect(result.limited).toBe(false);
 expect(result.ipCount).toBe(3);
 expect(result.accountCount).toBe(3);
 });

 it('7. Redis unavailable: fails open, no crash', async () => {
 const failRedis: FakeRedis = {
 incr: async () => { throw new Error('ECONNREFUSED'); },
 expire: async () => {},
 del: async () => 0,
 pipeline: () => { throw new Error('ECONNREFUSED'); },
 };
 getRedisMock.mockReturnValueOnce(failRedis);
 const m = await mod();
 const result = await m.checkLoginRateLimit('10.0.0.1', 'user@example.com');
 expect(result.limited).toBe(false);
 expect(result.ipCount).toBe(0);
 expect(result.accountCount).toBe(0);
 });

 it('8. Redis keys use SHA-256 hashes, not raw IP or email', async () => {
 const captured: string[] = [];
 const spyRedis: FakeRedis = {
 incr: async (key: string) => { captured.push(key); return 1; },
 expire: async () => 1,
 del: async () => 0,
 pipeline: () => {
 const keys: string[] = [];
 const self = {
 incr: (key: string) => { keys.push(key); return self; },
 expire: (key: string) => { keys.push(key); return self; },
 del: () => self,
 exec: async () => keys.map((_k: string) => [null, 1]),
 };
 return self;
 },
 };
 getRedisMock.mockReturnValueOnce(spyRedis);
 const m = await mod();
 await m.checkLoginRateLimit('10.0.0.1', 'user@example.com');
 for (const k of captured) {
 expect(k).not.toContain('10.0.0.1');
 expect(k).not.toContain('user@example.com');
 expect(k).toMatch(/^lr:(ip|acct):[0-9a-f]{64}:\d+$/);
 }
 });

 it('9. unknown account and known account produce same rate-limit result', async () => {
 sr(fr([1, 1, 1], [1, 1, 1]));
 const m = await mod();
 const r1 = await m.recordLoginFailure('10.0.0.1', 'unknown@example.com');
 const r2 = await m.recordLoginFailure('10.0.0.1', 'known@example.com');
 expect(r1.limited).toBe(r2.limited);
 expect(r1.ipCount).toBe(r2.ipCount);
 expect(r1.accountCount).toBe(r2.accountCount);
 });
});

// ---------------------------------------------------------------------------
// Unit tests: resetLoginCounter
// ---------------------------------------------------------------------------

describe('resetLoginCounter (unit, mocked Redis)', () => {
 let fake: FakeRedis;
 let capturedDelKeys: string[];
 let getRedisMock: ReturnType<typeof vi.fn>;

 beforeEach(() => {
 capturedDelKeys = [];
 const { instance } = makeMockRedis();
 fake = instance;
 const spyRedis: FakeRedis = {
 ...fake,
 del: async (...keys: string[]) => { capturedDelKeys.push(...keys); return 0; },
 };
 getRedisMock = vi.fn(() => spyRedis);
 vi.doMock('../../src/lib/redis.js', () => ({ getRedis: getRedisMock }));
 });

 afterEach(() => {
 vi.doUnmock('../../src/lib/redis.js');
 vi.resetModules();
 });

 it('10. deletes only acct keys, 3 keys for 3 buckets', async () => {
 const m = await import('../../src/lib/auth/login-rate-limit.js');
 await m.resetLoginCounter('user@example.com');
 expect(capturedDelKeys.length).toBe(3);
 for (const key of capturedDelKeys) {
 expect(key).toMatch(/^lr:acct:/);
 }
 });

 it('11. different identifiers produce different SHA-256 hashes in keys', async () => {
 const m = await import('../../src/lib/auth/login-rate-limit.js');
 await m.resetLoginCounter('user-a@example.com');
 await m.resetLoginCounter('user-b@example.com');
 expect(capturedDelKeys.length).toBe(6);
 const hashes = new Set(capturedDelKeys.map((k) => k.split(':')[2]));
 expect(hashes.size).toBe(2);
 });
});

// ---------------------------------------------------------------------------
// HTTP integration tests (INTEGRATION_DB=1 + INTEGRATION_REDIS=1)
// ---------------------------------------------------------------------------

const runHttp = process.env.INTEGRATION_DB === '1' && process.env.INTEGRATION_REDIS === '1';
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
 const unknownRes = await rt(dashboardApp).post('/api/auth/login').send({ email, password: 'wrong' });
 const wrongPassRes = await rt(dashboardApp).post('/api/auth/login').send({ email, password: 'also-wrong' });
 expect(unknownRes.status).toBe(401);
 expect(wrongPassRes.status).toBe(401);
 expect(unknownRes.body.error.message).toBe(wrongPassRes.body.error.message);
 });
});
