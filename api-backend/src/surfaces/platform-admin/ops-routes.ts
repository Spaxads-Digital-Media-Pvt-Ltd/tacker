/**
 * Super Admin › operations: the Overview (networks, subscriptions, MRR and billing per currency, traffic,
 * what needs attention), Usage across networks (each against its plan's limits), the Super Admin team
 * (add, disable / enable, reset a password; change your own), and the platform Activity log (what Super
 * Admins did, and what billing did on its own). Team changes are audited.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, conflict, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { usageVsPlan, type UsageVsPlan } from '../../lib/usage/meter.js';
import { hashPassword, verifyPassword } from '../../lib/auth/platform-admin-password.js';
import { passwordSchema } from '../../lib/auth/password-policy.js';
import type { PlatformAdminIdentity } from '../../middleware/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const me = (req: { identity?: unknown }) => (req.identity as PlatformAdminIdentity).platformAdminId;
const ADMIN_COLUMNS = 'id, email, name, status, created_at, last_login_at';

const newAdminSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(200).optional(),
  password: passwordSchema,
}).strict();
const updateAdminSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict();
const setPasswordSchema = z.object({ password: passwordSchema }).strict();
const ownPasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict();
const activitySchema = paginationSchema.extend({
  /** admins = what Super Admins did; billing = what the billing run did on its own; all = both. */
  scope: z.enum(['admins', 'billing', 'all']).default('all'),
  networkId: z.string().uuid().optional(),
  adminId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
}).strict();

