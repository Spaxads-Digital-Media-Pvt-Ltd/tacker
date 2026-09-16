/** Mint dashboard JWTs the way Supabase Auth would, signed with SUPABASE_JWT_SECRET, for tests.
 *
 * AUTH-1 hardened: includes `iss` claim matching SUPABASE_URL/auth/v1 so issuer validation
 * in verifySupabaseJwt accepts these tokens.
 */
import jwt from 'jsonwebtoken';

const secret = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod';
const supabaseUrl = process.env.SUPABASE_URL ?? 'https://test.supabase.co';
const expectedIssuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;

function baseClaims(extra: Record<string, unknown>): Record<string, unknown> {
 return {
 iss: expectedIssuer,
 aud: 'authenticated',
 sub: 'user-test-0000-0000-0000-000000000000',
 ...extra,
 };
}

export function operatorToken(opts: { userId: string; networkId: string; role?: string }): string {
 return jwt.sign(
 baseClaims({ sub: opts.userId, network_id: opts.networkId, kind: 'admin', role: opts.role ?? 'admin' }),
 secret,
 { expiresIn: '1h' },
 );
}

export function portalToken(opts: {
 userId: string;
 networkId: string;
 kind: 'publisher' | 'advertiser';
 ownerId: string;
}): string {
 return jwt.sign(
 baseClaims({ sub: opts.userId, network_id: opts.networkId, kind: opts.kind, owner_id: opts.ownerId }),
 secret,
 { expiresIn: '1h' },
 );
}

export function tokenWithIssuer(opts: { iss?: string; sub?: string } & Record<string, unknown>): string {
 const payload: Record<string, unknown> = { ...baseClaims({}), ...opts };
 if (opts.iss !== undefined) payload.iss = opts.iss;
 if (opts.sub !== undefined) payload.sub = opts.sub;
 return jwt.sign(payload, secret, { expiresIn: '1h' });
}

export function expiredToken(): string {
 return jwt.sign(
 { iss: expectedIssuer, aud: 'authenticated', sub: 'user-test', network_id: 'n1', kind: 'operator' },
 secret,
 { expiresIn: '-1h' },
 );
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
