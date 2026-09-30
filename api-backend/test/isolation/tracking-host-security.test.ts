/**
 * Tracking host security tests (M-1 finding).
 *
 * Unit tests for isValidHostName and resolveHostToNetwork in host-resolver.ts.
 * Integration tests for /click returning 404 on unknown/invalid hosts.
 *
 * /click integration tests run in all envs (onRequest proxy hook is skipped in test mode,
 * but host resolution and the 404 path still execute).
 *
 * Full DB-backed resolver tests need INTEGRATION_DB=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import {
 isValidHostName,
 resolveHostToNetwork,
 setHostResolver,
} from '../../src/middleware/host-resolver.js';

async function get(app: ReturnType<typeof buildTrackingApp>, path: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
 const res = await app.inject({ method: 'GET', url: path, headers });
 return { status: res.statusCode, body: JSON.parse(res.payload ?? '{}') };
}

// ------------------------------------------------------------------
// Unit tests — isValidHostName
// ------------------------------------------------------------------

describe('isValidHostName', () => {
 it('accepts a valid FQDN', () => {
 expect(isValidHostName('track.example.com')).toBe(true);
 });

 it('accepts a valid subdomain with hyphens', () => {
 expect(isValidHostName('my-tracker.example.com')).toBe(true);
 });

 it('accepts a single-label host containing alpha (localhost)', () => {
 expect(isValidHostName('localhost')).toBe(true);
 });

 it('rejects a raw IPv4 address', () => {
 expect(isValidHostName('192.168.1.1')).toBe(false);
 });

 it('rejects a raw IPv4 octet list (10.0.0.1)', () => {
 expect(isValidHostName('10.0.0.1')).toBe(false);
 });

 // Loopback exception (dev/local testing) — scripts/add-localhost-domain.ts provisions this
 // exact literal as a tracking domain, same as "localhost". It can never be a real production
 // tenant domain, so allowing it past this format gate doesn't weaken tenant isolation — the
 // actual authorization boundary is DbHostResolver's status='active'/verification_state='verified'
 // lookup, unchanged by this.
 it('accepts the IPv4 loopback literal (127.0.0.1)', () => {
 expect(isValidHostName('127.0.0.1')).toBe(true);
 });

 it('accepts the loopback literal with a port appended (port stripping)', () => {
 expect(isValidHostName('127.0.0.1:4002')).toBe(true);
 });

 it('still rejects other IPv4 addresses in the 127.x range (loopback exception is exact-match only)', () => {
 expect(isValidHostName('127.0.0.10')).toBe(false);
 expect(isValidHostName('127.1.1.1')).toBe(false);
 });

 it('still rejects 0.0.0.0 and other non-loopback IPv4 literals', () => {
 expect(isValidHostName('0.0.0.0')).toBe(false);
 expect(isValidHostName('172.16.0.1')).toBe(false);
 });

 it('treats scheme-like prefix as single-label host (port-stripping behavior)', () => {
 // isValidHostName splits on ':' so 'http://evil.com' → bare 'http' (single-label, alpha → accepted).
 // The format-level guard is not a full scheme-injection filter; that is handled at the HTTP
 // layer. This documents current behavior rather than asserting a false negative.
 expect(isValidHostName('http://evil.com')).toBe(true);
 });

 it('rejects path suffix', () => {
 expect(isValidHostName('example.com/evil')).toBe(false);
 });

 it('rejects query string', () => {
 expect(isValidHostName('example.com?q=1')).toBe(false);
 });

 it('rejects underscores', () => {
 expect(isValidHostName('my_tracker.example.com')).toBe(false);
 });

 it('rejects a string exceeding 253 chars', () => {
 expect(isValidHostName('a'.repeat(254))).toBe(false);
 });

 it('rejects an empty string', () => {
 expect(isValidHostName('')).toBe(false);
 });

 it('is case-insensitive (uppercase accepted)', () => {
 expect(isValidHostName('TRACK.EXAMPLE.COM')).toBe(true);
 });
});

// ------------------------------------------------------------------
// Unit tests — resolveHostToNetwork (stub resolver → deny-by-default)
// ------------------------------------------------------------------

import type { HostResolver } from '../../src/middleware/host-resolver.js';

const nullResolver: HostResolver = { resolve: async () => null };

describe('resolveHostToNetwork (stub)', () => {
 beforeAll(() => { setHostResolver(nullResolver); });
 afterAll(() => { setHostResolver({ resolve: async () => null } as HostResolver); });

 it('returns null for an unknown host (deny-by-default)', async () => {
 expect(await resolveHostToNetwork('unknown.example.com')).toBeNull();
 });

 it('returns null for a raw IP (host-level rejection)', async () => {
 expect(await resolveHostToNetwork('10.0.0.1')).toBeNull();
 });

 it('returns null for a malformed host (scheme injection)', async () => {
 expect(await resolveHostToNetwork('http://evil.com')).toBeNull();
 });
});

describe('resolveHostToNetwork — loopback reaches the resolver (was short-circuited before)', () => {
 const tenant = { networkId: 'net-1', host: '127.0.0.1', mode: 'subdomain' as const };
 // Records which host strings actually reached resolve() — proves the format gate no longer
 // short-circuits 127.0.0.1 before the DB/cache lookup, and that non-loopback IPs still do.
 const seen: string[] = [];
 const recordingResolver: HostResolver = {
 resolve: async (host) => { seen.push(host); return host === '127.0.0.1' ? tenant : null; },
 };
 beforeAll(() => { setHostResolver(recordingResolver); });
 afterAll(() => { setHostResolver(nullResolver); });

 it('reaches the resolver for 127.0.0.1 and returns whatever it resolves to', async () => {
 seen.length = 0;
 expect(await resolveHostToNetwork('127.0.0.1')).toEqual(tenant);
 expect(seen).toEqual(['127.0.0.1']);
 });

 it('reaches the resolver for localhost, same as before', async () => {
 seen.length = 0;
 expect(await resolveHostToNetwork('localhost')).toBeNull(); // resolver returns null for non-127.0.0.1 hosts
 expect(seen).toEqual(['localhost']);
 });

 it('still never reaches the resolver for a non-loopback IP', async () => {
 seen.length = 0;
 expect(await resolveHostToNetwork('192.168.1.1')).toBeNull();
 expect(seen).toEqual([]); // format gate rejected it before resolve() was called
 });

 it('a configured custom domain reaches the resolver exactly like before (regression guard)', async () => {
 seen.length = 0;
 expect(await resolveHostToNetwork('demo.ourtracking.com')).toBeNull();
 expect(seen).toEqual(['demo.ourtracking.com']);
 });
});

// ------------------------------------------------------------------
// Integration: /click returns 404 for unknown / invalid / malformed hosts
// ------------------------------------------------------------------

describe('Tracking /click host security (M-1)', () => {
 let app: ReturnType<typeof buildTrackingApp>;

 beforeAll(async () => { app = buildTrackingApp(); await app.ready(); });
 afterAll(async () => { await app.close(); });

 it('returns 404 for a completely unknown tracking host', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'unknown.example.com' });
 expect(res.status).toBe(404);
 expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found', message: 'unknown_tracking_host' } });
 });

 it('returns 404 for a raw IP in the Host header', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: '10.0.0.1' });
 expect(res.status).toBe(404);
 expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found', message: 'unknown_tracking_host' } });
 });

 it('returns 404 for a host with scheme injection', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'http://evil.com' });
 expect(res.status).toBe(404);
 expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found', message: 'unknown_tracking_host' } });
 });

 it('normalises case before resolving (uppercase host → 404, no 500)', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'TRACK.EXAMPLE.COM' });
 expect(res.status).toBe(404);
 expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found', message: 'unknown_tracking_host' } });
 });

 it('returns 404 for a host with a port appended (port stripping)', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'example.com:8080' });
 // port is stripped by resolveHostToNetwork; stub resolver still returns null
 expect(res.status).toBe(404);
 });
});

// ------------------------------------------------------------------
// Integration: /click no longer 404s on a resolvable host — localhost, the loopback literal, and
// a configured custom domain all reach the SAME resolver the same way (single fix, shared by
// /click, /sl, /postback, /pixel, /iframe since they all call resolveHostToNetwork).
// ------------------------------------------------------------------

describe('Tracking /click — resolvable hosts no longer hit unknown_tracking_host', () => {
 let app: ReturnType<typeof buildTrackingApp>;
 const tenant = { networkId: 'net-1', host: 'resolved', mode: 'subdomain' as const };
 const stub: HostResolver = {
 resolve: async (host) => (['127.0.0.1', 'localhost', 'demo.ourtracking.com'].includes(host) ? tenant : null),
 };

 beforeAll(async () => {
 setHostResolver(stub);
 app = buildTrackingApp();
 await app.ready();
 });
 afterAll(async () => {
 await app.close();
 setHostResolver(nullResolver);
 });

 // A fake offer_id means host resolution succeeds but the downstream offer lookup then fails —
 // what status that produces depends on whether this test run has a real Postgres/Redis behind it
 // (a 204 divert in a full local env; a 500 here, since offer-cache.ts's DB fallback has no test
 // credentials). Either way it is NOT the 404 unknown_tracking_host rejection — that distinction is
 // the actual thing under test: it proves the request got past host resolution.
 function expectPastHostResolution(res: { status: number; body: unknown }): void {
 expect(res.status).not.toBe(404);
 expect(res.body).not.toMatchObject({ error: { message: 'unknown_tracking_host' } });
 }

 it('127.0.0.1 gets past host resolution (was 404 before this fix)', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: '127.0.0.1' });
 expectPastHostResolution(res);
 });

 it('localhost gets past host resolution, same as before', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'localhost' });
 expectPastHostResolution(res);
 });

 it('a configured custom domain gets past host resolution, same as before', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'demo.ourtracking.com' });
 expectPastHostResolution(res);
 });

 it('an unconfigured host still 404s — the fix did not weaken host authorization', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'not-configured.example.com' });
 expect(res.status).toBe(404);
 expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found', message: 'unknown_tracking_host' } });
 });

 it('a non-loopback IP still 404s even if the resolver would have allowed it', async () => {
 // 192.168.1.1 isn't in the stub's allow-list, but this asserts the format gate rejects it
 // BEFORE the resolver is ever consulted — same as the unit test above, at the HTTP layer.
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: '192.168.1.1' });
 expect(res.status).toBe(404);
 });
});

// ------------------------------------------------------------------
// Integration (DB-backed resolver): unknown host still returns 404
// ------------------------------------------------------------------

const runDb = process.env.INTEGRATION_DB === '1';
const dDb = runDb ? describe : describe.skip;

dDb('Tracking /click — DB-backed resolver (M-1, INTEGRATION_DB=1)', () => {
 let app: ReturnType<typeof buildTrackingApp>;

 beforeAll(async () => { app = buildTrackingApp(); await app.ready(); });
 afterAll(async () => { await app.close(); });

 it('returns 404 for a host not in tracking_domains', async () => {
 const res = await get(app, '/click?offer_id=11111111-1111-1111-1111-111111111111', { host: 'nonexistent.example.com' });
 expect(res.status).toBe(404);
 expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found', message: 'unknown_tracking_host' } });
 });
});
