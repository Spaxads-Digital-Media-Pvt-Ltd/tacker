/**
 * Platform-admin routes (spec §3C, §3D). Cross-tenant management: networks, subscription plans,
 * per-network subscriptions, and usage dashboards. Uses raw queries (platform admins have no
 * ScopedDb tenant context) and audits every action via writePlatformAudit.
 */
import { Router } from 'express';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../lib/http/pagination.js';
import { badRequest, notFound, unauthorized, forbidden, tooMany, conflict, serviceUnavailable } from '../../lib/http/errors.js';
import { containsPattern } from '../../lib/db/like.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';
import { impersonationConfigured, signSupportSessionToken } from '../../lib/auth/impersonation-token.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { generateTemporaryPassword } from '../../lib/provisioning.js';
import { signPlatformAdminToken, signMfaChallenge, verifyMfaChallenge } from '../../lib/auth/platform-admin-token.js';
import { checkSecondFactor } from '../../lib/platform/twofactor.js';
import { z } from 'zod';
import { verifyPassword } from '../../lib/auth/platform-admin-password.js';
import {
 checkLoginRateLimit,
 loginRateLimitMessage,
 recordLoginFailure,
 resetLoginCounter,
} from '../../lib/auth/login-rate-limit.js';
import {
 createNetworkSchema, updateNetworkSchema, loginSchema, networkListSchema,
 type CreateNetwork, type UpdateNetwork, type Login, type NetworkListQuery,
 purgeNetworkSchema, type PurgeNetwork,
} from './schemas.js';
import { once } from 'node:events';
import { softDeleteNetwork, exportNetwork, exportLedgerCsv, purgeNetwork, purgeAfter } from '../../lib/networks/lifecycle.js';
import type { PlatformAdminIdentity } from '../../middleware/types.js';
import { requirePerm, networkScope, assertNetworkInScope } from './auth.js';
import { networkStateChanged } from '../../lib/networks/state.js';
import { createNetwork } from '../../lib/networks/create.js';
import { usageVsPlan } from '../../lib/usage/meter.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(req: { socket?: { remoteAddress?: string } }): string {
 return req.socket?.remoteAddress ?? 'unknown';
}

