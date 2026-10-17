/**
 * Super Admin › operations: the Overview (networks, subscriptions, MRR and billing per currency, traffic,
 * what needs attention — scoped to an 'assigned' role's networks; revenue / billing parts only for roles
 * that may see them), Usage across networks, the team (staff accounts with their roles; custom roles —
 * Everflow-style per-section Full / Read / hidden), the member's own profile and password, and the
 * Activity log. Team and role changes are audited.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { usageVsPlan, type UsageVsPlan } from '../../lib/usage/meter.js';
import { NETWORK_MRR_SQL } from '../../lib/billing/revenue.js';
import { hashPassword, verifyPassword } from '../../lib/auth/platform-admin-password.js';
import { passwordSchema } from '../../lib/auth/password-policy.js';
import { LEVELS, SECTIONS, SECTION_KEYS, normalizePermissions } from '../../lib/platform/permissions.js';
import { generateSecret, otpauthUrl, verifyTotp, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from '../../lib/auth/totp.js';
import { encryptSecret, decryptSecret } from '../../lib/crypto/secret-box.js';
import { checkSecondFactor, securitySettings, saveSecuritySettings } from '../../lib/platform/twofactor.js';
import { BRAND } from '../../config/branding.js';
import type { PlatformAdminIdentity } from '../../middleware/types.js';
import { requirePerm, can, networkScope } from './auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ident = (req: Request) => req.identity as PlatformAdminIdentity;
const me = (req: Request) => ident(req).platformAdminId;
const isOwner = (req: Request) => ident(req).role?.key === 'owner';
const OWNER_ROLE_ID = '00000000-0000-4000-a000-000000000001';
const ADMIN_SELECT = `pa.id, pa.email, pa.name, pa.status, pa.created_at, pa.last_login_at, (pa.totp_enabled_at IS NOT NULL) AS two_factor,
  r.id AS role_id, r.key AS role_key, r.name AS role_name`;

const newAdminSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(200).optional(),
  password: passwordSchema,
  roleId: z.string().uuid(),
}).strict();
const updateAdminSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  roleId: z.string().uuid().optional(),
}).strict();
const setPasswordSchema = z.object({ password: passwordSchema }).strict();
const codeSchema = z.object({ code: z.string().trim().min(6).max(20) }).strict();
const ownPasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict();
const roleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  scope: z.enum(['all', 'assigned']),
  home: z.string().trim().regex(/^\/admin(\/[a-z-]+)*$/, 'must be a Super Admin page, e.g. /admin/sales'),
  permissions: z.record(z.enum(SECTION_KEYS as [string, ...string[]]), z.enum(LEVELS)),
}).strict();
const activitySchema = paginationSchema.extend({
  /** admins = what Super Admins did; billing = what the billing run did on its own; all = both. */
  scope: z.enum(['admins', 'billing', 'all']).default('all'),
  networkId: z.string().uuid().optional(),
  adminId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
}).strict();