export function opsRoutes(): Router {
  const r = Router();

  // ---------- Overview ----------
  r.get('/summary', asyncHandler(async (_req, res) => {
    const [nets, subs, mrr, billing, traffic, trials, overdue, limits, recent] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
                COUNT(*) FILTER (WHERE status = 'suspended' AND suspended_reason = 'billing')::int AS suspended_for_billing,
                COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month
           FROM networks`),
      query(
        `SELECT COUNT(*) FILTER (WHERE s.status = 'trialing')::int AS trialing,
                COUNT(*) FILTER (WHERE s.status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE s.status = 'past_due')::int AS past_due,
                (SELECT COUNT(*) FROM networks n WHERE n.status <> 'deleted' AND NOT EXISTS (
                   SELECT 1 FROM subscriptions x WHERE x.network_id = n.id AND x.status IN ('trialing', 'active', 'past_due')))::int AS without_plan
           FROM subscriptions s JOIN networks n ON n.id = s.network_id WHERE n.status <> 'deleted'`),
      // Monthly recurring revenue per currency (never summed across currencies): paying subscriptions
      // only (trials excluded), a yearly price counted as a twelfth.
      query(
        `SELECT p.currency,
                round(SUM(CASE WHEN p.billing_interval = 'year' THEN p.price_cents::numeric / 12 ELSE p.price_cents END) / 100, 2)::text AS amount,
                COUNT(*)::int AS subscriptions
           FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id JOIN networks n ON n.id = s.network_id
          WHERE s.status IN ('active', 'past_due') AND n.status <> 'deleted' AND p.price_cents > 0
          GROUP BY p.currency ORDER BY p.currency`),
      query(
        `SELECT currency,
                COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
                COALESCE(SUM(total) FILTER (WHERE status = 'open'), 0)::text AS open_total,
                COUNT(*) FILTER (WHERE status = 'open' AND due_at <= now())::int AS overdue_count,
                COALESCE(SUM(total) FILTER (WHERE status = 'open' AND due_at <= now()), 0)::text AS overdue_total,
                COALESCE(SUM(paid_amount) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', now())), 0)::text AS collected_this_month
           FROM platform_invoices GROUP BY currency ORDER BY currency`),
      query(
        `SELECT (SELECT COUNT(*) FROM clicks WHERE created_at >= now() - interval '24 hours')::int AS clicks24h,
                (SELECT COUNT(*) FROM conversions WHERE created_at >= now() - interval '24 hours')::int AS conversions24h`),
      query(
        `SELECT n.id AS network_id, n.name AS network_name, p.name AS plan_name, s.trial_ends_at
           FROM subscriptions s JOIN networks n ON n.id = s.network_id JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.status = 'trialing' AND n.status <> 'deleted' AND s.trial_ends_at <= now() + interval '7 days'
          ORDER BY s.trial_ends_at LIMIT 10`),
      query(
        `SELECT i.id, i.number, i.network_id, COALESCE(n.name, i.bill_to->>'name') AS network_name, i.total, i.currency, i.due_at, i.suspend_at,
                n.status AS network_status, n.suspended_reason AS network_suspended_reason
           FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id
          WHERE i.status = 'open' AND i.due_at <= now() ORDER BY i.due_at LIMIT 10`),
      // The latest plan-limit alert per network and limit this month (lib/usage/meter.ts raises them).
      query(
        `SELECT * FROM (
           SELECT DISTINCT ON (a.network_id, a.entity_id) a.network_id, n.name AS network_name, a.type, a.title, a.created_at
             FROM alerts a JOIN networks n ON n.id = a.network_id
            WHERE a.type IN ('plan_limit_near', 'plan_limit_reached') AND a.created_at >= now() - interval '31 days' AND n.status <> 'deleted'
            ORDER BY a.network_id, a.entity_id, a.created_at DESC) x
          ORDER BY x.created_at DESC LIMIT 10`),
      query(
        `SELECT al.id, al.created_at, al.action, al.network_id, n.name AS network_name, pa.email AS admin_email, (al.impersonated_by IS NOT NULL) AS in_support_session
           FROM audit_log al LEFT JOIN platform_admins pa ON pa.id::text = al.actor_id LEFT JOIN networks n ON n.id = al.network_id
          WHERE al.actor_type = 'platform_admin' ORDER BY al.created_at DESC LIMIT 10`),
    ]);
    sendOk(res, {
      networks: nets.rows[0], subscriptions: subs.rows[0], mrr: mrr.rows, billing: billing.rows, traffic: traffic.rows[0],
      trialsEndingSoon: trials.rows, overdueInvoices: overdue.rows, limitAlerts: limits.rows, recentActivity: recent.rows,
    });
  }));

  // ---------- Usage across networks ----------
  // Every network (not deleted) with its plan, this period against the plan's limits and its last 30
  // days' clicks / conversions. `worst` = the most serious limit state, for sorting and filtering.
  r.get('/usage', asyncHandler(async (_req, res) => {
    const nets = (await query<{ id: string; name: string; status: string; plan_name: string | null; subscription_status: string | null }>(
      `SELECT n.id, n.name, n.status, p.name AS plan_name, s.status AS subscription_status
         FROM networks n LEFT JOIN subscriptions s ON s.network_id = n.id LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE n.status <> 'deleted' ORDER BY n.name LIMIT 1000`)).rows;
    const totals = new Map((await query<{ network_id: string; clicks: string; conversions: string }>(
      `SELECT network_id,
              COALESCE(SUM(value) FILTER (WHERE metric = 'clicks'), 0)::text AS clicks,
              COALESCE(SUM(value) FILTER (WHERE metric = 'conversions'), 0)::text AS conversions
         FROM usage_records WHERE period_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY network_id`)).rows.map((t) => [t.network_id, t]));
    const usage: UsageVsPlan[] = [];
    for (let i = 0; i < nets.length; i += 10) {
      usage.push(...await Promise.all(nets.slice(i, i + 10).map((n) => usageVsPlan(n.id))));
    }
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

  // ---------- Super Admin team ----------
  r.get('/admins', asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT ${ADMIN_COLUMNS} FROM platform_admins ORDER BY created_at`);
    sendOk(res, rows.map((a) => ({ ...a, you: a['id'] === me(req) })));
  }));

  r.post('/admins', validateBody(newAdminSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof newAdminSchema>;
    try {
      const { rows } = await query(
        `INSERT INTO platform_admins (email, name, status, password_hash, auth_provider) VALUES ($1, $2, 'active', $3, 'local') RETURNING ${ADMIN_COLUMNS}`,
        [b.email.toLowerCase(), b.name || null, await hashPassword(b.password)]);
      await writePlatformAudit(req, null, { action: 'platform_admin.create', entityType: 'platform_admin', entityId: rows[0]!['id'] as string, after: { email: rows[0]!['email'] } });
      sendOk(res, rows[0], undefined, 201);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw badRequest(`A Super Admin with the email ${b.email} already exists.`);
      throw err;
    }
  }));

  r.patch('/admins/:id', validateBody(updateAdminSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const b = req.body as z.infer<typeof updateAdminSchema>;
    const before = UUID_RE.test(id) ? (await query(`SELECT ${ADMIN_COLUMNS} FROM platform_admins WHERE id = $1`, [id])).rows[0] : undefined;
    if (!before) throw notFound('Super Admin not found');
    // Never yourself — which also keeps at least one active Super Admin (you are one).
    if (b.status === 'disabled' && id === me(req)) throw conflict('You can’t disable your own account — ask another Super Admin.');
    const sets: string[] = []; const params: unknown[] = [];
    if (b.name !== undefined) { params.push(b.name || null); sets.push(`name = $${params.length}`); }
    if (b.status !== undefined) { params.push(b.status); sets.push(`status = $${params.length}`); }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    const { rows } = await query(`UPDATE platform_admins SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${ADMIN_COLUMNS}`, params);
    await writePlatformAudit(req, null, { action: 'platform_admin.update', entityType: 'platform_admin', entityId: id, before, after: rows[0] });
    sendOk(res, rows[0]);
  }));

  // Another Super Admin's password (they forgot it). Your own: POST /me/password (needs the current one).
  r.post('/admins/:id/password', validateBody(setPasswordSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (id === me(req)) throw badRequest('Change your own password with your current one (Team › Your account).');
    const target = UUID_RE.test(id) ? (await query<{ email: string }>(`SELECT email FROM platform_admins WHERE id = $1 AND auth_provider = 'local'`, [id])).rows[0] : undefined;
    if (!target) throw notFound('Super Admin not found');
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

  // ---------- Activity ----------
  r.get('/activity', validateQuery(activitySchema), asyncHandler(async (_req, res) => {
    const { limit, offset, scope, networkId, adminId, q } = res.locals.query as z.infer<typeof activitySchema>;
    const BILLING = `(al.actor_type = 'system' AND (al.action LIKE 'subscription.%' OR al.action = 'network.suspended_billing'))`;
    const where = `(${scope === 'admins' ? `al.actor_type = 'platform_admin'` : scope === 'billing' ? BILLING : `(al.actor_type = 'platform_admin' OR ${BILLING})`})
      AND ($1::uuid IS NULL OR al.network_id = $1)
      AND ($2::text IS NULL OR al.actor_id = $2)
      AND ($3::text IS NULL OR al.action ILIKE $3 ESCAPE '\\' OR n.name ILIKE $3 ESCAPE '\\' OR pa.email ILIKE $3 ESCAPE '\\')`;
    const params = [networkId ?? null, adminId ?? null, q ? containsPattern(q) : null];
    const from = `FROM audit_log al LEFT JOIN platform_admins pa ON al.actor_type = 'platform_admin' AND pa.id::text = al.actor_id
                  LEFT JOIN networks n ON n.id = al.network_id`;
    const [rows, count] = await Promise.all([
      query(
        `SELECT al.id, al.created_at, al.action, al.entity_type, al.entity_id, al.network_id, n.name AS network_name, al.actor_type,
                pa.email AS admin_email, (al.impersonated_by IS NOT NULL) AS in_support_session, al.after
           ${from} WHERE ${where} ORDER BY al.created_at DESC LIMIT $4 OFFSET $5`, [...params, limit, offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n ${from} WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit, offset, total: count.rows[0]?.n ?? 0 });
  }));

  return r;
}