/** Public (no auth) routes — login only. */
export function publicPlatformRoutes(): Router {
 const r = Router();

 r.post('/login', validateBody(loginSchema), asyncHandler(async (req, _res) => {
 const b = req.body as Login;
 const normalizedEmail = b.email.trim().toLowerCase();
 const ip = clientIp(req);

 const preCheck = await checkLoginRateLimit(ip, normalizedEmail);
 if (preCheck.limited) throw tooMany(loginRateLimitMessage(preCheck), { retryAfter: preCheck.retryAfterSeconds });

 const { rows } = await query<{ id: string; email: string; status: string; password_hash: string; auth_provider: string; totp_enabled_at: Date | null }>(
 `SELECT id, email, status, password_hash, auth_provider, totp_enabled_at FROM platform_admins WHERE lower(email) = lower($1) LIMIT 1`,
 [b.email],
 );
 const admin = rows[0];
 if (!admin) { await recordLoginFailure(ip, normalizedEmail); throw unauthorized('Invalid email or password.'); }
 if (admin.auth_provider !== 'local') { await recordLoginFailure(ip, normalizedEmail); throw unauthorized('Invalid email or password.'); }
 if (admin.status !== 'active') throw forbidden('Account is disabled.');

 const valid = await verifyPassword(b.password, admin.password_hash);
 if (!valid) { await recordLoginFailure(ip, normalizedEmail); throw unauthorized('Invalid email or password.'); }

 await resetLoginCounter(normalizedEmail);
 // Two-factor on: the password was right — now the authenticator code (POST /login/2fa), no session yet.
 if (admin.totp_enabled_at) {
 return sendOk(_res, { twoFactorRequired: true, challenge: await signMfaChallenge(admin.id), admin: { email: admin.email } });
 }
 await query('UPDATE platform_admins SET last_login_at = now() WHERE id = $1', [admin.id]);

 const token = await signPlatformAdminToken(admin.id);
 return sendOk(_res, { token, admin: { id: admin.id, email: admin.email } });
 }));

 // The second step: the challenge from the password step and a 6-digit code (or a recovery code). Wrong codes
 // count like wrong passwords (5 → a wait), per member.
 r.post('/login/2fa', validateBody(mfaSchema), asyncHandler(async (req, res) => {
 const b = req.body as { challenge: string; code: string };
 let id: string;
 try { id = await verifyMfaChallenge(b.challenge); } catch { throw unauthorized('Your sign-in took too long — enter your password again.'); }
 const ip = clientIp(req);
 const key = `mfa:${id}`;
 const pre = await checkLoginRateLimit(ip, key);
 if (pre.limited) throw tooMany(loginRateLimitMessage(pre), { retryAfter: pre.retryAfterSeconds });
 const admin = (await query<{ email: string; status: string }>('SELECT email, status FROM platform_admins WHERE id = $1', [id])).rows[0];
 if (!admin) throw unauthorized('Your sign-in took too long — enter your password again.');
 if (admin.status !== 'active') throw forbidden('Account is disabled.');
 const used = await checkSecondFactor(id, b.code);
 if (!used) {
 await recordLoginFailure(ip, key);
 throw unauthorized('That code isn’t right — enter the current 6-digit code from your authenticator app (check its clock), or a recovery code.');
 }
 await resetLoginCounter(key);
 await query('UPDATE platform_admins SET last_login_at = now() WHERE id = $1', [id]);
 const left = (await query<{ n: number }>('SELECT cardinality(recovery_code_hashes)::int AS n FROM platform_admins WHERE id = $1', [id])).rows[0]?.n ?? 0;
 return sendOk(res, { token: await signPlatformAdminToken(id), admin: { id, email: admin.email }, usedRecoveryCode: used === 'recovery', recoveryCodesLeft: left });
 }));

 return r;
}

const mfaSchema = z.object({ challenge: z.string().min(10).max(2000), code: z.string().trim().min(6).max(20) }).strict();