/** The other active owners besides `exceptId` — one must always remain. */
const otherActiveOwners = async (exceptId: string) =>
  (await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM platform_admins WHERE status = 'active' AND role_id = $2 AND id <> $1`, [exceptId, OWNER_ROLE_ID])).rows[0]!.n;

export function opsRoutes(): Router {
  const r = Router();

  // ---------- Me ----------
  r.get('/me', asyncHandler(async (req, res) => {
    const id = ident(req);
    const row = (await query<{ name: string | null; email: string; last_login_at: Date | null; totp_enabled_at: Date | null; codes: number; has_password: boolean }>(
      `SELECT name, email, last_login_at, totp_enabled_at, cardinality(recovery_code_hashes)::int AS codes, (password_hash IS NOT NULL) AS has_password
         FROM platform_admins WHERE id = $1`, [id.platformAdminId])).rows[0];
    const required = (await securitySettings()).requireTwoFactor;
    sendOk(res, {
      identity: id, id: id.platformAdminId, email: row?.email, name: row?.name ?? null, role: id.role, permissions: id.permissions, sections: SECTIONS,
      twoFactor: { enabled: Boolean(row?.totp_enabled_at), enabledAt: row?.totp_enabled_at ?? null, required, recoveryCodesLeft: row?.codes ?? 0 },
    });
  }));

  // ---------- Overview ----------
  r.get('/summary', requirePerm('dashboard', 'read'), asyncHandler(async (req, res) => {
    const sc = networkScope(req, 'n', 1);
    const p = sc.params;
    const scopedNetworks = `SELECT n.id FROM networks n WHERE ${sc.sql}`;
    const [nets, subs, mrr, billing, traffic, trials, overdue, limits, recent] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
                COUNT(*) FILTER (WHERE status = 'suspended' AND suspended_reason = 'billing')::int AS suspended_for_billing,
                COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month
           FROM networks n WHERE ${sc.sql}`, p),
      query(
        `SELECT COUNT(*) FILTER (WHERE s.status = 'trialing')::int AS trialing,
                COUNT(*) FILTER (WHERE s.status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE s.status = 'past_due')::int AS past_due,
                (SELECT COUNT(*) FROM networks n WHERE n.status <> 'deleted' AND ${sc.sql} AND NOT EXISTS (
                   SELECT 1 FROM subscriptions x WHERE x.network_id = n.id AND x.status IN ('trialing', 'active', 'past_due')))::int AS without_plan
           FROM subscriptions s JOIN networks n ON n.id = s.network_id WHERE n.status <> 'deleted' AND ${sc.sql}`, p),
      // Monthly recurring revenue per currency (never summed across currencies): paying subscriptions only
      // (trials excluded), a yearly price as a twelfth, net of recurring discounts (lib/billing/revenue.ts).
      can(req, 'revenue', 'read') ? query(
        `SELECT m.currency, SUM(m.mrr)::text AS amount, COUNT(*)::int AS subscriptions
           FROM (${NETWORK_MRR_SQL}) m JOIN networks n ON n.id = m.network_id
          WHERE m.mrr > 0 AND ${sc.sql} GROUP BY m.currency ORDER BY m.currency`, p) : null,
      can(req, 'billing', 'read') ? query(
        `SELECT i.currency,
                COUNT(*) FILTER (WHERE i.status = 'open')::int AS open_count,
                COALESCE(SUM(i.total) FILTER (WHERE i.status = 'open'), 0)::text AS open_total,
                COUNT(*) FILTER (WHERE i.status = 'open' AND i.due_at <= now())::int AS overdue_count,
                COALESCE(SUM(i.total) FILTER (WHERE i.status = 'open' AND i.due_at <= now()), 0)::text AS overdue_total,
                COALESCE(SUM(i.paid_amount) FILTER (WHERE i.status = 'paid' AND i.paid_at >= date_trunc('month', now())), 0)::text AS collected_this_month
           FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id WHERE ${sc.sql} GROUP BY i.currency ORDER BY i.currency`, p) : null,
      query(
        `SELECT (SELECT COUNT(*) FROM clicks WHERE created_at >= now() - interval '24 hours' AND network_id IN (${scopedNetworks}))::int AS clicks24h,
                (SELECT COUNT(*) FROM conversions WHERE created_at >= now() - interval '24 hours' AND network_id IN (${scopedNetworks}))::int AS conversions24h`, p),
      query(
        `SELECT n.id AS network_id, n.name AS network_name, p.name AS plan_name, s.trial_ends_at
           FROM subscriptions s JOIN networks n ON n.id = s.network_id JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.status = 'trialing' AND n.status <> 'deleted' AND s.trial_ends_at <= now() + interval '7 days' AND ${sc.sql}
          ORDER BY s.trial_ends_at LIMIT 10`, p),
      can(req, 'billing', 'read') ? query(
        `SELECT i.id, i.number, i.network_id, COALESCE(n.name, i.bill_to->>'name') AS network_name, i.total, i.currency, i.due_at, i.suspend_at,
                n.status AS network_status, n.suspended_reason AS network_suspended_reason
           FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id
          WHERE i.status = 'open' AND i.due_at <= now() AND ${sc.sql} ORDER BY i.due_at LIMIT 10`, p) : null,
      // The latest plan-limit alert per network and limit this month (lib/usage/meter.ts raises them).
      query(
        `SELECT * FROM (
           SELECT DISTINCT ON (a.network_id, a.entity_id) a.network_id, n.name AS network_name, a.type, a.title, a.created_at
             FROM alerts a JOIN networks n ON n.id = a.network_id
            WHERE a.type IN ('plan_limit_near', 'plan_limit_reached') AND a.created_at >= now() - interval '31 days' AND n.status <> 'deleted' AND ${sc.sql}
            ORDER BY a.network_id, a.entity_id, a.created_at DESC) x
          ORDER BY x.created_at DESC LIMIT 10`, p),
      can(req, 'activity', 'read') ? query(
        `SELECT al.id, al.created_at, al.action, al.network_id, n.name AS network_name, pa.email AS admin_email, (al.impersonated_by IS NOT NULL) AS in_support_session
           FROM audit_log al LEFT JOIN platform_admins pa ON pa.id::text = al.actor_id LEFT JOIN networks n ON n.id = al.network_id
          WHERE al.actor_type = 'platform_admin' AND (${sc.sql === 'TRUE' ? 'TRUE' : `al.network_id IN (${scopedNetworks})`})
          ORDER BY al.created_at DESC LIMIT 10`, p) : null,
    ]);
    sendOk(res, {
      networks: nets.rows[0], subscriptions: subs.rows[0], mrr: mrr?.rows ?? null, billing: billing?.rows ?? null, traffic: traffic.rows[0],
      trialsEndingSoon: trials.rows, overdueInvoices: overdue?.rows ?? null, limitAlerts: limits.rows, recentActivity: recent?.rows ?? null,
    });
  }));

  // ---------- Usage across networks ----------
  // Every network (not deleted) in the member's scope with its plan, this period against the plan's limits
  // and its last 30 days' clicks / conversions. `worst` = the most serious limit state.
  r.get('/usage', requirePerm('networks', 'read'), asyncHandler(async (req, res) => {
    const sc = networkScope(req, 'n', 1);
    const nets = (await query<{ id: string; name: string; status: string; plan_name: string | null; subscription_status: string | null }>(
      `SELECT n.id, n.name, n.status, p.name AS plan_name, s.status AS subscription_status
         FROM networks n LEFT JOIN subscriptions s ON s.network_id = n.id LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE n.status <> 'deleted' AND ${sc.sql} ORDER BY n.name LIMIT 1000`, sc.params)).rows;
    const totals = new Map((await query<{ network_id: string; clicks: string; conversions: string }>(
      `SELECT network_id,
              COALESCE(SUM(value) FILTER (WHERE metric = 'clicks'), 0)::text AS clicks,
              COALESCE(SUM(value) FILTER (WHERE metric = 'conversions'), 0)::text AS conversions
         FROM usage_records WHERE period_date >= CURRENT_DATE - INTERVAL '30 days' AND network_id = ANY($1::uuid[]) GROUP BY network_id`,
      [nets.map((n) => n.id)])).rows.map((t) => [t.network_id, t]));
    const usage: UsageVsPlan[] = [];
    for (let i = 0; i < nets.length; i += 10) usage.push(...await Promise.all(nets.slice(i, i + 10).map((n) => usageVsPlan(n.id))));
    const rank = { ok: 0, near: 1, over: 2 } as const;
    sendOk(res, nets.map((n, i) => {
      const u = usage[i]!;
      const worst = u.limits.reduce<'ok' | 'near' | 'over' | null>((w, l) => (w === null || rank[l.state] > rank[w] ? l.state : w), null);
      return {
        ...n, plan: u.plan, period: u.period, limits: u.limits, worst,
        clicks30d: Number(totals.get(n.id)?.clicks ?? 0), conversions30d: Number(totals.get(n.id)?.conversions ?? 0),
      };
    }));
  }));

  // ---------- Team (staff accounts) ----------
  r.get('/admins', requirePerm('team', 'read'), asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT ${ADMIN_SELECT} FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id ORDER BY pa.created_at`);
    sendOk(res, rows.map((a) => ({ ...a, you: a['id'] === me(req) })));
  }));

  // Staff who can be assigned networks / leads (an account manager or sales owner): every active member.
  r.get('/staff', asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT pa.id, pa.email, pa.name, r.key AS role_key, r.name AS role_name
         FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id WHERE pa.status = 'active' ORDER BY COALESCE(pa.name, pa.email)`);
    sendOk(res, rows);
  }));

  r.post('/admins', requirePerm('team', 'full'), validateBody(newAdminSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof newAdminSchema>;
    const role = (await query<{ key: string }>('SELECT key FROM platform_roles WHERE id = $1', [b.roleId])).rows[0];
    if (!role) throw badRequest('That role does not exist.');
    if (role.key === 'owner' && !isOwner(req)) throw forbidden('Only an Owner can make someone an Owner.');
    try {
      const { rows } = await query<{ id: string; email: string }>(
        `INSERT INTO platform_admins (email, name, status, password_hash, auth_provider, role_id) VALUES ($1, $2, 'active', $3, 'local', $4) RETURNING id, email`,
        [b.email.toLowerCase(), b.name || null, await hashPassword(b.password), b.roleId]);
      const out = (await query(`SELECT ${ADMIN_SELECT} FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id WHERE pa.id = $1`, [rows[0]!.id])).rows[0];
      await writePlatformAudit(req, null, { action: 'platform_admin.create', entityType: 'platform_admin', entityId: rows[0]!.id, after: { email: rows[0]!.email, role: role.key } });
      sendOk(res, out, undefined, 201);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw badRequest(`A Super Admin with the email ${b.email} already exists.`);
      throw err;
    }
  }));

  r.patch('/admins/:id', requirePerm('team', 'full'), validateBody(updateAdminSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const b = req.body as z.infer<typeof updateAdminSchema>;
    const before = UUID_RE.test(id)
      ? (await query<{ status: string; role_id: string; role_key: string }>(
        `SELECT ${ADMIN_SELECT} FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id WHERE pa.id = $1`, [id])).rows[0]
      : undefined;
    if (!before) throw notFound('Super Admin not found');
    // Never yourself — which also keeps at least one active member (you are one).
    if (b.status === 'disabled' && id === me(req)) throw conflict('You can’t disable your own account — ask another Owner.');
    if (b.roleId !== undefined && b.roleId !== before.role_id) {
      if (id === me(req)) throw conflict('You can’t change your own role — ask another Owner.');
      const role = (await query<{ key: string }>('SELECT key FROM platform_roles WHERE id = $1', [b.roleId])).rows[0];
      if (!role) throw badRequest('That role does not exist.');
      if ((role.key === 'owner' || before.role_key === 'owner') && !isOwner(req)) throw forbidden('Only an Owner can give or take the Owner role.');
    }
    // An Owner leaving (disabled, or another role) needs another active Owner behind them.
    const ownerLeaves = before.role_key === 'owner' && before.status === 'active'
      && (b.status === 'disabled' || (b.roleId !== undefined && b.roleId !== before.role_id));
    if (ownerLeaves && (await otherActiveOwners(id)) === 0) throw conflict('This is the last active Owner — make someone else an Owner first.');
    const sets: string[] = []; const params: unknown[] = [];
    if (b.name !== undefined) { params.push(b.name || null); sets.push(`name = $${params.length}`); }
    if (b.status !== undefined) { params.push(b.status); sets.push(`status = $${params.length}`); }
    if (b.roleId !== undefined) { params.push(b.roleId); sets.push(`role_id = $${params.length}`); }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    await query(`UPDATE platform_admins SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    const after = (await query(`SELECT ${ADMIN_SELECT} FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id WHERE pa.id = $1`, [id])).rows[0];
    await writePlatformAudit(req, null, { action: 'platform_admin.update', entityType: 'platform_admin', entityId: id, before, after });
    sendOk(res, after);
  }));

  // Another member's password (they forgot it). Your own: POST /me/password (needs the current one).
  r.post('/admins/:id/password', requirePerm('team', 'full'), validateBody(setPasswordSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (id === me(req)) throw badRequest('Change your own password with your current one (Team › Your account).');
    const target = UUID_RE.test(id) ? (await query<{ email: string; role_id: string }>(`SELECT email, role_id FROM platform_admins WHERE id = $1 AND auth_provider = 'local'`, [id])).rows[0] : undefined;
    if (!target) throw notFound('Super Admin not found');
    if (target.role_id === OWNER_ROLE_ID && !isOwner(req)) throw forbidden('Only an Owner can reset an Owner’s password.');
    await query(`UPDATE platform_admins SET password_hash = $2 WHERE id = $1`, [id, await hashPassword((req.body as { password: string }).password)]);
    await writePlatformAudit(req, null, { action: 'platform_admin.password_reset', entityType: 'platform_admin', entityId: id, after: { email: target.email } });
    sendOk(res, { ok: true });
  }));

  r.post('/me/password', validateBody(ownPasswordSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ownPasswordSchema>;
    const row = (await query<{ password_hash: string | null }>(`SELECT password_hash FROM platform_admins WHERE id = $1`, [me(req)])).rows[0];
    if (!row?.password_hash || !(await verifyPassword(b.currentPassword, row.password_hash))) throw badRequest('Your current password is not right.');
    if (b.currentPassword === b.newPassword) throw badRequest('The new password must be different from the current one.');
    await query(`UPDATE platform_admins SET password_hash = $2 WHERE id = $1`, [me(req), await hashPassword(b.newPassword)]);
    await writePlatformAudit(req, null, { action: 'platform_admin.password_change', entityType: 'platform_admin', entityId: me(req) });
    sendOk(res, { ok: true });
  }));

  // ---------- Two-factor sign-in (your own) ----------
  r.post('/me/2fa/setup', asyncHandler(async (req, res) => {
    const row = (await query<{ email: string; totp_enabled_at: Date | null }>('SELECT email, totp_enabled_at FROM platform_admins WHERE id = $1', [me(req)])).rows[0]!;
    if (row.totp_enabled_at) throw conflict('Two-factor sign-in is already on — turn it off first to set up a new app.');
    const secret = generateSecret();
    await query('UPDATE platform_admins SET totp_pending_secret = $2 WHERE id = $1', [me(req), encryptSecret(secret)]);
    sendOk(res, { secret, otpauthUrl: otpauthUrl(BRAND.name, row.email, secret) });
  }));

  r.post('/me/2fa/enable', validateBody(codeSchema), asyncHandler(async (req, res) => {
    const row = (await query<{ totp_pending_secret: string | null; totp_enabled_at: Date | null }>(
      'SELECT totp_pending_secret, totp_enabled_at FROM platform_admins WHERE id = $1', [me(req)])).rows[0]!;
    if (row.totp_enabled_at) throw conflict('Two-factor sign-in is already on.');
    if (!row.totp_pending_secret) throw badRequest('Start the setup first.');
    const step = verifyTotp(decryptSecret(row.totp_pending_secret), (req.body as { code: string }).code);
    if (step === null) throw badRequest('That code isn’t right — enter the 6-digit code your authenticator app shows now (check its clock).');
    const codes = generateRecoveryCodes();
    await query(
      `UPDATE platform_admins SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = now(), totp_last_step = $2,
              recovery_code_hashes = $3 WHERE id = $1`, [me(req), step, codes.map(hashRecoveryCode)]);
    await writePlatformAudit(req, null, { action: 'platform_admin.2fa_enable', entityType: 'platform_admin', entityId: me(req) });
    sendOk(res, { enabled: true, recoveryCodes: codes });
  }));

  r.post('/me/2fa/recovery-codes', validateBody(codeSchema), asyncHandler(async (req, res) => {
    const code = (req.body as { code: string }).code;
    // Checked before checkSecondFactor, which would spend a recovery code it was given.
    if (looksLikeRecoveryCode(code)) throw badRequest('Enter the current 6-digit code from your authenticator app — a recovery code can’t be used here.');
    if ((await checkSecondFactor(me(req), code)) !== 'totp') throw badRequest('That code isn’t right — enter the current 6-digit code from your authenticator app.');
    const codes = generateRecoveryCodes();
    await query('UPDATE platform_admins SET recovery_code_hashes = $2 WHERE id = $1', [me(req), codes.map(hashRecoveryCode)]);
    await writePlatformAudit(req, null, { action: 'platform_admin.2fa_recovery_codes', entityType: 'platform_admin', entityId: me(req) });
    sendOk(res, { recoveryCodes: codes });
  }));

  r.post('/me/2fa/disable', validateBody(z.object({ password: z.string().min(1).max(200) }).strict()), asyncHandler(async (req, res) => {
    if ((await securitySettings()).requireTwoFactor) throw conflict('Two-factor sign-in is required for every member (Settings › Security) — it can’t be turned off.');
    const row = (await query<{ password_hash: string | null }>('SELECT password_hash FROM platform_admins WHERE id = $1', [me(req)])).rows[0];
    if (!row?.password_hash || !(await verifyPassword((req.body as { password: string }).password, row.password_hash))) throw badRequest('Your password is not right.');
    await query(`UPDATE platform_admins SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_code_hashes = '{}' WHERE id = $1`, [me(req)]);
    await writePlatformAudit(req, null, { action: 'platform_admin.2fa_disable', entityType: 'platform_admin', entityId: me(req) });
    sendOk(res, { enabled: false });
  }));

  // Another member lost their phone: their two-factor is cleared (they set it up again at their next sign-in).
  r.post('/admins/:id/2fa/reset', requirePerm('team', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (id === me(req)) throw badRequest('Turn your own two-factor off or on under Your account.');
    const target = UUID_RE.test(id) ? (await query<{ email: string; role_id: string; totp_enabled_at: Date | null }>(
      'SELECT email, role_id, totp_enabled_at FROM platform_admins WHERE id = $1', [id])).rows[0] : undefined;
    if (!target) throw notFound('Member not found');
    if (target.role_id === OWNER_ROLE_ID && !isOwner(req)) throw forbidden('Only an Owner can reset an Owner’s two-factor sign-in.');
    if (!target.totp_enabled_at) throw conflict(`${target.email} doesn’t use two-factor sign-in.`);
    await query(`UPDATE platform_admins SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_code_hashes = '{}' WHERE id = $1`, [id]);
    await writePlatformAudit(req, null, { action: 'platform_admin.2fa_reset', entityType: 'platform_admin', entityId: id, after: { email: target.email } });
    sendOk(res, { reset: true });
  }));

  r.get('/settings/security', requirePerm('settings', 'read'), asyncHandler(async (_req, res) => { sendOk(res, await securitySettings()); }));
  r.put('/settings/security', requirePerm('settings', 'full'), validateBody(z.object({ requireTwoFactor: z.boolean() }).strict()), asyncHandler(async (req, res) => {
    const b = req.body as { requireTwoFactor: boolean };
    if (b.requireTwoFactor) {
      const mine = (await query<{ on: boolean }>('SELECT totp_enabled_at IS NOT NULL AS on FROM platform_admins WHERE id = $1', [me(req)])).rows[0];
      if (!mine?.on) throw conflict('Turn on two-factor sign-in for your own account first (Team › Your account).');
    }
    const after = await saveSecuritySettings(b, me(req));
    await writePlatformAudit(req, null, { action: 'settings.security', entityType: 'platform_settings', entityId: 'security', after });
    sendOk(res, after);
  }));

  // ---------- Roles ----------
  r.get('/roles', requirePerm('team', 'read'), asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT r.*, (SELECT COUNT(*) FROM platform_admins pa WHERE pa.role_id = r.id)::int AS members
         FROM platform_roles r ORDER BY r.is_system DESC, r.created_at`);
    sendOk(res, rows.map((x) => ({ ...x, permissions: normalizePermissions(x['permissions']) })));
  }));

  // Custom roles — and changes to the built-in ones (not the Owner's) — are an Owner's.
  r.post('/roles', requirePerm('team', 'full'), validateBody(roleSchema), asyncHandler(async (req, res) => {
    if (!isOwner(req)) throw forbidden('Only an Owner can create roles.');
    const b = req.body as z.infer<typeof roleSchema>;
    const key = `custom-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'role'}-${randomBytes(3).toString('hex')}`;
    const { rows } = await query(
      `INSERT INTO platform_roles (key, name, description, scope, home, permissions) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *, 0 AS members`,
      [key, b.name, b.description ?? null, b.scope, b.home, JSON.stringify(normalizePermissions(b.permissions))]);
    await writePlatformAudit(req, null, { action: 'platform_role.create', entityType: 'platform_role', entityId: rows[0]!['id'] as string, after: rows[0] });
    sendOk(res, { ...rows[0], permissions: normalizePermissions(rows[0]!['permissions']) }, undefined, 201);
  }));

  r.patch('/roles/:id', requirePerm('team', 'full'), validateBody(roleSchema.partial()), asyncHandler(async (req, res) => {
    if (!isOwner(req)) throw forbidden('Only an Owner can change roles.');
    const id = req.params.id!;
    const before = UUID_RE.test(id) ? (await query<{ key: string }>('SELECT * FROM platform_roles WHERE id = $1', [id])).rows[0] : undefined;
    if (!before) throw notFound('Role not found');
    if (before.key === 'owner') throw conflict('The Owner role always has every permission — it can’t be changed.');
    const b = req.body as Partial<z.infer<typeof roleSchema>>;
    const cols: Record<string, unknown> = {
      name: b.name, description: b.description, scope: b.scope, home: b.home,
      permissions: b.permissions === undefined ? undefined : JSON.stringify(normalizePermissions(b.permissions)),
    };
    const sets: string[] = []; const params: unknown[] = [];
    for (const [col, v] of Object.entries(cols)) if (v !== undefined) { params.push(v); sets.push(`${col} = $${params.length}`); }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    const { rows } = await query(`UPDATE platform_roles SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    await writePlatformAudit(req, null, { action: 'platform_role.update', entityType: 'platform_role', entityId: id, before, after: rows[0] });
    sendOk(res, { ...rows[0], permissions: normalizePermissions(rows[0]!['permissions']) });
  }));

  r.delete('/roles/:id', requirePerm('team', 'full'), asyncHandler(async (req, res) => {
    if (!isOwner(req)) throw forbidden('Only an Owner can delete roles.');
    const id = req.params.id!;
    const role = UUID_RE.test(id) ? (await query<{ is_system: boolean; name: string }>('SELECT is_system, name FROM platform_roles WHERE id = $1', [id])).rows[0] : undefined;
    if (!role) throw notFound('Role not found');
    if (role.is_system) throw conflict('Built-in roles can’t be deleted.');
    const members = (await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM platform_admins WHERE role_id = $1', [id])).rows[0]!.n;
    if (members > 0) throw conflict(`${members} member(s) have the role ${role.name} — give them another role first.`);
    await query('DELETE FROM platform_roles WHERE id = $1', [id]);
    await writePlatformAudit(req, null, { action: 'platform_role.delete', entityType: 'platform_role', entityId: id, after: { name: role.name } });
    sendOk(res, { deleted: true });
  }));

  // ---------- Activity ----------
  r.get('/activity', requirePerm('activity', 'read'), validateQuery(activitySchema), asyncHandler(async (req, res) => {
    const { limit, offset, scope, networkId, adminId, q } = res.locals.query as z.infer<typeof activitySchema>;
    const BILLING = `(al.actor_type = 'system' AND (al.action LIKE 'subscription.%' OR al.action = 'network.suspended_billing'))`;
    const sc = networkScope(req, 'n', 4);
    const where = `(${scope === 'admins' ? `al.actor_type = 'platform_admin'` : scope === 'billing' ? BILLING : `(al.actor_type = 'platform_admin' OR ${BILLING})`})
      AND ($1::uuid IS NULL OR al.network_id = $1)
      AND ($2::text IS NULL OR al.actor_id = $2)
      AND ($3::text IS NULL OR al.action ILIKE $3 ESCAPE '\\' OR n.name ILIKE $3 ESCAPE '\\' OR pa.email ILIKE $3 ESCAPE '\\')
      AND ${sc.sql === 'TRUE' ? 'TRUE' : `n.id IS NOT NULL AND ${sc.sql}`}`;
    const params = [networkId ?? null, adminId ?? null, q ? containsPattern(q) : null, ...sc.params];
    const from = `FROM audit_log al LEFT JOIN platform_admins pa ON al.actor_type = 'platform_admin' AND pa.id::text = al.actor_id
                  LEFT JOIN networks n ON n.id = al.network_id`;
    const [rows, count] = await Promise.all([
      query(
        `SELECT al.id, al.created_at, al.action, al.entity_type, al.entity_id, al.network_id, n.name AS network_name, al.actor_type,
                pa.email AS admin_email, (al.impersonated_by IS NOT NULL) AS in_support_session, al.after
           ${from} WHERE ${where} ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n ${from} WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit, offset, total: count.rows[0]?.n ?? 0 });
  }));

  return r;
}
