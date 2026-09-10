/**
 * Platform-admin JWT token unit tests (A-1 finding) — runs in ALL environments, no DB needed.
 */
import { describe, it, expect } from 'vitest';
import { signPlatformAdminToken, verifyPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword, verifyPassword } from '../../src/lib/auth/platform-admin-password.js';
import jwt from 'jsonwebtoken';

describe('Platform-admin token (A-1) — unit', () => {
 it('round-trips: sign then verify returns pa_sub and kind=platform_admin', async () => {
 const token = await signPlatformAdminToken('admin-123');
 const payload = await verifyPlatformAdminToken(token);
 expect(payload.pa_sub).toBe('admin-123');
 expect(payload.kind).toBe('platform_admin');
 });

 it('rejects a tenant Supabase JWT even with forged kind=platform_admin claim', async () => {
 const secret = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod';
 const tenantToken = jwt.sign(
 { sub: 'u1', network_id: 'n1', kind: 'platform_admin', role: 'admin' },
 secret,
 { expiresIn: '1h' },
 );
 await expect(verifyPlatformAdminToken(tenantToken)).rejects.toThrow();
 });

 it('rejects an expired token', async () => {
 const expiredToken = jwt.sign(
 { pa_sub: 'admin-1', kind: 'platform_admin', iss: 'tracker-platform-admin' },
 process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret',
 { expiresIn: -1 },
 );
 await expect(verifyPlatformAdminToken(expiredToken)).rejects.toThrow();
 });

 it('rejects a token missing pa_sub', async () => {
 const { SignJWT } = await import('jose');
 const noSubToken = await new SignJWT({ kind: 'platform_admin', iss: 'tracker-platform-admin' })
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
 .setExpirationTime('1h')
 .sign(new TextEncoder().encode(process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret'));
 await expect(verifyPlatformAdminToken(noSubToken)).rejects.toThrow('pa_sub');
 });

 it('rejects a token with wrong issuer', async () => {
 const { SignJWT } = await import('jose');
 const wrongIssToken = await new SignJWT({ pa_sub: 'admin-1', kind: 'platform_admin', iss: 'wrong-issuer' })
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
 .setExpirationTime('1h')
 .sign(new TextEncoder().encode(process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret'));
 await expect(verifyPlatformAdminToken(wrongIssToken)).rejects.toThrow();
 });
});

describe('Platform-admin password (scrypt)', () => {
 it('verifyPassword accepts the correct password', async () => {
 const hash = await hashPassword('correct-horse-battery-staple');
 expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
 });

 it('verifyPassword rejects a wrong password', async () => {
 const hash = await hashPassword('correct-horse-battery-staple');
 expect(await verifyPassword('wrong-password', hash)).toBe(false);
 });

 it('verifyPassword returns false for a malformed stored hash', async () => {
 expect(await verifyPassword('anything', 'not-a-real-hash')).toBe(false);
 });
});
