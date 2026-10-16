/**
 * Super Admin › Plans, subscriptions and billing (lib/billing): the plan catalog (create, edit, archive),
 * each network's subscription (assign / change plan, cancel, resume, extend a trial), the platform's
 * invoices to its tenants (list, view, one-off invoice, mark paid, more time before suspension, void),
 * the billing settings, and "Run billing now". No payment gateway: payments are recorded by hand.
 * Every action is in the platform audit.
 */
import { Router, type Request } from 'express';
import { requirePerm, networkScope, assertNetworkInScope, isAssignedScope } from './auth.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, notFound } from '../../lib/http/errors.js';
import { query, withTransaction } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { writePlatformAudit } from '../../lib/audit.js';
import type { PlatformAdminIdentity } from '../../middleware/types.js';
import { billingSettings, saveBillingSettings } from '../../lib/billing/settings.js';
import {
  INVOICE_SELECT, issueInvoice, invoiceLines, markInvoicePaid, extendInvoiceDeadline, voidInvoice, type PlatformInvoice,
} from '../../lib/billing/invoices.js';
import { assignPlan, cancelSubscription, resumeSubscription, extendTrial } from '../../lib/billing/subscriptions.js';
import { runBilling } from '../../lib/billing/engine.js';
import {
  createPlanSchema, updatePlanSchema, assignSubscriptionSchema, cancelSubscriptionSchema, extendTrialSchema,
  invoiceListSchema, manualInvoiceSchema, markPaidSchema, extendInvoiceSchema, voidInvoiceSchema, billingSettingsSchema,
  type CreatePlan, type UpdatePlan, type AssignSubscription, type InvoiceListQuery,
} from './schemas.js';
import type { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const adminId = (req: { identity?: unknown }) => (req.identity as PlatformAdminIdentity).platformAdminId;
const isUnique = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
const PLAN_SELECT = `p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status IN ('trialing', 'active', 'past_due'))::int AS subscribers`;
const DAY_MS = 86_400_000;

/** An 'assigned' role reaches only the invoices of its networks (404 otherwise). */
async function invoiceInScope(req: Request, invoiceId: string): Promise<void> {
  if (!isAssignedScope(req)) return;
  const n = (await query<{ network_id: string }>('SELECT network_id FROM platform_invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!n) throw notFound('Invoice not found');
  await assertNetworkInScope(req, n.network_id).catch(() => { throw notFound('Invoice not found'); });
}

async function networkExists(id: string): Promise<{ name: string; default_currency: string } | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  return (await query<{ name: string; default_currency: string }>('SELECT name, default_currency FROM networks WHERE id = $1', [id])).rows[0];
}

export function billingRoutes(): Router {
  const r = Router();

  // ---------- Plans ----------
  r.get('/plans', requirePerm('plans', 'read'), asyncHandler(async (req, res) => {
    const status = String(req.query['status'] ?? 'active');
    if (!['active', 'archived', 'all'].includes(status)) throw badRequest('status must be active, archived or all');
    const { rows } = await query(
      `SELECT ${PLAN_SELECT} FROM subscription_plans p WHERE ($1 = 'all' OR p.status = $1) ORDER BY p.status, p.price_cents, p.name`, [status]);
    sendOk(res, rows);
  }));

  r.post('/plans', requirePerm('plans', 'full'), validateBody(createPlanSchema), asyncHandler(async (req, res) => {
    const b = req.body as CreatePlan;
    try {
      const { rows } = await query(
        `INSERT INTO subscription_plans (code, name, price_cents, currency, billing_interval, trial_days, description, limits, overage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *, 0 AS subscribers`,
        [b.code, b.name, b.priceCents, b.currency, b.billingInterval, b.trialDays, b.description ?? null, JSON.stringify(b.limits), JSON.stringify(b.overage)]);
      await writePlatformAudit(req, null, { action: 'plan.create', entityType: 'subscription_plan', entityId: rows[0]!['id'] as string, after: rows[0] });
      sendOk(res, rows[0], undefined, 201);
    } catch (err) {
      if (isUnique(err)) throw badRequest(`A plan with the code "${b.code}" already exists.`);
      throw err;
    }
  }));

  r.patch('/plans/:id', requirePerm('plans', 'full'), validateBody(updatePlanSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const b = req.body as UpdatePlan;
    const before = UUID_RE.test(id) ? (await query('SELECT * FROM subscription_plans WHERE id = $1', [id])).rows[0] : undefined;
    if (!before) throw notFound('Plan not found');
    const cols: Record<string, unknown> = {
      name: b.name, price_cents: b.priceCents, currency: b.currency, billing_interval: b.billingInterval,
      trial_days: b.trialDays, description: b.description, limits: b.limits === undefined ? undefined : JSON.stringify(b.limits),
      overage: b.overage === undefined ? undefined : JSON.stringify(b.overage),
    };
    const sets: string[] = []; const params: unknown[] = [];
    for (const [col, v] of Object.entries(cols)) if (v !== undefined) { params.push(v); sets.push(`${col} = $${params.length}`); }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    const { rows } = await query(`UPDATE subscription_plans p SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${PLAN_SELECT}`, params);
    await writePlatformAudit(req, null, { action: 'plan.update', entityType: 'subscription_plan', entityId: id, before, after: rows[0] });
    sendOk(res, rows[0]);
  }));

  // Archive: no new subscriptions on it (live ones keep it); unarchive brings it back.
  for (const [path, status] of [['archive', 'archived'], ['unarchive', 'active']] as const) {
    r.post(`/plans/:id/${path}`, requirePerm('plans', 'full'), asyncHandler(async (req, res) => {
      const id = req.params.id!;
      if (!UUID_RE.test(id)) throw notFound('Plan not found');
      const { rows } = await query(`UPDATE subscription_plans p SET status = $2 WHERE id = $1 RETURNING ${PLAN_SELECT}`, [id, status]);
      if (!rows[0]) throw notFound('Plan not found');
      await writePlatformAudit(req, null, { action: `plan.${path}`, entityType: 'subscription_plan', entityId: id, after: { status } });
      sendOk(res, rows[0]);
    }));
  }

  // ---------- A network's subscription ----------
  r.put('/networks/:id/subscription', requirePerm('plans', 'full'), validateBody(assignSubscriptionSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!(await networkExists(id))) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const b = req.body as AssignSubscription;
    const out = await assignPlan(id, b.planId, { trialDays: b.trialDays }, adminId(req));
    await writePlatformAudit(req, id, {
      action: out.changed ? 'subscription.change_plan' : 'subscription.assign', entityType: 'subscription', entityId: out.subscription.id,
      before: out.before, after: { ...out.subscription, invoice: out.invoice?.number ?? null },
    });
    sendOk(res, { subscription: out.subscription, invoice: out.invoice, changed: out.changed });
  }));

  r.post('/networks/:id/subscription/cancel', requirePerm('plans', 'full'), validateBody(cancelSubscriptionSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!(await networkExists(id))) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const { atPeriodEnd } = req.body as z.infer<typeof cancelSubscriptionSchema>;
    const out = await cancelSubscription(id, atPeriodEnd);
    await writePlatformAudit(req, id, { action: atPeriodEnd ? 'subscription.cancel_at_period_end' : 'subscription.cancel', entityType: 'subscription', entityId: out.after.id, before: out.before, after: out.after });
    sendOk(res, out.after);
  }));

  r.post('/networks/:id/subscription/resume', requirePerm('plans', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!(await networkExists(id))) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const out = await resumeSubscription(id);
    await writePlatformAudit(req, id, { action: 'subscription.resume', entityType: 'subscription', entityId: out.after.id, before: out.before, after: out.after });
    sendOk(res, out.after);
  }));

  r.post('/networks/:id/subscription/extend-trial', requirePerm('plans', 'full'), validateBody(extendTrialSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!(await networkExists(id))) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const out = await extendTrial(id, (req.body as { days: number }).days);
    await writePlatformAudit(req, id, { action: 'subscription.extend_trial', entityType: 'subscription', entityId: out.after.id, before: out.before, after: out.after });
    sendOk(res, out.after);
  }));

  // ---------- Invoices ----------
  r.get('/invoices', requirePerm('billing', 'read'), validateQuery(invoiceListSchema), asyncHandler(async (_req, res) => {
    const { limit, offset, status, networkId, q } = res.locals.query as InvoiceListQuery;
    const scope = networkScope(_req, 'n', 4);
    const where = `($1 = 'all' OR ($1 = 'overdue' AND i.status = 'open' AND i.due_at <= now()) OR ($1 <> 'overdue' AND i.status = $1))
      AND ($2::uuid IS NULL OR i.network_id = $2)
      AND ($3::text IS NULL OR i.number ILIKE $3 ESCAPE '\\' OR i.bill_to->>'name' ILIKE $3 ESCAPE '\\' OR i.bill_to->>'slug' ILIKE $3 ESCAPE '\\')
      AND ${scope.sql}`;
    const params = [status, networkId ?? null, q ? containsPattern(q) : null, ...scope.params];
    const [rows, count] = await Promise.all([
      query(
        `SELECT ${INVOICE_SELECT}, n.name AS network_name, n.status AS network_status, n.suspended_reason AS network_suspended_reason
           FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id
          WHERE ${where} ORDER BY i.issued_at DESC, i.number DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit, offset, total: count.rows[0]?.n ?? 0 });
  }));

  // Per currency (never summed across currencies): open, overdue, collected this month — all networks or one.
  r.get('/invoices-summary', requirePerm('billing', 'read'), asyncHandler(async (req, res) => {
    const networkId = typeof req.query['networkId'] === 'string' && UUID_RE.test(req.query['networkId']) ? req.query['networkId'] : null;
    const scope = networkScope(req, 'n', 2);
    const { rows } = await query(
      `SELECT i.currency,
              COUNT(*) FILTER (WHERE i.status = 'open')::int AS open_count,
              COALESCE(SUM(i.total) FILTER (WHERE i.status = 'open'), 0)::text AS open_total,
              COUNT(*) FILTER (WHERE i.status = 'open' AND i.due_at <= now())::int AS overdue_count,
              COALESCE(SUM(i.total) FILTER (WHERE i.status = 'open' AND i.due_at <= now()), 0)::text AS overdue_total,
              COALESCE(SUM(i.paid_amount) FILTER (WHERE i.status = 'paid' AND i.paid_at >= date_trunc('month', now())), 0)::text AS collected_this_month
         FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id
        WHERE ($1::uuid IS NULL OR i.network_id = $1) AND ${scope.sql} GROUP BY i.currency ORDER BY i.currency`, [networkId, ...scope.params]);
    sendOk(res, rows);
  }));

  // One invoice, with what its printed copy needs: the seller and how to pay.
  r.get('/invoices/:id', requirePerm('billing', 'read'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const inv = UUID_RE.test(id) ? (await query(`SELECT ${INVOICE_SELECT} FROM platform_invoices i WHERE i.id = $1`, [id])).rows[0] : undefined;
    if (!inv) throw notFound('Invoice not found');
    await invoiceInScope(req, id);
    const [s, lines, credits] = await Promise.all([
      billingSettings(),
      invoiceLines(id),
      query(`SELECT id, number, amount::text, currency, reason, refunded, refund_method, refund_reference, created_at FROM platform_credit_notes WHERE invoice_id = $1 ORDER BY created_at`, [id]),
    ]);
    sendOk(res, { invoice: inv, lines, creditNotes: credits.rows, seller: s.seller, paymentInstructions: s.paymentInstructions });
  }));

  r.post('/networks/:id/invoices', requirePerm('billing', 'full'), validateBody(manualInvoiceSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const net = await networkExists(id);
    if (!net) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const b = req.body as z.infer<typeof manualInvoiceSchema>;
    const settings = await billingSettings();
    const invoice = await withTransaction((c) => issueInvoice(c, {
      networkId: id, description: b.description, subtotal: b.amount, currency: b.currency ?? net.default_currency,
      dueDays: b.dueDays, notes: b.notes ?? null, createdBy: adminId(req),
    }, settings));
    await writePlatformAudit(req, id, { action: 'invoice.create', entityType: 'platform_invoice', entityId: invoice!.id, after: invoice });
    sendOk(res, invoice, undefined, 201);
  }));

  r.post('/invoices/:id/mark-paid', requirePerm('billing', 'full'), validateBody(markPaidSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Invoice not found');
    await invoiceInScope(req, id);
    const b = req.body as z.infer<typeof markPaidSchema>;
    const paidAt = b.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(b.paidAt) ? `${b.paidAt}T12:00:00Z` : b.paidAt;
    if (paidAt && new Date(paidAt).getTime() > Date.now() + DAY_MS) throw badRequest('The payment date can’t be in the future.');
    const out = await markInvoicePaid(id, { method: b.method, reference: b.reference ?? null, paidAt: paidAt ?? null, amount: b.amount ?? null });
    await writePlatformAudit(req, out.after.network_id, {
      action: 'invoice.mark_paid', entityType: 'platform_invoice', entityId: id,
      before: { status: out.before.status }, after: { number: out.after.number, paidAmount: out.after.paid_amount, method: out.after.payment_method, reference: out.after.payment_reference, ...out.settled },
    });
    sendOk(res, { invoice: out.after, ...out.settled });
  }));

  r.post('/invoices/:id/extend', requirePerm('billing', 'full'), validateBody(extendInvoiceSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const inv = UUID_RE.test(id) ? (await query<PlatformInvoice>('SELECT suspend_at FROM platform_invoices WHERE id = $1', [id])).rows[0] : undefined;
    if (!inv) throw notFound('Invoice not found');
    await invoiceInScope(req, id);
    const b = req.body as { days?: number; suspendAt?: string };
    // From the later of now and the current deadline: "+7 days" always means seven more days of service.
    const base = Math.max(Date.now(), new Date(inv.suspend_at).getTime());
    const suspendAt = b.days !== undefined ? new Date(base + b.days * DAY_MS) : new Date(`${b.suspendAt}T23:59:59Z`);
    const out = await extendInvoiceDeadline(id, suspendAt);
    await writePlatformAudit(req, out.after.network_id, {
      action: 'invoice.extend', entityType: 'platform_invoice', entityId: id,
      before: { suspendAt: out.before.suspend_at }, after: { number: out.after.number, suspendAt: out.after.suspend_at, ...out.settled },
    });
    sendOk(res, { invoice: out.after, ...out.settled });
  }));

  r.post('/invoices/:id/void', requirePerm('billing', 'full'), validateBody(voidInvoiceSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Invoice not found');
    await invoiceInScope(req, id);
    const out = await voidInvoice(id, (req.body as { reason: string }).reason);
    await writePlatformAudit(req, out.after.network_id, {
      action: 'invoice.void', entityType: 'platform_invoice', entityId: id,
      before: { status: out.before.status }, after: { number: out.after.number, reason: out.after.void_reason, ...out.settled },
    });
    sendOk(res, { invoice: out.after, ...out.settled });
  }));

  // ---------- Billing settings + run ----------
  r.get('/settings/billing', requirePerm('settings', 'read'), asyncHandler(async (_req, res) => { sendOk(res, await billingSettings()); }));

  r.put('/settings/billing', requirePerm('settings', 'full'), validateBody(billingSettingsSchema), asyncHandler(async (req, res) => {
    const before = await billingSettings();
    const after = await saveBillingSettings(req.body as z.infer<typeof billingSettingsSchema>, adminId(req));
    await writePlatformAudit(req, null, { action: 'settings.billing', entityType: 'platform_settings', entityId: 'billing', before, after });
    sendOk(res, after);
  }));

  // The worker runs this every 15 minutes; a Super Admin can run it now (e.g. right after a change).
  r.post('/billing/run', requirePerm('billing', 'full'), asyncHandler(async (req, res) => {
    const result = await runBilling();
    await writePlatformAudit(req, null, { action: 'billing.run', entityType: 'billing', after: result });
    sendOk(res, result);
  }));

  return r;
}
