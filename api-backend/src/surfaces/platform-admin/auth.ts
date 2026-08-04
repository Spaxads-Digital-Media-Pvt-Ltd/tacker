/**
 * Platform-admin (Super Admin) auth (spec §3C — the fifth surface, above all tenants).
 *
 * Unified on Supabase Auth like the other human logins, but ISOLATED by two independent gates:
 *   1. the JWT must carry `app_metadata.kind = 'platform_admin'` (settable only via service_role), and
 *   2. an ACTIVE row must exist in `platform_admins` for that auth user (so access can be revoked).
 * A tenant user's token has neither and can never reach this surface (non-negotiable #12). This
 * identity carries NO network_id — cross-tenant access here is deliberate and audited.
 */
import type { Request, Response, NextFunction } from 'express';
import { unauthorized, forbidden } from '../../lib/http/errors.js';
import { verifySupabaseJwt } from '../../lib/auth/verify-jwt.js';
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

  verifySupabaseJwt(token)
    .then(async (payload) => {
      const meta = (payload['app_metadata'] as Record<string, unknown> | undefined) ?? {};
      const kind = String((payload['kind'] as unknown) ?? (meta['kind'] as unknown) ?? '');
      if (kind !== 'platform_admin') return next(forbidden('Not a platform administrator.'));
      const sub = String(payload.sub ?? '');
      if (!sub) return next(unauthorized('Token has no subject.'));

      // Membership gate — verify an ACTIVE platform_admins row so access can be revoked.
      const { rows } = await query<PlatformAdminRow>(
        `SELECT id, status FROM platform_admins WHERE auth_user_id = $1 LIMIT 1`,
        [sub],
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
