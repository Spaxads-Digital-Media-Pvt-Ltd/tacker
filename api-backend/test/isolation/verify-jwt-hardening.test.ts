import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK, createRemoteJWKSet } from 'jose';
import { verifySupabaseJwt, __setJwksForTest, __resetJwksForTest } from '../../src/lib/auth/verify-jwt.js';
import { tokenWithIssuer, expiredToken } from '../../test/helpers/tokens.js';
import request from 'supertest';
import type { Express } from 'express';
import { createServer as createHttpServer } from 'http';

const EXPECTED_ISSUER = (process.env.SUPABASE_URL ?? 'https://test.supabase.co').replace(/\/+$/, '') + '/auth/v1';
const WRONG_ISSUER = 'https://evil.supabase.co/auth/v1';
const FOREIGN_ISSUER = 'https://other.supabase.co/auth/v1';

let es256PrivateKey: unknown;
let es256PublicJwk: Record<string, unknown>;
let jwksServer: ReturnType<typeof createHttpServer>;
let jwksPort: number;

async function startJwksServer(): Promise<number> {
 return new Promise((resolve, reject) => {
 jwksServer = createHttpServer((_req, res) => {
 res.writeHead(200, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ keys: [es256PublicJwk] }));
 });
 jwksServer.once('error', reject);
 jwksServer.listen(0, '127.0.0.1', () => {
 const addr = jwksServer.address();
 if (addr && typeof addr === 'object') resolve(addr.port);
 else reject(new Error('Could not get server address'));
 });
 });
}

async function signEs256(payload: Record<string, unknown>, iss?: string): Promise<string> {
 return new SignJWT(payload)
 .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
 .setIssuer(iss ?? EXPECTED_ISSUER)
 .setExpirationTime('1h')
 .sign(es256PrivateKey as any);
}

beforeAll(async () => {
 const keys = await generateKeyPair('ES256');
 es256PrivateKey = keys.privateKey;
 es256PublicJwk = await exportJWK(keys.publicKey) as unknown as Record<string, unknown>;
 es256PublicJwk.kid = 'test-key-id';
 es256PublicJwk.alg = 'ES256';
 es256PublicJwk.use = 'sig';

 jwksPort = await startJwksServer();
 const mockUrl = new URL(`http://127.0.0.1:${jwksPort}/.well-known/jwks.json`);
 __setJwksForTest(() => createRemoteJWKSet(mockUrl));
});

