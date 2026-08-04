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
import { badRequest, notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { pool } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { provisionAdmin } from '../../lib/provisioning.js';
import { env } from '../../config/env.js';
import {
  createNetworkSchema, updateNetworkSchema, createPlanSchema, assignSubscriptionSchema,
  type CreateNetwork, type UpdateNetwork, type CreatePlan, type AssignSubscription,
} from './schemas.js';

export function platformRoutes(): Router {
  const r = Router();

  // ---------- Platform summary (super-admin dashboard tiles) ----------
  r.get(
    '/summary',
    asyncHandler(async (_req, res) => {
      const [nets, subs, clicks, convs] = await Promise.all([
        query<{ total: number; active: number }>(
          `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM networks`),
        query<{ mrr_cents: string }>(
          `SELECT COALESCE(SUM(p.price_cents),0)::text AS mrr_cents
             FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.status IN ('active', 'trialing')`),
        query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM clicks WHERE created_at >= now() - interval '24 hours'`),
        query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM conversions WHERE created_at >= now() - interval '24 hours'`),
      ]);
      const mrrCents = Number(subs.rows[0]?.mrr_cents ?? 0);
      sendOk(res, {
        networks: nets.rows[0]?.total ?? 0,
        activeNetworks: nets.rows[0]?.active ?? 0,
        mrr: (mrrCents / 100).toFixed(2),
        clicks24h: clicks.rows[0]?.n ?? 0,
        conversions24h: convs.rows[0]?.n ?? 0,
      });
    }),
  );

  // ---------- Networks ----------
  r.get(
    '/networks',
    validateQuery(paginationSchema),
    asyncHandler(async (_req, res) => {
      const { limit, offset } = res.locals.query as PaginationQuery;
      const { rows } = await query(
        `SELECT n.*, s.status AS subscription_status, p.code AS plan_code
           FROM networks n
           LEFT JOIN subscriptions s ON s.network_id = n.id
           LEFT JOIN subscription_plans p ON p.id = s.plan_id
          ORDER BY n.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const { rows: countRows } = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM networks`);
      sendOk(res, rows, { limit, offset, total: countRows[0]?.n ?? 0 });
    }),
  );

  r.get(
    '/networks/:id',
    asyncHandler(async (req, res) => {
      const { rows } = await query(`SELECT * FROM networks WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw notFound('Network not found');
      sendOk(res, rows[0]);
    }),
  );

  // Create network (+ optional admin owner + subdomain) — the onboarding entry point (§3D).
  r.post(
    '/networks',
    validateBody(createNetworkSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as CreateNetwork;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const net = (await client.query<{ id: string }>(
          `INSERT INTO networks (name, slug, default_currency) VALUES ($1, $2, $3) RETURNING *`,
          [b.name, b.slug, b.defaultCurrency],
        )).rows[0]!;

        if (b.provisionSubdomain) {
          await client.query(
            `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
             VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued', true)`,
            [net.id, `${b.slug}.${env.TRACKING_BASE_DOMAIN}`],
          );
        }

        let ownerUserId: string | null = null;
        if (b.owner) {
          // Provision the Supabase Auth login first (outside the txn it can't roll back, but a
          // dangling auth user is harmless and re-runnable). Then record the users row.
          const authUserId = await provisionAdmin({
            email: b.owner.email,
            password: b.owner.password,
            networkId: net.id,
            role: 'admin',
          });
          ownerUserId = (await client.query<{ id: string }>(
            `INSERT INTO users (network_id, auth_user_id, email, name, role, status)
             VALUES ($1, $2, $3, $4, 'admin', 'active') RETURNING id`,
            [net.id, authUserId, b.owner.email, b.owner.name ?? null],
          )).rows[0]!.id;
        }

        await client.query('COMMIT');
        await writePlatformAudit(req, net.id, { action: 'network.create', entityType: 'network', entityId: net.id, after: net });
        res.status(201);
        sendOk(res, { ...net, ownerUserId });
      } catch (err) {
        await client.query('ROLLBACK');
        if (isUnique(err)) throw badRequest('A network with that slug already exists');
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  // Suspend / reactivate / rename.
  r.patch(
    '/networks/:id',
    validateBody(updateNetworkSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as UpdateNetwork;
      const before = (await query(`SELECT * FROM networks WHERE id = $1`, [req.params.id])).rows[0];
      if (!before) throw notFound('Network not found');
      const sets: string[] = [];
      const params: unknown[] = [];
      if (b.name !== undefined) { params.push(b.name); sets.push(`name = $${params.length}`); }
      if (b.status !== undefined) { params.push(b.status); sets.push(`status = $${params.length}`); }
      if (sets.length === 0) throw badRequest('Nothing to update');
      params.push(req.params.id);
      const { rows } = await query(`UPDATE networks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
      await writePlatformAudit(req, req.params.id ?? null, { action: 'network.update', entityType: 'network', entityId: req.params.id, before, after: rows[0] });
      sendOk(res, rows[0]);
    }),
  );

  r.delete(
    '/networks/:id',
    asyncHandler(async (req, res) => {
      const before = (await query(`SELECT * FROM networks WHERE id = $1`, [req.params.id])).rows[0];
      if (!before) throw notFound('Network not found');
      await query(`DELETE FROM networks WHERE id = $1`, [req.params.id]);
      await writePlatformAudit(req, null, { action: 'network.delete', entityType: 'network', entityId: req.params.id, before });
      sendOk(res, { deleted: true });
    }),
  );

  // ---------- Subscription plans (global catalog) ----------
  r.get('/plans', asyncHandler(async (_req, res) => {
    const { rows } = await query(`SELECT * FROM subscription_plans WHERE status = 'active' ORDER BY price_cents`);
    sendOk(res, rows);
  }));

  r.post('/plans', validateBody(createPlanSchema), asyncHandler(async (req, res) => {
    const b = req.body as CreatePlan;
    try {
      const { rows } = await query(
        `INSERT INTO subscription_plans (code, name, price_cents, currency, limits)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [b.code, b.name, b.priceCents, b.currency, JSON.stringify(b.limits)],
      );
      await writePlatformAudit(req, null, { action: 'plan.create', entityType: 'subscription_plan', entityId: rows[0]!.id, after: rows[0] });
      res.status(201);
      sendOk(res, rows[0]);
    } catch (err) {
      if (isUnique(err)) throw badRequest('A plan with that code already exists');
      throw err;
    }
  }));

  // ---------- Subscriptions (per network) ----------
  r.put('/networks/:id/subscription', validateBody(assignSubscriptionSchema), asyncHandler(async (req, res) => {
    const b = req.body as AssignSubscription;
    const net = (await query(`SELECT id FROM networks WHERE id = $1`, [req.params.id])).rows[0];
    if (!net) throw notFound('Network not found');
    const plan = (await query(`SELECT id FROM subscription_plans WHERE id = $1`, [b.planId])).rows[0];
    if (!plan) throw badRequest('planId does not exist');

    const { rows } = await query(
      `INSERT INTO subscriptions (network_id, plan_id, status, current_period_start, current_period_end, renews_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (network_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end, renews_at = EXCLUDED.renews_at
       RETURNING *`,
      [req.params.id, b.planId, b.status, b.currentPeriodStart ?? null, b.currentPeriodEnd ?? null, b.renewsAt ?? null],
    );
    await writePlatformAudit(req, req.params.id ?? null, { action: 'subscription.assign', entityType: 'subscription', entityId: rows[0]!.id, after: rows[0] });
    sendOk(res, rows[0]);
  }));

  // ---------- Usage dashboard ----------
  r.get('/networks/:id/usage', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT metric, SUM(value)::bigint AS total
         FROM usage_records
        WHERE network_id = $1 AND period_date >= (CURRENT_DATE - INTERVAL '30 days')
        GROUP BY metric`,
      [req.params.id],
    );
    sendOk(res, { networkId: req.params.id, windowDays: 30, metrics: rows });
  }));

  return r;
}

function isUnique(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