/** Authenticated platform-admin routes. */
export function platformRoutes(): Router {
 const r = Router();

 // Overview (/summary), usage across networks, the Super Admin team and activity: ./ops-routes.ts.

 // ---------- Networks ----------
 // Search (name, slug, a team member's email) and filters (status; plan code, or 'none'). Only the columns
 // the console shows — never a network's settings (its SMTP / integration credentials) or postback code.
 r.get(
 '/networks',
 requirePerm('networks', 'read'),
 validateQuery(networkListSchema),
 asyncHandler(async (_req, res) => {
 const { limit, offset, q, status, plan } = res.locals.query as NetworkListQuery;
 const scope = networkScope(_req, 'n', 4);
 const where = `($1::text IS NULL OR n.name ILIKE $1 ESCAPE '\\' OR n.slug ILIKE $1 ESCAPE '\\'
 OR EXISTS (SELECT 1 FROM users u WHERE u.network_id = n.id AND u.email ILIKE $1 ESCAPE '\\'))
 AND ($2::text IS NULL OR n.status = $2)
 AND ($3::text IS NULL OR ($3 = 'none' AND p.code IS NULL) OR p.code = $3)
 AND ${scope.sql}`;
 const params = [q ? containsPattern(q) : null, status ?? null, plan || null, ...scope.params];
 const { rows } = await query(
 `SELECT n.id, n.ref, n.name, n.slug, n.status, n.suspended_reason, n.default_currency, n.created_at, n.updated_at, n.deleted_at, n.exported_at,
 s.status AS subscription_status, p.code AS plan_code, p.name AS plan_name,
 (SELECT u.email FROM users u WHERE u.network_id = n.id AND u.role = 'admin' ORDER BY u.created_at LIMIT 1) AS owner_email,
 n.account_manager_id, COALESCE(am.name, am.email) AS account_manager_name, na.health_score, na.health_status
 FROM networks n
 LEFT JOIN subscriptions s ON s.network_id = n.id
 LEFT JOIN subscription_plans p ON p.id = s.plan_id
 LEFT JOIN network_accounts na ON na.network_id = n.id
 LEFT JOIN platform_admins am ON am.id = n.account_manager_id
 WHERE ${where}
 ORDER BY n.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
 [...params, limit, offset],
 );
 const { rows: countRows } = await query<{ n: number }>(
 `SELECT COUNT(*)::int AS n FROM networks n
 LEFT JOIN subscriptions s ON s.network_id = n.id LEFT JOIN subscription_plans p ON p.id = s.plan_id
 WHERE ${where}`, params);
 // A deleted network says until when it can be restored (then the purge is possible) — D3.
 sendOk(res, rows.map((n) => ({ ...n, purge_after: n['deleted_at'] ? purgeAfter(new Date(n['deleted_at'] as string)) : null })),
 { limit, offset, total: countRows[0]?.n ?? 0 });
 }),
 );

 // One network, everything the console shows about it: the network, its subscription, its owner (the first
 // admin) with their last sign-in, how big it is, its tracking domains and its usage against its plan.
 r.get(
 '/networks/:id',
 requirePerm('networks', 'read'),
 asyncHandler(async (req, res) => {
 const id = req.params.id!;
 if (!UUID_RE.test(id)) throw notFound('Network not found');
 await assertNetworkInScope(req, id);
 const net = (await query(
 `SELECT n.id, n.ref, n.name, n.slug, n.status, n.suspended_reason, n.default_currency, n.created_at, n.updated_at, n.deleted_at, n.exported_at,
 n.reseller_id, r.name AS reseller_name
 FROM networks n LEFT JOIN platform_resellers r ON r.id = n.reseller_id WHERE n.id = $1`, [id])).rows[0];
 if (!net) throw notFound('Network not found');
 const [sub, owner, counts, domains, usage] = await Promise.all([
 query(
 `SELECT s.id, s.status, s.current_period_start, s.current_period_end, s.renews_at, s.created_at,
 s.trial_ends_at, s.cancel_at_period_end, s.canceled_at,
 p.id AS plan_id, p.code AS plan_code, p.name AS plan_name, p.price_cents, p.currency, p.billing_interval, p.limits
 FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.network_id = $1`, [id]),
 query(
 `SELECT u.id, u.email, u.name, u.status, (u.auth_user_id IS NOT NULL) AS has_login,
 (SELECT max(le.created_at) FROM login_events le WHERE le.network_id = u.network_id AND le.user_id = u.auth_user_id) AS last_sign_in_at
 FROM users u WHERE u.network_id = $1 AND u.role = 'admin' ORDER BY u.created_at LIMIT 1`, [id]),
 query<{ users: number; offers: number; partners: number; advertisers: number }>(
 `SELECT (SELECT COUNT(*) FROM users WHERE network_id = $1)::int AS users,
 (SELECT COUNT(*) FROM offers WHERE network_id = $1 AND status <> 'archived')::int AS offers,
 (SELECT COUNT(*) FROM publishers WHERE network_id = $1)::int AS partners,
 (SELECT COUNT(*) FROM advertisers WHERE network_id = $1)::int AS advertisers`, [id]),
 query(`SELECT host, mode, status, is_primary FROM tracking_domains WHERE network_id = $1 ORDER BY is_primary DESC, host`, [id]),
 usageVsPlan(id),
 ]);
 sendOk(res, {
 ...net,
 purge_after: net['deleted_at'] ? purgeAfter(new Date(net['deleted_at'] as string)) : null,
 subscription: sub.rows[0] ?? null,
 owner: owner.rows[0] ?? null,
 counts: counts.rows[0],
 trackingDomains: domains.rows,
 usage,
 });
 }),
 );

 // The network's team (staff logins): role, status, whether they can sign in, and their last sign-in.
 r.get(
 '/networks/:id/users',
 requirePerm('networks', 'read'),
 asyncHandler(async (req, res) => {
 const id = req.params.id!;
 if (!UUID_RE.test(id) || !(await query('SELECT 1 FROM networks WHERE id = $1', [id])).rows[0]) throw notFound('Network not found');
 await assertNetworkInScope(req, id);
 const { rows } = await query(
 `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, (u.auth_user_id IS NOT NULL) AS has_login,
 (SELECT max(le.created_at) FROM login_events le WHERE le.network_id = u.network_id AND le.user_id = u.auth_user_id) AS last_sign_in_at
 FROM users u WHERE u.network_id = $1
 ORDER BY (u.role = 'admin') DESC, u.created_at
 LIMIT 500`, [id]);
 sendOk(res, rows);
 }),
 );

 // A team member who can't get in (e.g. the owner lost their password): a new temporary password, shown
 // once here — they must choose their own at their next sign-in, and Supabase signs them out everywhere.
 r.post(
 '/networks/:id/users/:userId/temporary-password',
 requirePerm('access', 'full'),
 asyncHandler(async (req, res) => {
 const { id, userId } = req.params as { id: string; userId: string };
 if (!UUID_RE.test(id) || !UUID_RE.test(userId)) throw notFound('User not found');
 await assertNetworkInScope(req, id);
 const user = (await query<{ email: string; auth_user_id: string | null }>(
 'SELECT email, auth_user_id FROM users WHERE id = $1 AND network_id = $2', [userId, id])).rows[0];
 if (!user) throw notFound('User not found');
 if (!user.auth_user_id) throw conflict(`${user.email} has no login yet — invite them from the network's Team page.`);
 const temporaryPassword = generateTemporaryPassword();
 const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.auth_user_id, {
 password: temporaryPassword,
 app_metadata: { must_change_password: true },
 });
 if (error) throw badRequest(`Could not set the password: ${error.message}`);
 await writePlatformAudit(req, id, { action: 'network.user_temporary_password', entityType: 'user', entityId: userId, after: { email: user.email } });
 sendOk(res, { email: user.email, temporaryPassword });
 }),
 );

 // Open the network's dashboard as its admin (support): a 30-minute session, every change in it audited to
 // this Super Admin; passwords, emails and API keys can't be changed in it. Only an active network.
 r.post(
 '/networks/:id/support-session',
 requirePerm('access', 'full'),
 asyncHandler(async (req, res) => {
 const id = req.params.id!;
 if (!UUID_RE.test(id)) throw notFound('Network not found');
 await assertNetworkInScope(req, id);
 const net = (await query<{ name: string; status: string }>('SELECT name, status FROM networks WHERE id = $1', [id])).rows[0];
 if (!net) throw notFound('Network not found');
 if (net.status !== 'active') {
 throw conflict(`${net.name} is ${net.status} — ${net.status === 'deleted' ? 'restore' : 'activate'} it first to open its dashboard.`);
 }
 if (!impersonationConfigured()) {
 throw serviceUnavailable('Opening a tenant dashboard needs IMPERSONATION_JWT_SECRET on the server (a random string of 32+ characters in api-backend/.env), then restart the backend.');
 }
 const platformAdminId = (req.identity as PlatformAdminIdentity).platformAdminId;
 const { token, expiresAt, jti } = await signSupportSessionToken({ networkId: id, platformAdminId });
 await writePlatformAudit(req, id, {
 action: 'network.support_session', entityType: 'network', entityId: id,
 after: { expiresAt: new Date(expiresAt * 1000).toISOString(), sessionId: jti },
 });
 sendOk(res, { token, expiresAt, network: { id, name: net.name } });
 }),
 );

 // What Super Admins did to this network — including every change made in a support session.
 r.get(
 '/networks/:id/activity',
 requirePerm('networks', 'read'),
 validateQuery(paginationSchema),
 asyncHandler(async (req, res) => {
 const id = req.params.id!;
 if (!UUID_RE.test(id)) throw notFound('Network not found');
 await assertNetworkInScope(req, id);
 const { limit, offset } = res.locals.query as PaginationQuery;
 const { rows } = await query(
 `SELECT al.id, al.created_at, al.action, al.entity_type, al.entity_id, al.after, (al.impersonated_by IS NOT NULL) AS in_support_session,
 pa.email AS admin_email
 FROM audit_log al LEFT JOIN platform_admins pa ON pa.id::text = al.actor_id
 WHERE al.network_id = $1 AND al.actor_type = 'platform_admin'
 ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`, [id, limit, offset]);
 sendOk(res, rows, { limit, offset });
 }),
 );

 // Create network (+ optional admin owner + subdomain) — the onboarding entry point (§3D).
 r.post(
 '/networks',
 requirePerm('networks', 'full'),
 validateBody(createNetworkSchema),
 asyncHandler(async (req, res) => {
 const { network, ownerUserId } = await createNetwork(req.body as CreateNetwork);
 await writePlatformAudit(req, network.id, { action: 'network.create', entityType: 'network', entityId: network.id, after: network });
 sendOk(res, { ...network, ownerUserId }, undefined, 201);
 }),
 );

 // Suspend / reactivate / rename.
 r.patch(
 '/networks/:id',
 requirePerm('networks', 'full'),
 validateBody(updateNetworkSchema),
 asyncHandler(async (req, res) => {
 const b = req.body as UpdateNetwork;
 const before = (await query(`SELECT * FROM networks WHERE id = $1`, [req.params.id])).rows[0];
 if (!before) throw notFound('Network not found');
 const sets: string[] = [];
 const params: unknown[] = [];
 if (b.name !== undefined) { params.push(b.name); sets.push(`name = $${params.length}`); }
 if (b.status !== undefined) {
 params.push(b.status); sets.push(`status = $${params.length}`);
 // 'deleted' is the soft delete (F-26); any other status restores it.
 sets.push(b.status === 'deleted' ? 'deleted_at = COALESCE(deleted_at, now())' : 'deleted_at = NULL');
 // A Super Admin's suspension is 'manual' (only a Super Admin lifts it; billing never does).
 sets.push(b.status === 'suspended' ? `suspended_reason = 'manual'` : 'suspended_reason = NULL');
 }
 if (sets.length === 0) throw badRequest('Nothing to update');
 params.push(req.params.id);
 const { rows } = await query(`UPDATE networks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
 // Suspend / delete / restore applies at once: tracking hosts and the cached state are dropped.
 if (b.status !== undefined && b.status !== before.status) await networkStateChanged(req.params.id!);
 await writePlatformAudit(req, req.params.id ?? null, { action: 'network.update', entityType: 'network', entityId: req.params.id, before, after: rows[0] });
 sendOk(res, rows[0]);
 }),
 );

 // Delete = SOFT delete (F-26): tracking, the dashboard / portals and the API stop at once, every
 // row is kept, PATCH { status: 'active' } restores it. The hard delete is POST /:id/purge below.
 r.delete(
 '/networks/:id',
 requirePerm('networks', 'full'),
 asyncHandler(async (req, res) => {
 const { before, after } = await softDeleteNetwork(req.params.id!);
 await writePlatformAudit(req, req.params.id ?? null, { action: 'network.delete', entityType: 'network', entityId: req.params.id, before, after: { status: after.status, deletedAt: after.deleted_at, soft: true } });
 sendOk(res, {
 deleted: true, soft: true, status: after.status, deletedAt: after.deleted_at,
 purgeAfter: purgeAfter(after.deleted_at as Date), exportUrl: `/platform/networks/${after.id}/export`,
 });
 }),
 );

 // Every row the network owns, as NDJSON (one snapshot, credentials redacted) — take it before a purge.
 r.get(
 '/networks/:id/export',
 requirePerm('networks', 'full'),
 asyncHandler(async (req, res) => {
 const net = (await query<{ slug: string }>(`SELECT slug FROM networks WHERE id = $1`, [req.params.id])).rows[0];
 if (!net) throw notFound('Network not found');
 res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
 res.setHeader('content-disposition', `attachment; filename="network-${net.slug}-${new Date().toISOString().slice(0, 10)}.ndjson"`);
 const summary = await exportNetwork(req.params.id!, async (line) => {
 if (!res.write(line)) await once(res, 'drain');
 });
 await writePlatformAudit(req, req.params.id ?? null, { action: 'network.export', entityType: 'network', entityId: req.params.id, after: summary });
 res.end();
 }),
 );

 // Purge = the hard delete: a soft-deleted network past its grace period, exported (or explicitly
 // waived), confirmed by its slug. Deletes its Supabase logins first, then its data (F-26).
 r.post(
 '/networks/:id/purge',
 requirePerm('networks', 'full'),
 validateBody(purgeNetworkSchema),
 asyncHandler(async (req, res) => {
 const b = req.body as PurgeNetwork;
 const { before, result } = await purgeNetwork(req.params.id!, { ...b, purgedBy: (req.identity as PlatformAdminIdentity | undefined)?.platformAdminId ?? null });
 await writePlatformAudit(req, null, {
 action: 'network.purge', entityType: 'network', entityId: req.params.id,
 before: { id: before.id, slug: before.slug, name: before.name, deletedAt: before.deleted_at, exportedAt: before.exported_at }, after: result,
 });
 sendOk(res, result);
 }),
 );

 // Purged networks (D3): the tombstones — who the network was, when it was deleted and purged, by whom,
 // and how many ledger entries it left (the ledger is kept; download it below).
 r.get(
 '/purged-networks',
 requirePerm('networks', 'read'),
 validateQuery(paginationSchema),
 asyncHandler(async (_req, res) => {
 const { limit, offset } = res.locals.query as PaginationQuery;
 const { rows } = await query(
 `SELECT p.*, pa.email AS purged_by_email FROM purged_networks p LEFT JOIN platform_admins pa ON pa.id = p.purged_by
 ORDER BY p.purged_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
 const { rows: countRows } = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM purged_networks`);
 sendOk(res, rows, { limit, offset, total: countRows[0]?.n ?? 0 });
 }),
 );

 // A network's money ledger as CSV — a live one, or a purged one (its ledger outlives the purge).
 r.get(
 '/networks/:id/ledger.csv',
 requirePerm('networks', 'full'),
 asyncHandler(async (req, res) => {
 const id = req.params.id!;
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound('Network not found');
 const net = (await query<{ slug: string }>(
 `SELECT slug FROM networks WHERE id = $1 UNION ALL SELECT slug FROM purged_networks WHERE id = $1 LIMIT 1`, [id])).rows[0];
 if (!net) throw notFound('Network not found');
 res.setHeader('content-type', 'text/csv; charset=utf-8');
 res.setHeader('content-disposition', `attachment; filename="ledger-${net.slug}-${new Date().toISOString().slice(0, 10)}.csv"`);
 const summary = await exportLedgerCsv(id, async (chunk) => {
 if (!res.write(chunk)) await once(res, 'drain');
 });
 await writePlatformAudit(req, null, { action: 'network.ledger_export', entityType: 'network', entityId: id, after: summary });
 res.end();
 }),
 );

 // Plans, subscriptions and billing: ./billing-routes.ts.

 // ---------- Usage dashboard ----------
 r.get('/networks/:id/usage', requirePerm('networks', 'read'), asyncHandler(async (req, res) => {
 await assertNetworkInScope(req, req.params.id!);
 const { rows } = await query(
 `SELECT metric, SUM(value)::bigint AS total
 FROM usage_records
 WHERE network_id = $1 AND period_date >= ((now() AT TIME ZONE 'UTC')::date - 30)
 GROUP BY metric`,
 [req.params.id],
 );
 // F-26: this billing period against the plan's limits (state ok | near | over — flagged, never blocked).
 const plan = await usageVsPlan(req.params.id!);
 sendOk(res, { networkId: req.params.id, windowDays: 30, metrics: rows, ...plan });
 }));

 return r;
}
