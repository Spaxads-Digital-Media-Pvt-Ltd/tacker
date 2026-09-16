/**
 * Supabase JWT verification (spec §2 identity). Supabase projects issue EITHER:
 * - asymmetric tokens (ES256/RS256) verified against the project JWKS, OR
 * - legacy symmetric tokens (HS256) verified with the shared JWT secret.
 *
 * AUTH-1/AUTH-2 hardened: asymmetric verification pins the expected issuer
 * (`<SUPABASE_URL>/auth/v1`) and restricts algorithms to ES256 only. The legacy
 * HS256 path also validates the issuer. Platform-admin JWTs use a separate module.
 *
 * This project uses ES256 (JWKS). We branch on the token's `alg` header so both work — real
 * Supabase tokens verify via JWKS, and HS256 tokens (used by the test suite, signed with
 * SUPABASE_JWT_SECRET) verify with the shared secret. Verification is async.
 */
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, type JWTPayload } from 'jose';
import { env } from '../../config/env.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function __setJwksForTest(fn: () => ReturnType<typeof createRemoteJWKSet>): void {
 jwks = fn() as ReturnType<typeof createRemoteJWKSet>;
}

export function __resetJwksForTest(): void {
 jwks = null;
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
 if (!jwks) {
 if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL required for JWKS verification');
 // jose caches keys and refreshes on unknown `kid` (e.g. after key rotation).
 jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
 }
 return jwks;
}

function getExpectedIssuer(): string {
 if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL required for issuer validation');
 return `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
}

export async function verifySupabaseJwt(token: string): Promise<JWTPayload> {
 const { alg } = decodeProtectedHeader(token);
 if (alg && alg.startsWith('HS')) {
 if (!env.SUPABASE_JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET required for HS256 tokens');
 const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), {
 issuer: getExpectedIssuer(),
 algorithms: ['HS256'],
 });
 return payload;
 }
 // Asymmetric (ES256/RS256) — verify against the project JWKS with algorithm pinning.
 const { payload } = await jwtVerify(token, getJwks(), {
 issuer: getExpectedIssuer(),
 algorithms: ['ES256'],
 });
 return payload;
}
