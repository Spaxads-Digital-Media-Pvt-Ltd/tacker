/**
 * The network's own plan and billing (spec §3C — admins see their usage vs plan limits): its subscription,
 * usage against the plan's limits, the platform's invoices to it and how to pay them (Settings › Billing;
 * no payment gateway yet — the Super Admin records payments). Network-scoped and staff-only (mounted
 * behind requireAdmin: partners / advertisers never see their network's bill). Read-only: plans and
 * invoices are the Super Admin's.
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { notFound } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { usageVsPlan } from '../../../lib/usage/meter.js';
import { billingSettings } from '../../../lib/billing/settings.js';
import { invoiceLines } from '../../../lib/billing/invoices.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function subscriptionRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const networkId = req.scope!.networkId;
      const sub = (await query(
        `SELECT s.status, s.current_period_start, s.current_period_end, s.renews_at, s.trial_ends_at, s.cancel_at_period_end, s.canceled_at,
                p.code AS plan_code, p.name AS plan_name, p.price_cents, p.currency, p.billing_interval, p.limits
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

      // F-26: this billing period against the plan's limits (ok | near | over — flagged, never blocked).
      const { period, limits } = await usageVsPlan(networkId);
      const [invoices, settings] = await Promise.all([
        query(
          `SELECT i.id, i.number, i.description, i.currency, i.subtotal, i.tax, i.total, i.status, i.issued_at, i.due_at, i.suspend_at,
                  i.paid_at, i.period_start, i.period_end, (i.status = 'open' AND i.due_at <= now()) AS overdue
             FROM platform_invoices i WHERE i.network_id = $1 AND i.status <> 'void'
            ORDER BY i.issued_at DESC LIMIT 36`, [networkId]),
        billingSettings(),
      ]);
      sendOk(res, {
        subscription: sub, usage, period, limits, invoices: invoices.rows,
        billing: { paymentInstructions: settings.paymentInstructions, seller: settings.seller },
      });
    }),
  );

  // One invoice for its printed copy (this network's only).
  r.get(
    '/invoices/:id',
    asyncHandler(async (req, res) => {
      const id = req.params['id']!;
      const inv = UUID_RE.test(id)
        ? (await query(
          `SELECT i.id, i.number, i.description, i.currency, i.subtotal, i.tax_rate, i.tax, i.total, i.status, i.issued_at, i.due_at,
                  i.suspend_at, i.paid_at, i.paid_amount, i.payment_method, i.payment_reference, i.period_start, i.period_end,
                  i.bill_to, i.notes, i.voided_at, (i.status = 'open' AND i.due_at <= now()) AS overdue
             FROM platform_invoices i WHERE i.id = $1 AND i.network_id = $2`, [id, req.scope!.networkId])).rows[0]
        : undefined;
      if (!inv) throw notFound('Invoice not found');
      const [s, lines, credits] = await Promise.all([
        billingSettings(),
        invoiceLines(id),
        query(`SELECT number, amount::text, currency, reason, refunded, created_at FROM platform_credit_notes WHERE invoice_id = $1 AND network_id = $2 ORDER BY created_at`,
          [id, req.scope!.networkId]),
      ]);
      sendOk(res, { invoice: inv, lines, creditNotes: credits.rows, seller: s.seller, paymentInstructions: s.paymentInstructions });
    }),
  );

  return r;
}
