/**
 * A-3 fix: API-key audience/type information leak in 403/401 responses.
 *
 * Exercises the real apiKeyAuth + requireAudience + requireScope middleware chain
 * end-to-end via a fully mocked pool and inspects the HTTP response body for leaked
 * auth metadata.
 *
 * Tests:
 * 1. Wrong audience → 403, no audience/type in response body
 * 2. Insufficient scope → 403, no scope internals in response body
 * 3. Malformed key → 401, no key metadata in response body
 * 4. Unknown key → 401, indistinguishable from malformed key
 * 5. Valid authorized key → 200 with correct data
 * 6. HTTP semantics: 401 for unauthenticated, 403 for unauthorized
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const NET_ID = 'net-a-1111-1111-1111-111111111111';
const ADV_ID = 'adv-b-2222-2222-2222-222222222222';
const NET_KEY_HASH = 'net_live_aaaabbbbccccddddeeeeffff000011112222';
const ADV_KEY_HASH = 'adv_live_zzzzyyyyxxxxwwwwvvvvuuuuttttssssrrrr';
const MALFORMED_KEY = 'not-a-valid-key-format-at-all';
const UNKNOWN_KEY_HASH = 'unknown_key_00000000000000000000000000000000';
const ADV_SCOPES = ['offers:read'];

// --- Pool return factories ---
function advertiserKeyPool(): unknown {
 return {
 rows: [{ id: 'key-adv-1', network_id: NET_ID, audience: 'advertiser', owner_id: ADV_ID, scopes: ADV_SCOPES, rate_limit_tier: 'default' }],
 rowCount: 1,
 };
}

function scopedNetworkPool(): unknown {
 return {
 rows: [{ id: 'key-net-1', network_id: NET_ID, audience: 'network', owner_id: NET_ID, scopes: ['offers:read'], rate_limit_tier: 'default' }],
 rowCount: 1,
 };
}

function emptyPool(): unknown {
 return { rows: [], rowCount: 0 };
}

function fullPoolMock(sql?: string): unknown {
 if (/FROM api_keys/.test(sql ?? '')) {
 return {
 rows: [{ id: 'key-net-2', network_id: NET_ID, audience: 'network', owner_id: NET_ID, scopes: ['offers:read'], rate_limit_tier: 'default' }],
 rowCount: 1,
 };
 }
 if (/UPDATE api_keys SET last_used_at/.test(sql ?? '')) return { rows: [], rowCount: 1 };
 if (/FROM offers/.test(sql ?? '')) return { rows: [{ id: 'off-1', name: 'Test Offer', status: 'active' }], rowCount: 1 };
 return { rows: [], rowCount: 0 };
}

// --- App builders ---
async function buildApp(poolReturn: unknown): Promise<Express> {
 vi.resetModules();
 vi.doMock('../../src/lib/db/pool.js', () => {
 async function query(_text?: string, _params?: unknown[]) {
 return poolReturn;
 }
 return {
 pool: {
 connect: async () => ({
 query,
 release: () => {},
 }),
 query,
 },
 query,
 };
 });

 vi.doMock('../../src/lib/apikeys/rate-limit.js', () => ({
 checkRateLimit: () => Promise.resolve({ allowed: true, limit: 600, remaining: 600 }),
 }));

 const { buildPublicApiApp } = await import('../../src/surfaces/public-api/app.js');
 return buildPublicApiApp();
}

async function buildAppFullMock(): Promise<Express> {
 vi.resetModules();
 vi.doMock('../../src/lib/db/pool.js', () => {
 async function query(text?: string, _params?: unknown[]) {
 return fullPoolMock(text);
 }
 return {
 pool: {
 connect: async () => ({
 query,
 release: () => {},
 }),
 query,
 },
 query,
 };
 });

 vi.doMock('../../src/lib/apikeys/rate-limit.js', () => ({
 checkRateLimit: () => Promise.resolve({ allowed: true, limit: 600, remaining: 600 }),
 }));

 const { buildPublicApiApp } = await import('../../src/surfaces/public-api/app.js');
 return buildPublicApiApp();
}

// --- Tests ---
describe('A-3: API-key audience/type information leak', () => {

 it('wrong audience → 403, no audience or type in response body', async () => {
 const app = await buildApp(advertiserKeyPool());
 const res = await request(app)
 .get('/api/v1/network/offers')
 .set('X-Api-Key', ADV_KEY_HASH);

 expect(res.status).toBe(403);
 const body = res.body;
 expect(body).toHaveProperty('ok', false);
 expect(String((body as { error: { message: string } }).error.message)).toBe('Forbidden.');
 expect(JSON.stringify(body)).not.toContain('advertiser');
 expect(JSON.stringify(body)).not.toContain('audience');
 expect(JSON.stringify(body)).not.toContain('type');
 });

 it('insufficient scope → 403, no scope internals in response body', async () => {
 const app = await buildApp(scopedNetworkPool());
 const res = await request(app)
 .get('/api/v1/network/publishers')
 .set('X-Api-Key', NET_KEY_HASH);

 expect(res.status).toBe(403);
 const body = res.body;
 expect(body).toHaveProperty('ok', false);
 expect(String((body as { error: { message: string } }).error.message)).toBe('Forbidden.');
 expect(JSON.stringify(body)).not.toContain('publishers:read');
 expect(JSON.stringify(body)).not.toContain('scope');
 });

 it('malformed key → 401, no key metadata in response body', async () => {
 const app = await buildApp(emptyPool());
 const res = await request(app)
 .get('/api/v1/advertiser/offers')
 .set('X-Api-Key', MALFORMED_KEY);

 expect(res.status).toBe(401);
 const body = res.body;
 expect(body).toHaveProperty('ok', false);
 expect(String((body as { error: { message: string } }).error.message)).toBe('Invalid or missing API key.');
 const blob = JSON.stringify(body);
 expect(blob).not.toContain('revoked');
 expect(blob).not.toContain('audience');
 expect(blob).not.toContain('network');
 expect(blob).not.toContain('advertiser');
 });

 it('unknown key → 401, indistinguishable from malformed key', async () => {
 const app = await buildApp(emptyPool());
 const res1 = await request(app).get('/api/v1/advertiser/offers').set('X-Api-Key', MALFORMED_KEY);
 const res2 = await request(app).get('/api/v1/advertiser/offers').set('X-Api-Key', UNKNOWN_KEY_HASH);
 expect(res1.status).toBe(401);
 expect(res2.status).toBe(401);
 expect(res1.body).toEqual(res2.body);
 });

 it('valid authorized key → 200 with correct data', async () => {
 const app = await buildAppFullMock();
 const res = await request(app)
 .get('/api/v1/network/offers')
 .set('X-Api-Key', NET_KEY_HASH);
 expect(res.status).toBe(200);
 expect(res.body).toHaveProperty('ok', true);
 });

 it('401 vs 403 semantics: wrong audience → 403, no key → 401', async () => {
 const app403 = await buildApp(advertiserKeyPool());
 const res403 = await request(app403).get('/api/v1/network/offers').set('X-Api-Key', ADV_KEY_HASH);

 const app401 = await buildApp(emptyPool());
 const res401 = await request(app401).get('/api/v1/network/offers');

 expect(res403.status).toBe(403);
 expect(res401.status).toBe(401);
 });
});
