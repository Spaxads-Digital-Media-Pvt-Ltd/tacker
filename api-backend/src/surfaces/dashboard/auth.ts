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
import { unauthorized, forbidden, serviceUnavailable } from '../../lib/http/errors.js';
import { verifySupabaseJwt } from '../../lib/auth/verify-jwt.js';
import {
 isImpersonationToken, verifyImpersonationToken, signImpersonationToken, impersonationConfigured,
} from '../../lib/auth/impersonation-token.js';
import { networkState, inactiveNetworkMessage } from '../../lib/networks/state.js';
import { staffState } from '../../lib/auth/staff-state.js';
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
export async function dashboardAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
 const token = bearer(req);
 if (!token) return next(unauthorized('Missing bearer token.'));

 // Admin impersonation session (F-10): its own short-lived token and secret — the account's portal
 // identity plus the admin behind it (`impersonatedBy`). Everything else is a Supabase-issued token.
 if (isImpersonationToken(token)) {
 try {
 const s = await verifyImpersonationToken(token);
 req.identity = {
 surface: 'dashboard', kind: s.kind, userId: s.userId, networkId: s.networkId, ownerId: s.ownerId,
 impersonatedBy: s.impersonatedBy, impersonationExpiresAt: s.expiresAt,
 };
 req.scope = { networkId: s.networkId, ownerId: s.ownerId };
 } catch {
 return next(unauthorized('Impersonation session is invalid or has expired.'));
 }
 } else try {
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

 // The `network_id` claim is stamped on the Supabase user at provisioning and outlives the network
 // row: a purged network's logins keep valid JWTs whose reads come back empty and whose first INSERT
 // dies on a `network_id` FK — reject them up front. A suspended or (soft-)deleted network (F-26)
 // has no dashboard or portal access either. Outside the try: a DB failure is a 500, not "invalid token".
 try {
 const state = await networkState(req.scope!.networkId);
 if (state !== 'active') {
 req.identity = undefined;
 req.scope = undefined;
 return next(state === null
 ? unauthorized('This login belongs to a network that no longer exists. Sign in with an account on an active network.')
 : forbidden(inactiveNetworkMessage(state)));
 }
 // Team members: the users row decides — a disabled member is refused, and a role change applies
 // now (the token's role claim is only the fallback for a login with no users row).
 const id = req.identity!;
 if (id.surface === 'dashboard' && id.kind === 'admin') {
 const staff = await staffState(req.scope!.networkId, id.userId);
 if (staff?.status === 'disabled') {
 req.identity = undefined;
 req.scope = undefined;
 return next(forbidden('This account is disabled. Ask an admin of your network to re-enable it.'));
 }
 if (staff && (ROLES as readonly string[]).includes(staff.role)) id.role = staff.role as AdminRole;
 }
 } catch (err) {
 return next(err);
 }
 return next();
}

/** Is an admin impersonating this request's portal account? (F-10) */
export function isImpersonating(req: Request): boolean {
 const id = req.identity;
 return Boolean(id && id.surface === 'dashboard' && id.kind !== 'admin' && id.impersonatedBy);
}

/**
 * Refuse while impersonating (F-10) — for credential changes (password, email, anonymize, API keys):
 * an impersonation session is time-boxed and must not be able to outlive or take over the account.
 * `writesOnly` lets reads through (e.g. listing API keys).
 */
export function notWhileImpersonating(opts: { writesOnly?: boolean } = {}) {
 return (req: Request, _res: Response, next: NextFunction): void => {
 if (opts.writesOnly && (req.method === 'GET' || req.method === 'HEAD')) return next();
 if (isImpersonating(req)) return next(forbidden('Not available while impersonating.'));
 return next();
 };
}

/**
 * Start impersonating a partner/advertiser account (F-10): a dedicated short-lived session for that
 * account's portal, flagged with the admin starting it — never the account's own credentials. Works
 * whether or not the account has a portal login. Returns the API response and what to audit.
 */
export async function startImpersonation(
 req: Request, kind: 'publisher' | 'advertiser', account: { id: string; auth_user_id: string | null },
) {
 if (!impersonationConfigured()) throw serviceUnavailable('Impersonation is not configured on this server (IMPERSONATION_JWT_SECRET).');
 const id = req.identity;
 if (!id || id.surface !== 'dashboard' || id.kind !== 'admin') throw forbidden('Admin access required.');
 const { token, expiresAt, jti } = await signImpersonationToken({
 kind, networkId: id.networkId, ownerId: account.id, userId: account.auth_user_id ?? account.id, impersonatedBy: id.userId,
 });
 return {
 response: { token, expiresAt, kind, ownerId: account.id, impersonatedBy: id.userId },
 audit: { impersonatedBy: id.userId, expiresAt: new Date(expiresAt * 1000).toISOString(), sessionId: jti },
 };
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
