/**
 * A-1 fix: POST /advertiser/conversions click-ownership enforcement.
 *
 * Strategy: mock recordConversion() (the deep sink) and verify the handler's
 * ownership check decides correctly BEFORE it is reached. The A-1 fix is entirely
 * in advertiser.ts lines 76-105 (before recordConversion is invoked).
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// --- Constants ---
const ADV_A = 'adv-a-1111-1111-1111-111111111111';
const ADV_B = 'adv-b-2222-2222-2222-222222222222';
const NET_A = 'net-a-3333-3333-3333-333333333333';
const API_KEY_HASH = 'adv_live_test_abcdefghijklmnopqrstuvwxyz0123456789';

// --- Test runner ---
async function buildTestApp(
	storedClick: unknown,
	pgOwnershipResult: { advertiser_id: string | null } | null, // null = no row
	offerAdvertiserId: string | null, // for Redis fallback path
	recordConversionOutcome: string,
): Promise<Express> {
	vi.resetModules();

	// Pool mock: only handles the ownership JOIN query (the one relevant to A-1).
	const queryFn = vi.fn(async (text: string) => {
		const sql = text.replace(/\s+/g, ' ').trim();

		// The ownership JOIN query in advertiser.ts
		if (/FROM clicks c JOIN offers o ON o\.id = c\.offer_id/.test(sql)) {
			if (!pgOwnershipResult) return { rows: [], rowCount: 0 };
			return { rows: [pgOwnershipResult], rowCount: 1 };
		}

		// Redis fallback offer lookup: SELECT advertiser_id FROM offers WHERE id = $1 AND network_id = $2
		if (/SELECT advertiser_id FROM offers WHERE id = \$1 AND network_id = \$2/.test(sql)) {
			if (offerAdvertiserId) return { rows: [{ advertiser_id: offerAdvertiserId }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		}

		return { rows: [], rowCount: 0 };
	});

	// Auth mock: api_keys lookup
	const authKeyResp = { rows: [{ id: 'key-1', network_id: NET_A, audience: 'advertiser', owner_id: ADV_A, scopes: ['conversions:write'], rate_limit_tier: 'default' }], rowCount: 1 };

	vi.doMock('../../src/lib/db/pool.js', () => ({
		pool: {
			connect: async () => ({
				query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
				release: vi.fn(),
			}),
			query: vi.fn(async (text: string) => {
				const sql = text.replace(/\s+/g, ' ').trim();
				if (/FROM api_keys/.test(sql) && /key_hash/.test(sql)) return authKeyResp;
				if (/UPDATE api_keys SET last_used_at/.test(sql)) return { rows: [], rowCount: 1 };
				return queryFn(text);
			}),
		},
		query: vi.fn(async (text: string) => {
			const sql = text.replace(/\s+/g, ' ').trim();
			if (/FROM api_keys/.test(sql) && /key_hash/.test(sql)) return authKeyResp;
			if (/UPDATE api_keys SET last_used_at/.test(sql)) return { rows: [], rowCount: 1 };
			return queryFn(text);
		}),
	}));

	// Mock recordConversion to avoid the deep internal call chain.
	vi.doMock('../../src/surfaces/tracking/conversions/record.js', () => ({
		recordConversion: vi.fn(async () => ({ outcome: recordConversionOutcome, conversionId: 'cv-ok' })),
	}));

	// Click store mock
	vi.doMock('../../src/surfaces/tracking/click-store.js', () => ({
		getStoredClick: () => Promise.resolve(storedClick),
	}));

	// Rate limit mock
	vi.doMock('../../src/lib/apikeys/rate-limit.js', () => ({
		checkRateLimit: () => Promise.resolve({ allowed: true, limit: 600, remaining: 600 }),
	}));

	// Redis mock
	vi.doMock('../../src/lib/redis.js', () => ({
		getRedis: () => ({
			incr: vi.fn(async () => 1),
			expire: vi.fn(async () => true),
			set: vi.fn(async () => 'OK'),
			get: vi.fn(async () => null),
			del: vi.fn(async () => undefined),
		}),
		pool: { connect: async () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() }) },
	}));

	const { buildPublicApiApp } = await import('../../src/surfaces/public-api/app.js');
	return buildPublicApiApp();
}

async function runTest(
	storedClick: unknown,
	pgOwnershipResult: { advertiser_id: string | null } | null,
	offerAdvertiserId: string | null,
	expectedStatus: number,
	recordConversionOutcome = 'approved',
	clickId = 'click-test',
): Promise<void> {
	const app = await buildTestApp(storedClick, pgOwnershipResult, offerAdvertiserId, recordConversionOutcome);
	const res = await request(app)
		.post('/api/v1/advertiser/conversions')
		.set('X-Api-Key', API_KEY_HASH)
		.send({ click_id: clickId, txn_id: 'txn-test-1' });
	expect(res.status).toBe(expectedStatus);
}

// =====================================================================
describe('A-1: POST /advertiser/conversions — click ownership', () => {
	// 1. Click in Postgres, owned by this advertiser → 201
	it('accepts when click is in Postgres and belongs to this advertiser', async () => {
		await runTest(null, { advertiser_id: ADV_A }, null, 201);
	});

	// 2. Click missing from both Postgres and Redis → 403 (THE A-1 FIX)
	it('rejects 403 when click is absent from both Postgres and Redis click-store', async () => {
		await runTest(null, null, null, 403);
	});

	// 3. Click in Postgres, different advertiser → 403
	it('rejects when click in Postgres belongs to a different advertiser', async () => {
		await runTest(null, { advertiser_id: ADV_B }, null, 403);
	});

	// 4. Click in Redis (not in Postgres yet), offer belongs to this advertiser → 201
	it('accepts when click is in Redis click-store and the offer belongs to this advertiser', async () => {
		await runTest({ offer_id: 'offer-1' }, null, ADV_A, 201);
	});

	// 5. Click in Redis, offer belongs to different advertiser → 403
	it('rejects when Redis click-store offer belongs to a different advertiser', async () => {
		await runTest({ offer_id: 'offer-1' }, null, ADV_B, 403);
	});

	// 6. Click in Redis, offer not found in this network → 403
	it('rejects when the Redis click-store offer does not exist in this network', async () => {
		await runTest({ offer_id: 'offer-1' }, null, null, 403);
	});

	// 7. Missing click_id → 400 (unaffected by A-1 fix)
	it('returns 400 when click_id is absent from the request body', async () => {
		const app = await buildTestApp(null, { advertiser_id: ADV_A }, null, 'approved');
		const res = await request(app)
			.post('/api/v1/advertiser/conversions')
			.set('X-Api-Key', API_KEY_HASH)
			.send({ txn_id: 'txn-test-1' });
		expect(res.status).toBe(400);
	});
});