afterAll(async () => {
 __resetJwksForTest();
 if (jwksServer) await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

describe('AUTH-1/AUTH-2: verifySupabaseJwt hardening', () => {

 it('accepts a valid ES256 JWT from the expected issuer', async () => {
 const token = await signEs256({
 sub: 'user-1',
 network_id: 'net-1',
 kind: 'operator',
 role: 'admin',
 app_metadata: { role: 'admin' },
 });
 const payload = await verifySupabaseJwt(token);
 expect(payload.sub).toBe('user-1');
 expect(String((payload as Record<string, unknown>)['network_id'] ?? '')).toBe('net-1');
 });

 it('rejects an ES256 JWT with wrong issuer', async () => {
 const token = await signEs256({ sub: 'u1', kind: 'operator' }, WRONG_ISSUER);
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('rejects an ES256 JWT with foreign-project issuer', async () => {
 const token = await signEs256({ sub: 'u1', kind: 'operator' }, FOREIGN_ISSUER);
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('rejects an ES256 JWT with no issuer claim', async () => {
 const token = await new SignJWT({ sub: 'u1', kind: 'operator' })
 .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
 .setExpirationTime('1h')
 .sign(es256PrivateKey as any);
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('rejects an RS256-signed JWT (algorithm confusion blocked)', async () => {
 const { generateKeyPair } = await import('jose');
 const rsKeys = await generateKeyPair('RS256');
 const token = await new SignJWT({ sub: 'u1', kind: 'operator' })
 .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
 .setIssuer(EXPECTED_ISSUER)
 .setExpirationTime('1h')
 .sign(rsKeys.privateKey);
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('rejects an expired ES256 JWT', async () => {
 const expired = await new SignJWT({ sub: 'u1', kind: 'operator' })
 .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
 .setIssuer(EXPECTED_ISSUER)
 .setExpirationTime('-1h')
 .sign(es256PrivateKey as any);
 await expect(verifySupabaseJwt(expired)).rejects.toThrow();
 });

 it('rejects a malformed JWT string', async () => {
 await expect(verifySupabaseJwt('not.a.valid.jwt.token.at.all')).rejects.toThrow();
 });

 it('token from a foreign Supabase project (wrong issuer) is rejected', async () => {
 const token = await signEs256({ sub: 'u1', kind: 'operator' }, FOREIGN_ISSUER);
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('HS256 test-path preserves valid app_metadata claims (kind, role)', async () => {
 const token = tokenWithIssuer({ kind: 'operator', role: 'admin', network_id: 'net-1' });
 const payload = await verifySupabaseJwt(token);
 expect(payload.sub).toBeDefined();
 expect(String((payload as Record<string, unknown>)['network_id'] ?? '')).toBe('net-1');
 expect(String((payload as Record<string, unknown>)['kind'] ?? '')).toBe('operator');
 expect(String((payload as Record<string, unknown>)['role'] ?? '')).toBe('admin');
 });

 it('HS256 test-path preserves portal claims (advertiser kind, owner_id)', async () => {
 const { portalToken } = await import('../../test/helpers/tokens.js');
 const token = portalToken({ userId: 'u-2', networkId: 'net-2', kind: 'advertiser', ownerId: 'adv-1' });
 const payload = await verifySupabaseJwt(token);
 expect(String((payload as Record<string, unknown>)['network_id'] ?? '')).toBe('net-2');
 expect(String((payload as Record<string, unknown>)['kind'] ?? '')).toBe('advertiser');
 });

 it('HS256 test-path rejects wrong issuer', async () => {
 const token = tokenWithIssuer({ iss: WRONG_ISSUER, kind: 'operator' });
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('HS256 test-path rejects expired tokens', async () => {
 const token = expiredToken();
 await expect(verifySupabaseJwt(token)).rejects.toThrow();
 });

 it('platform-admin auth unaffected (separate module, separate secret)', async () => {
 const { signPlatformAdminToken, verifyPlatformAdminToken } =
 await import('../../src/lib/auth/platform-admin-token.js');
 const token = await signPlatformAdminToken('admin-1');
 const payload = await verifyPlatformAdminToken(token);
 expect(payload.pa_sub).toBe('admin-1');
 expect(payload.kind).toBe('platform_admin');
 });
});

describe('AUTH-1: dashboard auth end-to-end (mocked app)', () => {
 let app: Express;

 it('valid dashboard token with correct issuer passes dashboardAuth (no 401)', async () => {
 vi.resetModules();
 vi.doMock('../../src/lib/db/pool.js', () => ({
 pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }) },
 query: async () => ({ rows: [], rowCount: 0 }),
 }));
 const { buildDashboardApp } = await import('../../src/surfaces/dashboard/app.js');
 app = buildDashboardApp();
 const { SignJWT } = await import('jose');
 const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod');
 const token = await new SignJWT({
 sub: 'user-1',
 network_id: 'net-1',
 kind: 'admin',
 role: 'admin',
 app_metadata: { role: 'admin' },
 })
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
 .setIssuer(EXPECTED_ISSUER)
 .setExpirationTime('1h')
 .sign(secret);
 const res = await request(app)
 .get('/api/v1/network/offers')
 .set('Authorization', `Bearer ${token}`);
 expect(res.status).not.toBe(401);
 });

 it('wrong-issuer dashboard token yields 401', async () => {
 vi.resetModules();
 vi.doMock('../../src/lib/db/pool.js', () => ({
 pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }) },
 query: async () => ({ rows: [], rowCount: 0 }),
 }));
 const { buildDashboardApp } = await import('../../src/surfaces/dashboard/app.js');
 app = buildDashboardApp();
 const { SignJWT } = await import('jose');
 const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod');
 const wrongIssToken = await new SignJWT({
 sub: 'u1',
 network_id: 'n1',
 kind: 'admin',
 role: 'admin',
 })
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
 .setIssuer(WRONG_ISSUER)
 .setExpirationTime('1h')
 .sign(secret);
 const res = await request(app)
 .get('/api/v1/network/offers')
 .set('Authorization', `Bearer ${wrongIssToken}`);
 expect(res.status).toBe(401);
 });
});
