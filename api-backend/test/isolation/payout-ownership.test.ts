/**
 * A-2 fix: POST /payouts publisher ownership enforcement.
 *
 * Strategy: build a fresh Express app per test (vi.resetModules + vi.doMock) and exercise the
 * full handler chain end-to-end via supertest. The apiKeyAuth middleware is mocked so req.identity
 * is populated with a network-audience token.
 *
 * The publishers-table authorization check in network.ts is the A-2 fix. createPayoutRun is
 * mocked to avoid the deep ledger transaction and to verify the publisherIds forwarded.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Express, Request, Response, NextFunction } from 'express';
import type { ApiKeyIdentity } from '../../src/middleware/types.js';

// --- Tracks createPayoutRun calls across the current test ---
let capturedPayoutCalls: Array<{ publisherIds?: string[]; note?: string }> = [];

// --- Constants ---
const NET_A = 'net-a-3333-3333-3333-333333333333';
const PUB_OWNED_A1 = 'pub-a1-5555-5555-5555-555555555555';
const PUB_OWNED_A2 = 'pub-a2-6666-6666-6666-666666666666';
const PUB_FOREIGN = 'pub-fb-7777-7777-7777-777777777777'; // belongs to NET_B
const PUB_NONEXISTENT = 'pub-xx-8888-8888-8888-888888888888';
const API_KEY_HASH = 'net_live_test_abcdefghijklmnopqrstuvwxyz0123456789';

// --- Test runner ---
async function buildTestApp(
 publisherRows: { id: string }[],
 payoutResult: { batchId: string; currency: string; total: string; lines: { publisherId: string; amount: string }[] },
): Promise<Express> {
 capturedPayoutCalls = [];
 vi.resetModules();

 vi.doMock('../../src/lib/db/pool.js', () => {
 const queryFn = async (text: string, params?: unknown[]) => {
 const sql = String(text).replace(/\s+/g, ' ').trim();

 // api_keys auth lookup (from apiKeyAuth middleware)
 if (/FROM api_keys/.test(sql) && /key_hash/.test(sql)) {
 return {
 rows: [{ id: 'key-net-a', network_id: NET_A, audience: 'network', owner_id: 'net-admin-1', scopes: ['payouts:write'], rate_limit_tier: 'default' }],
 rowCount: 1,
 };
 }
 // last_used_at update
 if (/UPDATE api_keys SET last_used_at/.test(sql)) return { rows: [], rowCount: 1 };

 // Publishers authorization check (the A-2 fix in network.ts)
 if (/SELECT id FROM publishers WHERE network_id = \$1 AND id = ANY\(\$2\)/.test(sql)) {
 const callerNetworkId = params?.[0] as string;
 const requestedIds = (params?.[1] as string[]) ?? [];
 const matched = publisherRows.filter(
 (r) => callerNetworkId === NET_A && requestedIds.includes(r.id),
 );
 return { rows: matched, rowCount: matched.length };
 }

 return { rows: [], rowCount: 0 };
 };

 return {
 pool: {
 connect: async () => ({
 query: async () => ({ rows: [], rowCount: 0 }),
 release: () => {},
 }),
 query: queryFn,
 },
 query: queryFn,
 };
 });

 vi.doMock('../../src/lib/ledger/ledger.js', () => ({
 createPayoutRun: vi.fn(async (_networkId: string, opts: { publisherIds?: string[]; note?: string }) => {
 capturedPayoutCalls.push({ publisherIds: opts.publisherIds, note: opts.note });
 return payoutResult;
 }),
 }));

 // Rate limit mock
 vi.doMock('../../src/lib/apikeys/rate-limit.js', () => ({
 checkRateLimit: () => Promise.resolve({ allowed: true, limit: 600, remaining: 600 }),
 }));

 // Mock apiKeyAuth middleware — inject a network-audience identity, skip real auth.
 const identity: ApiKeyIdentity = {
 surface: 'public-api',
 audience: 'network',
 networkId: NET_A,
 ownerId: 'net-admin-1',
 keyId: 'key-net-a',
 scopes: ['payouts:write'],
 };

 vi.doMock('../../src/surfaces/public-api/auth.js', async () => {
 // importActual gives us the real module's named exports (requireScope, apiIdentity, forbidden, ...)
 const actual = await vi.importActual<object>('../../src/surfaces/public-api/auth.js');
 return {
 ...(actual as object),
 apiKeyAuth: (_req: Request, _res: Response, next: NextFunction) => {
 ;(_req as unknown as { identity: ApiKeyIdentity }).identity = identity;
 next();
 },
 };
 });

 const { buildPublicApiApp } = await import('../../src/surfaces/public-api/app.js');
 return buildPublicApiApp();
}

async function runTest(
 publisherRows: { id: string }[],
 publisherIds: string[] | undefined,
 expectedStatus: number,
 payoutResult: { batchId: string; currency: string; total: string; lines: { publisherId: string; amount: string }[] },
 note?: string,
): Promise<void> {
 const app = await buildTestApp(publisherRows, payoutResult);

 const res = await request(app)
 .post('/api/v1/network/payouts')
 .set('X-Api-Key', API_KEY_HASH)
 .send({ ...(publisherIds ? { publisherIds } : {}), ...(note ? { note } : {}) });

 expect(res.status).toBe(expectedStatus);
}

// =====================================================================
describe('A-2: POST /payouts — publisher ownership enforcement', () => {
 const payoutResult = {
 batchId: 'batch-ok',
 currency: 'USD',
 total: '50.0000',
 lines: [{ publisherId: PUB_OWNED_A1, amount: '25.0000' }],
 };

 it('accepts 201 when all publisherIds belong to the authenticated network', async () => {
 await runTest(
 [{ id: PUB_OWNED_A1 }, { id: PUB_OWNED_A2 }],
 [PUB_OWNED_A1, PUB_OWNED_A2],
 201,
 payoutResult,
 );
 expect(capturedPayoutCalls).toHaveLength(1);
 expect(capturedPayoutCalls[0].publisherIds).toEqual([PUB_OWNED_A1, PUB_OWNED_A2]);
 });

 it('rejects 403 when a foreign publisherId is in the array', async () => {
 await runTest(
 [{ id: PUB_OWNED_A1 }],
 [PUB_OWNED_A1, PUB_FOREIGN],
 403,
 payoutResult,
 );
 expect(capturedPayoutCalls).toHaveLength(0); // createPayoutRun must not be called
 });

 it('rejects 403 when publisherIds are mixed (own + foreign)', async () => {
 await runTest(
 [{ id: PUB_OWNED_A1 }],
 [PUB_OWNED_A1, PUB_FOREIGN, PUB_OWNED_A2],
 403,
 payoutResult,
 );
 expect(capturedPayoutCalls).toHaveLength(0);
 });

 it('rejects 403 when a nonexistent publisherId is in the array', async () => {
 await runTest(
 [{ id: PUB_OWNED_A1 }],
 [PUB_OWNED_A1, PUB_NONEXISTENT],
 403,
 payoutResult,
 );
 expect(capturedPayoutCalls).toHaveLength(0);
 });

 it('accepts 201 when no publisherIds are provided (full network payout)', async () => {
 await runTest(
 [{ id: PUB_OWNED_A1 }],
 undefined,
 201,
 payoutResult,
 );
 expect(capturedPayoutCalls).toHaveLength(1);
 expect(capturedPayoutCalls[0].publisherIds).toBeUndefined();
 });
});
