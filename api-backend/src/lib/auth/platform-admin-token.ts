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

import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.js';

const SECRET = new TextEncoder().encode(env.PLATFORM_ADMIN_JWT_SECRET);

export interface PlatformAdminTokenPayload {
 pa_sub: string;
 kind: 'platform_admin';
 iss: string;
}

function assertSecret(): void {
 if (!env.PLATFORM_ADMIN_JWT_SECRET) {
 throw new Error('PLATFORM_ADMIN_JWT_SECRET is not configured');
 }
}

export async function signPlatformAdminToken(platformAdminId: string): Promise<string> {
 assertSecret();
 const jwt = new SignJWT({ pa_sub: platformAdminId, kind: 'platform_admin', iss: 'tracker-platform-admin' });
 return jwt
 .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
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
