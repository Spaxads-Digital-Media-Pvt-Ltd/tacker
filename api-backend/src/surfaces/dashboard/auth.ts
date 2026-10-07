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
import { query } from '../../lib/db/pool.js';
import type { DashboardKind, AdminRole } from '../../middleware/types.js';

const ROLES: readonly AdminRole[] = ['admin', 'manager', 'finance', 'read_only'];
const KINDS: readonly DashboardKind[] = ['admin', 'publisher', 'advertiser'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NETWORK_OK_TTL_MS = 60_000;
const networkSeen = new Map<string, number>();

/**
 * The `network_id` claim is stamped on the Supabase user at provisioning and outlives the network
 * row: after a network is deleted, its logins keep valid JWTs whose reads come back empty and whose
 * first INSERT dies on a `network_id` FK (23503 — surfaced as a misleading "still in use" 409).
 * Reject such tokens up front. Positive results are cached briefly; misses are never cached.
 */
async function networkExists(networkId: string): Promise<boolean> {
 if (!UUID_RE.test(networkId)) return false;
 const until = networkSeen.get(networkId);
 if (until && until > Date.now()) return true;
 const { rows } = await query('SELECT 1 FROM networks WHERE id = $1', [networkId]);
 if (!rows.length) {
 networkSeen.delete(networkId);
 return false;
 }
 networkSeen.set(networkId, Date.now() + NETWORK_OK_TTL_MS);
 return true;
}

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
export async function dashboardAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
 const token = bearer(req);
 if (!token) return next(unauthorized('Missing bearer token.'));

 try {
 const payload = await verifySupabaseJwt(token);
 const meta = (payload['app_metadata'] as Record<string, unknown> | undefined) ?? {};
 const claim = (k: string): string =>
 String((meta[k] as unknown) ?? (payload[k] as unknown) ?? '');

 const networkId = claim('network_id');
 if (!networkId) return next(unauthorized('Token has no network_id claim.'));

 const rawKind = claim('kind');
 if (!rawKind) return next(unauthorized('Token has no kind claim.'));
 if (!(KINDS as readonly string[]).includes(rawKind)) return next(unauthorized('Unsupported kind.'));
 const kind = rawKind as DashboardKind;

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
 } catch {
 return next(unauthorized('Invalid or expired token.'));
 }

 // Outside the try: a DB failure here is a 500, not "invalid token".
 try {
 if (!(await networkExists(req.scope!.networkId))) {
 req.identity = undefined;
 req.scope = undefined;
 return next(unauthorized('This login belongs to a network that no longer exists. Sign in with an account on an active network.'));
 }
 } catch (err) {
 return next(err);
 }
 return next();
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
