/**
 * Impersonation sessions (audit F-10). An admin who impersonates a partner/advertiser gets a
 * dedicated SHORT-LIVED token — never the account's own credentials (the old Supabase magic link
 * was a reusable login) — signed with IMPERSONATION_JWT_SECRET (HS256, issuer
 * 'tracker-impersonation'). dashboardAuth accepts it as that account's portal identity, flagged with
 * the admin who started it (`impersonatedBy`): every write is audited to that admin, and credential
 * changes (password, email, anonymize, API keys) are refused while impersonating.
 *
 * Claims: sub (the account's login, else the account id), kind (publisher|advertiser), network_id,
 * owner_id, impersonated_by (the admin's user id), imp_exp (= exp), iss, aud, iat, exp, jti.
 */
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import { env } from '../../config/env.js';

export const IMPERSONATION_ISSUER = 'tracker-impersonation';
const AUDIENCE = 'tracker-dashboard';
/** How long an impersonation session lasts. */
export const IMPERSONATION_TTL_S = 30 * 60;

export interface ImpersonationSession {
  kind: 'publisher' | 'advertiser';
  networkId: string;
  ownerId: string;
  userId: string;
  impersonatedBy: string;
  /** Unix seconds. */
  expiresAt: number;
  jti: string;
}

export const impersonationConfigured = (): boolean => Boolean(env.IMPERSONATION_JWT_SECRET);

function secret(): Uint8Array {
  if (!env.IMPERSONATION_JWT_SECRET) throw new Error('IMPERSONATION_JWT_SECRET is not configured');
  return new TextEncoder().encode(env.IMPERSONATION_JWT_SECRET);
}

/** Cheap pre-check (no verification) so dashboardAuth can route the token to the right verifier. */
export function isImpersonationToken(token: string): boolean {
  try {
    return decodeJwt(token).iss === IMPERSONATION_ISSUER;
  } catch {
    return false;
  }
}

export async function signImpersonationToken(
  s: Omit<ImpersonationSession, 'expiresAt' | 'jti'>, ttlSeconds = IMPERSONATION_TTL_S,
): Promise<{ token: string; expiresAt: number; jti: string }> {
  const jti = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await new SignJWT({
    kind: s.kind, network_id: s.networkId, owner_id: s.ownerId, impersonated_by: s.impersonatedBy, imp_exp: expiresAt,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(s.userId)
    .setIssuer(IMPERSONATION_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(secret());
  return { token, expiresAt, jti };
}

/**
 * A Super Admin support session: the platform admin acts as an admin OF one network's dashboard, for
 * IMPERSONATION_TTL_S. Same secret, issuer and audience as a portal impersonation; claims kind 'admin',
 * role 'admin', support 'platform', network_id, impersonated_by = sub = the platform admin's id.
 */
export interface SupportSession {
  kind: 'admin';
  networkId: string;
  /** The platform admin's id (also `impersonatedBy`). */
  platformAdminId: string;
  /** Unix seconds. */
  expiresAt: number;
  jti: string;
}

export async function signSupportSessionToken(
  s: { networkId: string; platformAdminId: string }, ttlSeconds = IMPERSONATION_TTL_S,
): Promise<{ token: string; expiresAt: number; jti: string }> {
  const jti = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await new SignJWT({
    kind: 'admin', role: 'admin', support: 'platform', network_id: s.networkId, impersonated_by: s.platformAdminId, imp_exp: expiresAt,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(s.platformAdminId)
    .setIssuer(IMPERSONATION_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(secret());
  return { token, expiresAt, jti };
}

/** Verify signature, issuer, audience and expiry; throws on anything else. */
export async function verifyImpersonationToken(token: string): Promise<ImpersonationSession | SupportSession> {
  const { payload: p } = await jwtVerify(token, secret(), { algorithms: ['HS256'], issuer: IMPERSONATION_ISSUER, audience: AUDIENCE });
  const kind = p['kind'];
  if (kind === 'admin') {
    // Only a platform support session acts as a network admin — never a portal impersonation.
    const networkId = p['network_id'];
    const by = p['impersonated_by'];
    if (p['support'] !== 'platform' || p['role'] !== 'admin' || typeof networkId !== 'string' || !networkId
      || typeof by !== 'string' || by !== p.sub || typeof p.exp !== 'number' || !p.jti) {
      throw new Error('support session token is invalid');
    }
    return { kind, networkId, platformAdminId: by, expiresAt: p.exp, jti: p.jti };
  }
  if (kind !== 'publisher' && kind !== 'advertiser') throw new Error('impersonation token has an invalid kind');
  const str = (k: string): string => {
    const v = p[k];
    if (typeof v !== 'string' || !v) throw new Error(`impersonation token has no ${k}`);
    return v;
  };
  if (!p.sub || typeof p.exp !== 'number' || !p.jti) throw new Error('impersonation token is incomplete');
  return {
    kind, networkId: str('network_id'), ownerId: str('owner_id'), impersonatedBy: str('impersonated_by'),
    userId: p.sub, expiresAt: p.exp, jti: p.jti,
  };
}
