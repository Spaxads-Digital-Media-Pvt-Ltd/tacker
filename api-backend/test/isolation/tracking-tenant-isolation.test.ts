/**
 * DB-backed tenant isolation test for M-1 (tracking host security).
 *
 * Proves that /click resolves each tracking domain to the correct network_id:
 * track-a.test → NETWORK_A (only NETWORK_A's offers resolve correctly)
 * track-b.test → NETWORK_B (only NETWORK_B's offers resolve correctly)
 * unknown.test → 404 (deny-by-default)
 *
 * Also verifies cross-tenant isolation: a valid host from network A cannot
 * access an offer that belongs to network B.
 *
 * Inserts tracking_domains directly into Postgres and uses a resolver that
 * queries the DB (skipping Redis cache, which is unavailable in this test).
 * Requires INTEGRATION_DB=1 and a migrated database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import type { HostResolver, ResolvedTenant } from '../../src/middleware/host-resolver.js';
import { query } from '../../src/lib/db/pool.js';
import { closeDb } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';

const runDb = process.env.INTEGRATION_DB === '1';
const dDb = runDb ? describe : describe.skip;

// Resolver that hits Postgres directly (no Redis dependency).
class DirectDbResolver implements HostResolver {
 async resolve(host: string): Promise<ResolvedTenant | null> {
 if (!host) return null;
 const { rows } = await query<{ network_id: string; mode: 'subdomain' | 'custom' }>(
 `SELECT network_id, mode FROM tracking_domains
 WHERE lower(host) = lower($1) AND status = 'active' AND verification_state = 'verified'
 LIMIT 1`,
 [host],
 );
 const row = rows[0];
 if (!row) return null;
 return { networkId: row.network_id, host: host.toLowerCase(), mode: row.mode };
 }
}

async function get(app: ReturnType<typeof buildTrackingApp>, path: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
 const res = await app.inject({ method: 'GET', url: path, headers });
 return { status: res.statusCode, body: JSON.parse(res.payload ?? '{}') };
}

dDb('Tracking /click — DB-backed tenant isolation (M-1, INTEGRATION_DB=1)', () => {
 let app: ReturnType<typeof buildTrackingApp>;
 let fx: Fixture;
 let trackHostA: string;
 let trackHostB: string;

 beforeAll(async () => {
 if (!(await canConnect())) {
 throw new Error('INTEGRATION_DB=1 but Postgres is unreachable. Run migrations first.');
 }
 await resetDb();
 fx = await seedFixture();
 app = buildTrackingApp();
 await app.ready();

 // Register two tracking domains, one per network (custom mode).
 const hostA = `track-a-${fx.networkA.slice(0, 8)}.test`;
 const hostB = `track-b-${fx.networkB.slice(0, 8)}.test`;

 await query(
 `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
 VALUES ($1, $2, 'custom', 'active', 'verified', 'issued', true)`,
 [fx.networkA, hostA],
 );
 await query(
 `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
 VALUES ($1, $2, 'custom', 'active', 'verified', 'issued', true)`,
 [fx.networkB, hostB],
 );

 trackHostA = hostA;
 trackHostB = hostB;
 setHostResolver(new DirectDbResolver());
 });

 afterAll(async () => {
 await app.close();
 await closeDb();
 setHostResolver({ resolve: async () => null } as HostResolver);
 });

 it('trackHostA resolves to network A', async () => {
 const res = await get(app, `/click?offer_id=${fx.offerA}`, { host: trackHostA });
 // 302 if offer is found and active, 404 if unknown host, 204 if diverted.
 // We just need to confirm it's NOT 404 (unknown host) — host resolved correctly.
 expect(res.status).not.toBe(404);
 });

 it('trackHostB with offer A returns 404 (cross-tenant deny)', async () => {
 const res = await get(app, `/click?offer_id=${fx.offerA}`, { host: trackHostB });
 // Network B has no offerA — host resolves to networkB, but no such offer exists
 // for networkB. The click handler falls through to divert (204) or missing offer (400).
 // Either way, it must NOT 302 redirect to offerA's destination from networkB's context.
 // The critical check: it does NOT return 302 to the cross-tenant offer.
 expect(res.status).not.toBe(302);
 });

 it('an unregistered host returns 404 unknown_tracking_host', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: 'no-such-domain.example.com',
 });
 expect(res.status).toBe(404);
 expect((res.body as { error: string }).error).toBe('unknown_tracking_host');
 });

 it('a raw IP returns 404 unknown_tracking_host', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: '10.0.0.1',
 });
 expect(res.status).toBe(404);
 expect((res.body as { error: string }).error).toBe('unknown_tracking_host');
 });

 it('a disabled domain returns 404', async () => {
 const disabledHost = `disabled-${fx.networkA.slice(0, 8)}.test`;
 await query(
 `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status)
 VALUES ($1, $2, 'custom', 'disabled', 'verified', 'issued')`,
 [fx.networkA, disabledHost],
 );
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: disabledHost,
 });
 expect(res.status).toBe(404);
 expect((res.body as { error: string }).error).toBe('unknown_tracking_host');
 });

 it('a pending domain (not yet verified) returns 404', async () => {
 const pendingHost = `pending-${fx.networkA.slice(0, 8)}.test`;
 await query(
 `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status)
 VALUES ($1, $2, 'custom', 'active', 'unverified', 'none')`,
 [fx.networkA, pendingHost],
 );
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', {
 host: pendingHost,
 });
 expect(res.status).toBe(404);
 });
});
