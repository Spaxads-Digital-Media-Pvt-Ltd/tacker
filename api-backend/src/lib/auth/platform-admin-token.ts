/**
 * Platform-admin JWT: sign + verify (spec §3C).
 *
 * These tokens are ISSUED BY THE BACKEND (not Supabase Auth) and verified exclusively with
 * PLATFORM_ADMIN_JWT_SECRET (HS256). This provides a hard separation from tenant Supabase JWTs:
 * a tenant JWT — even one carrying a forged kind=platform_admin claim — will fail signature
 * verification because it was not signed with this secret.
 *
 * Token claims:
 * pa_sub — platform_admins.id (the stable DB identity, not a mutable email)
 * kind — always 'platform_admin'
 * iss — 'tracker-platform-admin'
 * exp / iat — standard
 */

import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { createSession } from '../platform/staff-security.js';
import { env } from '../../config/env.js';

const SECRET = new TextEncoder().encode(env.PLATFORM_ADMIN_JWT_SECRET);

export interface PlatformAdminTokenPayload {
 pa_sub: string;
 kind: 'platform_admin';
 iss: string;
 /** The session (platform_sessions.id) — revocable server-side. */
 jti?: string;
}

function assertSecret(): void {
 if (!env.PLATFORM_ADMIN_JWT_SECRET) {
 throw new Error('PLATFORM_ADMIN_JWT_SECRET is not configured');
 }
}

/**
 * A session token: a platform_sessions row is created first (Team › Your account lists it; revoking it
 * ends the token at once) and its id is the token's jti.
 */
export async function signPlatformAdminToken(platformAdminId: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<string> {
 assertSecret();
 const sessionId = randomUUID();
 await createSession(sessionId, platformAdminId, meta);
 return signPlatformSessionToken(platformAdminId, sessionId);
}

/** The JWT for an existing session (no database work). */
export async function signPlatformSessionToken(platformAdminId: string, sessionId: string): Promise<string> {
 assertSecret();
 const jwt = new SignJWT({ pa_sub: platformAdminId, kind: 'platform_admin', iss: 'tracker-platform-admin' });
 return jwt
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
 .setJti(sessionId)
 .setExpirationTime('1h')
 .sign(SECRET);
}

export async function verifyPlatformAdminToken(token: string): Promise<PlatformAdminTokenPayload> {
 assertSecret();
 const { payload } = await jwtVerify(token, SECRET, {
 algorithms: ['HS256'],
 issuer: 'tracker-platform-admin',
 });
 const paSub = String((payload as Record<string, unknown>)['pa_sub'] ?? '');
 if (!paSub) throw new Error('Token missing pa_sub claim');
 return payload as unknown as PlatformAdminTokenPayload;
}

/**
 * The second step of a two-factor sign-in: after the right password, a 5-minute challenge that only
 * POST /platform/login/2fa accepts (its own issuer — it never works as a session token).
 */
export async function signMfaChallenge(platformAdminId: string): Promise<string> {
 assertSecret();
 return new SignJWT({ pa_sub: platformAdminId, purpose: 'mfa' })
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
 .setIssuer('tracker-platform-mfa')
 .setIssuedAt()
 .setExpirationTime('5m')
 .sign(SECRET);
}

export async function verifyMfaChallenge(token: string): Promise<string> {
 assertSecret();
 const { payload } = await jwtVerify(token, SECRET, { algorithms: ['HS256'], issuer: 'tracker-platform-mfa' });
 const id = String((payload as Record<string, unknown>)['pa_sub'] ?? '');
 if (!id || (payload as Record<string, unknown>)['purpose'] !== 'mfa') throw new Error('Not a sign-in challenge');
 return id;
}
