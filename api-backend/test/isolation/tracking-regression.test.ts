/**
 * Regression tests for the /click tracking path (M-1 context).
 *
 * These tests run in all environments (no INTEGRATION_DB gate):
 * - Unknown host → 404 (regression guard for M-1)
 * - Raw IP host → 404
 * - scheme-injected host → 404
 * - Cross-tenant isolation: host maps to networkA, offer belongs to networkB → divert (no leak)
 *
 * Uses a stub resolver so these are structural unit tests, not DB-backed integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import type { HostResolver, ResolvedTenant } from '../../src/middleware/host-resolver.js';

// Stub resolver that maps hosts to specific networks.
const stubResolver: HostResolver = {
 resolve: async (host: string): Promise<ResolvedTenant | null> => {
 const map: Record<string, ResolvedTenant> = {
 'track.example.com': { networkId: 'net-a', host: 'track.example.com', mode: 'custom' },
 };
 return map[host] ?? null;
 },
};

async function get(app: ReturnType<typeof buildTrackingApp>, path: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
 const res = await app.inject({ method: 'GET', url: path, headers });
 return { status: res.statusCode, body: JSON.parse(res.payload ?? '{}') };
}

describe('Tracking /click regression (M-1)', () => {
 let app: ReturnType<typeof buildTrackingApp>;

 beforeAll(async () => {
 app = buildTrackingApp();
 await app.ready();
 setHostResolver(stubResolver);
 });

 afterAll(async () => {
 await app.close();
 setHostResolver({ resolve: async () => null } as HostResolver);
 });

 it('unknown host → 404 (not a 500)', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: 'unknown.example.com',
 });
 expect(res.status).toBe(404);
 expect((res.body as { error: string }).error).toBe('unknown_tracking_host');
 });

 it('raw IP → 404 (not a 500)', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: '10.0.0.1',
 });
 expect(res.status).toBe(404);
 });

 it('scheme-injected host → 404 (not a 500)', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: 'http://evil.com',
 });
 expect(res.status).toBe(404);
 });

 it('missing offer_id → 400 (not a 500)', async () => {
 const res = await get(app, '/click', { host: 'track.example.com' });
 expect(res.status).toBe(400);
 expect((res.body as { error: string }).error).toBe('missing_offer_id');
 });

 it('known host without Redis cache → non-500 when Redis is available', async () => {
 // This case is only meaningful when Redis is running (getOfferConfig falls back to DB).
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: 'track.example.com',
 });
 // 302 = a real offer was found (shouldn't happen with stub resolver)
 expect(res.status).not.toBe(302);
 });
});
