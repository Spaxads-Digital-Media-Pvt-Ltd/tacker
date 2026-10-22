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
 * The pa_sub claim carries the platform_admins.id — the stable DB identity. The member's role is read
 * on every request (a role change applies at once): `requirePerm(section, level)` guards each route and
 * `networkScope` / `assertNetworkInScope` keep an 'assigned' role to the networks it manages or sold.
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, unauthorized, forbidden, notFound } from '../../lib/http/errors.js';
import { verifyPlatformAdminToken } from '../../lib/auth/platform-admin-token.js';
import { query } from '../../lib/db/pool.js';
import { allows, normalizePermissions, sectionName, type Section } from '../../lib/platform/permissions.js';
import type { PlatformAdminIdentity } from '../../middleware/types.js';
import { securitySettings } from '../../lib/platform/twofactor.js';
import { ipAllowed, sessionIsLive } from '../../lib/platform/staff-security.js';

/** What a member who must set up two-factor may still reach. */
const SETUP_PATHS = /^\/me(\/2fa(\/[a-z-]+)?|\/password)?\/?$/;

interface PlatformAdminRow {
 id: string;
 status: string;
 email: string;
 totp_enabled_at: Date | null;
 role_key: string;
 role_name: string;
 permissions: unknown;
 scope: 'all' | 'assigned';
 home: string;
}

const clientAddress = (req: Request): string | null => (typeof req.ip === 'string' ? req.ip : req.socket?.remoteAddress ?? null);

export function platformAdminAuth(req: Request, _res: Response, next: NextFunction): void {
 const h = req.header('authorization');
 const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
 if (!token) return next(unauthorized('You are not signed in (the request had no sign-in token). Please sign in again.'));

 verifyPlatformAdminToken(token)
 .then(async (payload) => {
 const paSub = payload.pa_sub;

 // Membership gate — verify an ACTIVE platform_admins row so access can be revoked; its role decides the rest.
 const { rows } = await query<PlatformAdminRow>(
 `SELECT pa.id, pa.status, pa.email, pa.totp_enabled_at, r.key AS role_key, r.name AS role_name, r.permissions, r.scope, r.home
 FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
 WHERE pa.id = $1 LIMIT 1`,
 [paSub],
 );
 const admin = rows[0];
 if (!admin || admin.status !== 'active') {
 return next(forbidden('Platform administrator not found or disabled.'));
 }
 // The session: a signed-out (revoked) or expired one ends here even though the JWT still verifies.
 if (!payload.jti || !(await sessionIsLive(payload.jti, admin.id))) {
 return next(new AppError('unauthorized', 'Your session has ended — please sign in again.', { reason: 'session_ended' }));
 }
 if (!ipAllowed((await securitySettings()).ipAllowlist, clientAddress(req))) {
 return next(new AppError('forbidden', 'The console can only be used from the platform’s allowed addresses (Settings › Security).', { reason: 'ip_not_allowed' }));
 }
 const identity: PlatformAdminIdentity = {
 surface: 'platform-admin', platformAdminId: admin.id, email: admin.email, sessionId: payload.jti,
 role: { key: admin.role_key, name: admin.role_name, scope: admin.scope, home: admin.home },
 permissions: normalizePermissions(admin.permissions),
 };
 req.identity = identity;
 // Two-factor required for all staff (Settings › Security) and not set up yet: only setting it up (and
 // reading who you are / changing your password) until then.
 if (!admin.totp_enabled_at && (await securitySettings()).requireTwoFactor && !SETUP_PATHS.test(req.path)) {
 return next(new AppError('forbidden', 'Set up two-factor sign-in first — it is required for every member (Team › Your account).', { reason: 'two_factor_setup_required' }));
 }
 // No req.scope: platform code opts into a specific tenant explicitly and audibly.
 return next();
 })
 .catch(() => next(unauthorized('Invalid or expired token.')));
}

const platformIdentity = (req: Request): PlatformAdminIdentity | null =>
 (req.identity && req.identity.surface === 'platform-admin' ? req.identity : null);

/** Guard: the member's role must grant `section` at least `level` (403 naming the role and the section). */
export function requirePerm(section: Section, level: 'read' | 'full') {
 return (req: Request, _res: Response, next: NextFunction): void => {
 const id = platformIdentity(req);
 if (!id) return next(unauthorized('You are not signed in. Please sign in again.'));
 if (!allows(id.permissions, section, level)) {
 return next(new AppError('forbidden',
 `Your role (${id.role?.name ?? 'none'}) can’t ${level === 'full' ? 'change' : 'see'} ${sectionName(section)}. Ask an Owner to change your role.`,
 { reason: 'permission', section, level }));
 }
 return next();
 };
}

/** Does the member hold `section` at `level`? (for answers that include optional parts, e.g. revenue on the overview) */
export function can(req: Request, section: Section, level: 'read' | 'full'): boolean {
 return allows(platformIdentity(req)?.permissions, section, level);
}

/** Only the networks this member manages or sold, for an 'assigned' role. */
export const isAssignedScope = (req: Request): boolean => platformIdentity(req)?.role?.scope === 'assigned';

/**
 * SQL limiting a networks alias to the member's scope: `TRUE` for an 'all' role, else the networks it
 * manages or sold. `next` is the next free $ parameter number; append the returned params.
 */
export function networkScope(req: Request, alias: string, next: number): { sql: string; params: unknown[] } {
 const id = platformIdentity(req);
 if (id?.role?.scope !== 'assigned') return { sql: 'TRUE', params: [] };
 return { sql: `(${alias}.account_manager_id = $${next} OR ${alias}.sales_owner_id = $${next})`, params: [id.platformAdminId] };
}

/** SQL limiting a sales_leads alias to the member's scope: every lead, or (an 'assigned' role) the ones it owns. */
export function leadScope(req: Request, alias: string, next: number): { sql: string; params: unknown[] } {
 const id = platformIdentity(req);
 if (id?.role?.scope !== 'assigned') return { sql: 'TRUE', params: [] };
 return { sql: `${alias}.owner_id = $${next}`, params: [id.platformAdminId] };
}

/** The network ids an 'assigned' role may see (null = every network) — for queries over tables without a networks join. */
export async function scopedNetworkIds(req: Request): Promise<string[] | null> {
 if (!isAssignedScope(req)) return null;
 const sc = networkScope(req, 'n', 1);
 return (await query<{ id: string }>(`SELECT n.id FROM networks n WHERE ${sc.sql}`, sc.params)).rows.map((r) => r.id);
}

/** 404 (never "forbidden" — it doesn't say the network exists) when the network is outside an 'assigned' scope. */
export async function assertNetworkInScope(req: Request, networkId: string): Promise<void> {
 const id = platformIdentity(req);
 if (id?.role?.scope !== 'assigned') return;
 const { rows } = await query(
 'SELECT 1 FROM networks WHERE id = $1 AND (account_manager_id = $2 OR sales_owner_id = $2)', [networkId, id.platformAdminId]);
 if (!rows.length) throw notFound('Network not found');
}
