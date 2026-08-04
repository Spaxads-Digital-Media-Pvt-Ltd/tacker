/**
 * Admin's own subscription + usage view (spec §3C — admins see their usage vs plan limits).
 * Network-scoped (their own network only). Read-only; changing plans is a platform-admin action.
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { query } from '../../../lib/db/pool.js';

export function subscriptionRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const networkId = req.scope!.networkId;
      const sub = (await query(
        `SELECT s.status, s.current_period_end, s.renews_at,
                p.code AS plan_code, p.name AS plan_name, p.price_cents, p.currency, p.limits
           FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.network_id = $1`,
        [networkId],
      )).rows[0] ?? null;

      const usage = (await query(
        `SELECT metric, SUM(value)::bigint AS total
           FROM usage_records
          WHERE network_id = $1 AND period_date >= (CURRENT_DATE - INTERVAL '30 days')
          GROUP BY metric`,
        [networkId],
      )).rows;

      sendOk(res, { subscription: sub, usage });
    }),
  );

  return r;
}
