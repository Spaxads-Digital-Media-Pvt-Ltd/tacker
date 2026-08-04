/**
 * Dashboard API auth (spec §2.1 surface #2). Identity comes from a Supabase-Auth-issued JWT;
 * ALL authorization is enforced here server-side (spec §2 — never in React).
 *
 * This middleware belongs ONLY to the dashboard surface. The public-api and platform-admin
 * surfaces have their own, separate auth. A dashboard JWT cannot authenticate any other
 * surface (spec non-negotiable #10).
 *
 * Phase 0: verifies the JWT signature/claims and attaches identity + scope. The mapping from
 * `sub` → admin user row (role, network_id, owner_id) is a DB lookup that lands in Phase 1;
 * until then we read role/network from verified custom claims and default safely.
 */
import type { Request, Response, NextFunction } from 'express';
import { unauthorized, forbidden } from '../../lib/http/errors.js';
import { verifySupabaseJwt } from '../../lib/auth/verify-jwt.js';
import type { DashboardKind, AdminRole } from '../../middleware/types.js';

const ROLES: readonly AdminRole[] = ['admin', 'manager', 'finance', 'read_only'];
const KINDS: readonly DashboardKind[] = ['admin', 'publisher', 'advertiser'];

function bearer(req: Request): string | null {
  const h = req.header('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
}

/**
 * Reads custom claims Supabase carries in the JWT: `network_id`, `kind`
 * (admin|publisher|advertiser), `role` (admins), `owner_id` (portals). These are set on
 * the user's `app_metadata` at provisioning (Phase 1A). We re-verify server-side via JWKS; the
 * browser never decides any of this (spec §2, §3A). Async because JWKS verification is async.
 */
export function dashboardAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) return next(unauthorized('Missing bearer token.'));

  verifySupabaseJwt(token)
    .then((payload) => {
      const meta = (payload['app_metadata'] as Record<string, unknown> | undefined) ?? {};
      // Prefer app_metadata (where we stamp our claims) over top-level: Supabase sets a top-level
      // `role: "authenticated"` that would otherwise shadow our admin role. Fall back to
      // top-level so the HS256 test tokens (which put claims top-level) still work.
      const claim = (k: string): string =>
        String((meta[k] as unknown) ?? (payload[k] as unknown) ?? '');

      const networkId = claim('network_id');
      if (!networkId) return next(unauthorized('Token has no network_id claim.'));

      const rawKind = claim('kind') || 'admin';
      const kind: DashboardKind = (KINDS as readonly string[]).includes(rawKind)
        ? (rawKind as DashboardKind)
        : 'admin'; // unknown/legacy kinds default to the network admin surface

      const userId = String(payload.sub ?? '');
      if (kind === 'admin') {
        const rawRole = claim('role') || 'read_only';
        const role: AdminRole = (ROLES as readonly string[]).includes(rawRole)
          ? (rawRole as AdminRole)
          : 'read_only';
        req.identity = { surface: 'dashboard', kind, userId, networkId, role };
        req.scope = { networkId };
      } else {
        const ownerId = claim('owner_id');
        if (!ownerId) return next(unauthorized(`Portal token (${kind}) has no owner_id claim.`));
        req.identity = { surface: 'dashboard', kind, userId, networkId, ownerId };
        req.scope = { networkId, ownerId };
      }
      return next();
    })
    .catch(() => next(unauthorized('Invalid or expired token.')));
}

/** Restrict to admin logins (not portal users). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const id = req.identity;
  if (!id || id.surface !== 'dashboard' || id.kind !== 'admin') {
    return next(forbidden('Admin access required.'));
  }
  return next();
}

/** RBAC guard — use after `dashboardAuth`. Admin-only; deny-by-default if role not allowed. */
export function requireRole(...allowed: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.identity;
    if (!id || id.surface !== 'dashboard' || id.kind !== 'admin' || !allowed.includes(id.role)) {
      return next(forbidden('Insufficient role for this action.'));
    }
    return next();
  };
}

/** Restrict to a specific portal kind and expose the typed owner id. */
export function requirePortal(kind: 'publisher' | 'advertiser') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.identity;
    if (!id || id.surface !== 'dashboard' || id.kind !== kind) {
      return next(forbidden(`${kind} portal access required.`));
    }
    return next();
  };
}
