/**
 * Platform-admin (Super Admin) auth (spec §3C — the fifth surface, above all tenants).
 *
 * Uses a DEDICATED HS256 JWT signed with PLATFORM_ADMIN_JWT_SECRET. This is entirely separate from
 * the tenant Supabase Auth tokens. A tenant Supabase JWT — even one carrying a forged
 * kind=platform_admin claim — cannot pass verification because it was not signed with this secret.
 *
 * Two-gate model remains:
 * 1. JWT signed with PLATFORM_ADMIN_JWT_SECRET (issuer: 'tracker-platform-admin')
 * 2. ACTIVE row in platform_admins DB (access can be revoked server-side)
 *
 * The pa_sub claim carries the platform_admins.id — the stable DB identity.
 */
import type { Request, Response, NextFunction } from 'express';
import { unauthorized, forbidden } from '../../lib/http/errors.js';
import { verifyPlatformAdminToken } from '../../lib/auth/platform-admin-token.js';
import { query } from '../../lib/db/pool.js';
import type { PlatformAdminIdentity } from '../../middleware/types.js';

interface PlatformAdminRow {
 id: string;
 status: string;
}

export function platformAdminAuth(req: Request, _res: Response, next: NextFunction): void {
 const h = req.header('authorization');
 const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
 if (!token) return next(unauthorized('Missing bearer token.'));

 verifyPlatformAdminToken(token)
 .then(async (payload) => {
 const paSub = payload.pa_sub;

 // Membership gate — verify an ACTIVE platform_admins row so access can be revoked.
 const { rows } = await query<PlatformAdminRow>(
 `SELECT id, status FROM platform_admins WHERE id = $1 LIMIT 1`,
 [paSub],
 );
 const admin = rows[0];
 if (!admin || admin.status !== 'active') {
 return next(forbidden('Platform administrator not found or disabled.'));
 }
 const identity: PlatformAdminIdentity = { surface: 'platform-admin', platformAdminId: admin.id };
 req.identity = identity;
 // No req.scope: platform code opts into a specific tenant explicitly and audibly.
 return next();
 })
 .catch(() => next(unauthorized('Invalid or expired token.')));
}
