/**
 * Super Admin › Money — revenue, coupons, discounts, credit notes, invoice export.
 *
 * - /revenue/summary (revenue:read): MRR / ARR / customers / ARPA per currency (live, lib/billing/revenue.ts),
 *   this month's and last month's MRR movements (new, expansion, contraction, churn, reactivation, net), logo
 *   churn this month, LTV (ARPA ÷ average monthly churn of the last 3 months), the 12-month MRR trend (the
 *   last snapshot of each month), cash collected (net of refunds) and invoiced per month, outstanding and
 *   overdue, MRR by plan, top customers, trial → paid (90 days), renewals in the next 30 days.
 * - /coupons (billing:read / full): percent or amount off; once, for N invoices, or forever; max redemptions;
 *   valid until; archive. /networks/:id/discount: apply a coupon to a network (one active), remove it.
 * - /invoices/:id/credit-notes, /credit-notes (billing): credit against a paid invoice (up to what's left of it),
 *   numbered CN-<year>-…, optionally refunded (how / reference).
 * - /invoices.csv (billing:read): the filtered invoices with their lines' totals.
 *
 * An 'assigned' role only its networks.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query, withTransaction } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { csvCell } from '../../lib/csv.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { NETWORK_MRR_SQL, mrrTrend } from '../../lib/billing/revenue.js';
import { requirePerm, assertNetworkInScope, scopedNetworkIds } from './auth.js';
import { UUID_RE, meId, moneyText } from './fields.js';

/** "Valid until 2026-12-31" means through that whole day (UTC); a full date-time is kept as given. */
const validUntil = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a date')
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : new Date(v).toISOString())).nullable().optional();

const couponSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, 'use letters, digits, - and _ (e.g. LAUNCH20)'),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['percent', 'amount']),
  percentOff: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'a percent like 20 or 12.5').optional(),
  amountOff: moneyText.optional(),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  duration: z.enum(['once', 'repeating', 'forever']),
  durationCycles: z.number().int().min(1).max(120).optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  validUntil,
}).strict().superRefine((b, ctx) => {
  if (b.kind === 'percent' && (!b.percentOff || Number(b.percentOff) <= 0 || Number(b.percentOff) > 100)) ctx.addIssue({ code: 'custom', path: ['percentOff'], message: 'Give a percent between 0 and 100' });
  if (b.kind === 'amount' && (!b.amountOff || Number(b.amountOff) <= 0)) ctx.addIssue({ code: 'custom', path: ['amountOff'], message: 'Give the amount off' });
  if (b.kind === 'amount' && !b.currency) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'An amount coupon needs its currency' });
  if (b.duration === 'repeating' && !b.durationCycles) ctx.addIssue({ code: 'custom', path: ['durationCycles'], message: 'How many invoices it applies to' });
});
const couponPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  validUntil,
}).strict();
const creditSchema = z.object({
  amount: moneyText.optional(),
  reason: z.string().trim().min(1).max(500),
  refunded: z.boolean().default(false),
  refundMethod: z.enum(['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other']).optional(),
  refundReference: z.string().trim().max(200).optional(),
}).strict();
const csvSchema = z.object({
  status: z.enum(['open', 'overdue', 'paid', 'void', 'all']).default('all'),
  networkId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export function revenueRoutes(): Router {
  const r = Router();

  r.get('/revenue/summary', requirePerm('revenue', 'read'), asyncHandler(async (req, res) => {
    const ids = await scopedNetworkIds(req);
    const p = [ids];
    const inScope = (col: string) => `($1::uuid[] IS NULL OR ${col} = ANY($1::uuid[]))`;
    const months = `generate_series(date_trunc('month', now(), 'UTC') - interval '11 months', date_trunc('month', now(), 'UTC'), interval '1 month')`;
    const [mrr, moves, trend, churn, collected, invoiced, outstanding, byPlan, top, trials, renewals, since] = await Promise.all([
      query(`SELECT m.currency, SUM(m.mrr)::text AS amount, (SUM(m.mrr) * 12)::text AS arr, COUNT(*)::int AS customers,
                    round(SUM(m.mrr) / COUNT(*), 2)::text AS arpa
               FROM (${NETWORK_MRR_SQL}) m WHERE m.mrr > 0 AND ${inScope('m.network_id')} GROUP BY m.currency ORDER BY m.currency`, p),
      query(`SELECT CASE WHEN day >= (date_trunc('month', now(), 'UTC') AT TIME ZONE 'UTC')::date THEN 'this' ELSE 'last' END AS month, currency,
                    COALESCE(SUM(amount) FILTER (WHERE kind = 'new'), 0)::text AS new,
                    COALESCE(SUM(amount) FILTER (WHERE kind = 'expansion'), 0)::text AS expansion,
                    COALESCE(SUM(amount) FILTER (WHERE kind = 'contraction'), 0)::text AS contraction,
                    COALESCE(SUM(amount) FILTER (WHERE kind = 'churn'), 0)::text AS churn,
                    COALESCE(SUM(amount) FILTER (WHERE kind = 'reactivation'), 0)::text AS reactivation,
                    SUM(amount)::text AS net,
                    COUNT(*) FILTER (WHERE kind = 'new')::int AS new_count, COUNT(*) FILTER (WHERE kind = 'churn')::int AS churn_count
               FROM platform_mrr_movements WHERE day >= ((date_trunc('month', now(), 'UTC') - interval '1 month') AT TIME ZONE 'UTC')::date AND ${inScope('network_id')}
              GROUP BY 1, currency ORDER BY 1 DESC, currency`, p),
      mrrTrend(ids),
      // Logo churn per month (3 complete + this): customers churned ÷ paying at the month's start.
      query(`SELECT to_char(mo AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
                    (SELECT COUNT(DISTINCT s.network_id) FROM platform_mrr_snapshots s
                      WHERE s.day = (SELECT max(day) FROM platform_mrr_days WHERE day < (mo AT TIME ZONE 'UTC')::date) AND ${inScope('s.network_id')})::int AS at_start,
                    (SELECT COUNT(DISTINCT m.network_id) FROM platform_mrr_movements m
                      WHERE m.kind = 'churn' AND m.day >= (mo AT TIME ZONE 'UTC')::date AND m.day < ((mo + interval '1 month') AT TIME ZONE 'UTC')::date AND ${inScope('m.network_id')})::int AS churned
               FROM generate_series(date_trunc('month', now(), 'UTC') - interval '3 months', date_trunc('month', now(), 'UTC'), interval '1 month') mo ORDER BY mo`, p),
      query(`SELECT to_char(mo AT TIME ZONE 'UTC', 'YYYY-MM') AS month, x.currency, COALESCE(SUM(x.amount), 0)::text AS amount, COALESCE(SUM(x.refunded), 0)::text AS refunded
               FROM ${months} mo JOIN LATERAL (
                 SELECT i.currency, i.paid_amount AS amount, 0::numeric AS refunded FROM platform_invoices i
                  WHERE i.status = 'paid' AND i.paid_at >= mo AND i.paid_at < mo + interval '1 month' AND ${inScope('i.network_id')}
                 UNION ALL
                 SELECT c.currency, -c.amount, c.amount FROM platform_credit_notes c
                  WHERE c.refunded AND c.created_at >= mo AND c.created_at < mo + interval '1 month' AND ${inScope('c.network_id')}) x ON true
              GROUP BY 1, x.currency ORDER BY 1, x.currency`, p),
      query(`SELECT to_char(i.issued_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, i.currency, SUM(i.total)::text AS amount, COUNT(*)::int AS invoices
               FROM platform_invoices i WHERE i.status <> 'void' AND i.issued_at >= date_trunc('month', now(), 'UTC') - interval '11 months' AND ${inScope('i.network_id')}
              GROUP BY 1, i.currency ORDER BY 1, i.currency`, p),
      query(`SELECT i.currency, COALESCE(SUM(i.total), 0)::text AS open, COALESCE(SUM(i.total) FILTER (WHERE i.due_at <= now()), 0)::text AS overdue,
                    COUNT(*)::int AS open_count
               FROM platform_invoices i WHERE i.status = 'open' AND ${inScope('i.network_id')} GROUP BY i.currency ORDER BY i.currency`, p),
      query(`SELECT m.plan_id, m.plan_name, m.currency, COUNT(*)::int AS customers, SUM(m.mrr)::text AS mrr
               FROM (${NETWORK_MRR_SQL}) m WHERE m.mrr > 0 AND ${inScope('m.network_id')} GROUP BY m.plan_id, m.plan_name, m.currency ORDER BY SUM(m.mrr) DESC`, p),
      query(`SELECT m.network_id, n.name, m.currency, m.mrr::text AS mrr, m.plan_name
               FROM (${NETWORK_MRR_SQL}) m JOIN networks n ON n.id = m.network_id WHERE m.mrr > 0 AND ${inScope('m.network_id')}
              ORDER BY m.mrr DESC LIMIT 10`, p),
      query(`SELECT COUNT(*)::int AS ended, COUNT(*) FILTER (WHERE s.status IN ('active', 'past_due'))::int AS converted
               FROM subscriptions s JOIN networks n ON n.id = s.network_id
              WHERE s.trial_ends_at >= now() - interval '90 days' AND s.trial_ends_at < now() AND n.status <> 'deleted' AND ${inScope('s.network_id')}`, p),
      query(`SELECT s.network_id, n.name, s.current_period_end AS renews_at, p.name AS plan_name, p.currency,
                    (p.price_cents::numeric / 100)::text AS amount, s.cancel_at_period_end
               FROM subscriptions s JOIN networks n ON n.id = s.network_id JOIN subscription_plans p ON p.id = s.plan_id
              WHERE s.status IN ('active', 'past_due') AND p.price_cents > 0 AND n.status <> 'deleted'
                AND s.current_period_end < now() + interval '30 days' AND ${inScope('s.network_id')}
              ORDER BY s.current_period_end LIMIT 20`, p),
      query<{ since: string | null }>(`SELECT min(day)::text AS since FROM platform_mrr_days`),
    ]);
    const churnRows = churn.rows as { month: string; at_start: number; churned: number }[];
    const complete = churnRows.slice(0, 3).filter((c) => c.at_start > 0);
    const avgChurn = complete.length ? complete.reduce((n, c) => n + c.churned / c.at_start, 0) / complete.length : null;
    const t = trials.rows[0] as { ended: number; converted: number };
    // Lifetime value: ARPA ÷ average monthly logo churn (last 3 complete months), in SQL numeric — null without churn history.
    const ltv = avgChurn
      ? (await query<{ currency: string; amount: string }>(
        `SELECT m.currency, round((SUM(m.mrr) / COUNT(*)) / $2::numeric, 2)::text AS amount
           FROM (${NETWORK_MRR_SQL}) m WHERE m.mrr > 0 AND ($1::uuid[] IS NULL OR m.network_id = ANY($1::uuid[])) GROUP BY m.currency ORDER BY m.currency`,
        [ids, avgChurn.toFixed(6)])).rows.map((x) => ({ ...x, avgMonthlyChurnPct: Math.round(avgChurn * 1000) / 10 }))
      : null;
    sendOk(res, {
      mrr: mrr.rows,
      movements: { thisMonth: moves.rows.filter((m) => m['month'] === 'this'), lastMonth: moves.rows.filter((m) => m['month'] === 'last') },
      trend,
      churn: churnRows.map((c) => ({ ...c, rate: c.at_start ? Math.round((c.churned / c.at_start) * 1000) / 10 : null })),
      ltv,
      collected: collected.rows,
      invoiced: invoiced.rows,
      outstanding: outstanding.rows,
      byPlan: byPlan.rows,
      topCustomers: top.rows,
      trialConversion: { ended: t.ended, converted: t.converted, rate: t.ended ? Math.round((t.converted / t.ended) * 100) : null },
      renewals: renewals.rows,
      historySince: since.rows[0]?.since ?? null,
    });
  }));

  // ---------- Coupons ----------
  r.get('/coupons', requirePerm('billing', 'read'), validateQuery(z.object({ status: z.enum(['active', 'archived', 'all']).default('active') }).strict()), asyncHandler(async (_req, res) => {
    const { status } = res.locals.query as { status: string };
    const { rows } = await query(
      `SELECT c.*, c.percent_off::text AS percent_off, c.amount_off::text AS amount_off,
              (SELECT COUNT(*) FROM subscription_discounts d WHERE d.coupon_id = c.id AND d.ended_at IS NULL)::int AS active_discounts
         FROM platform_coupons c WHERE ($1 = 'all' OR c.status = $1) ORDER BY c.created_at DESC`, [status]);
    sendOk(res, rows);
  }));

  r.post('/coupons', requirePerm('billing', 'full'), validateBody(couponSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof couponSchema>;
    try {
      const { rows } = await query(
        `INSERT INTO platform_coupons (code, name, kind, percent_off, amount_off, currency, duration, duration_cycles, max_redemptions, valid_until, created_by)
         VALUES (upper($1), $2, $3, $4::numeric, $5::numeric, $6, $7, $8, $9, $10::timestamptz, $11) RETURNING *, percent_off::text AS percent_off, amount_off::text AS amount_off`,
        [b.code, b.name, b.kind, b.kind === 'percent' ? b.percentOff : null, b.kind === 'amount' ? b.amountOff : null, b.kind === 'amount' ? b.currency : null,
          b.duration, b.duration === 'repeating' ? b.durationCycles : null, b.maxRedemptions ?? null, b.validUntil ?? null, meId(req)]);
      await writePlatformAudit(req, null, { action: 'coupon.create', entityType: 'platform_coupon', entityId: rows[0]!['id'] as string, after: rows[0] });
      sendOk(res, rows[0], undefined, 201);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw badRequest(`A coupon with the code ${b.code.toUpperCase()} already exists.`);
      throw err;
    }
  }));

  r.patch('/coupons/:id', requirePerm('billing', 'full'), validateBody(couponPatchSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const b = req.body as z.infer<typeof couponPatchSchema>;
    const sets: string[] = []; const params: unknown[] = [];
    const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    if (b.name !== undefined) set('name', b.name);
    if (b.status !== undefined) set('status', b.status);
    if (b.maxRedemptions !== undefined) set('max_redemptions', b.maxRedemptions);
    if (b.validUntil !== undefined) set('valid_until', b.validUntil, '::timestamptz');
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    const row = UUID_RE.test(id) ? (await query(`UPDATE platform_coupons SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *, percent_off::text AS percent_off, amount_off::text AS amount_off`, params)).rows[0] : undefined;
    if (!row) throw notFound('Coupon not found');
    await writePlatformAudit(req, null, { action: 'coupon.update', entityType: 'platform_coupon', entityId: id, after: row });
    sendOk(res, row);
  }));

  // ---------- A network's discount ----------
  r.get('/networks/:id/discount', requirePerm('billing', 'read'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const { rows } = await query(
      `SELECT d.id, d.cycles_left, d.applied_at, c.id AS coupon_id, c.code, c.name, c.kind, c.percent_off::text AS percent_off,
              c.amount_off::text AS amount_off, c.currency, c.duration, COALESCE(pa.name, pa.email) AS applied_by_name
         FROM subscription_discounts d JOIN platform_coupons c ON c.id = d.coupon_id LEFT JOIN platform_admins pa ON pa.id = d.applied_by
        WHERE d.network_id = $1 AND d.ended_at IS NULL`, [id]);
    sendOk(res, rows[0] ?? null);
  }));

  r.post('/networks/:id/discount', requirePerm('billing', 'full'), validateBody(z.object({ code: z.string().trim().min(1).max(40) }).strict()), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id) || !(await query('SELECT 1 FROM networks WHERE id = $1', [id])).rows[0]) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const code = (req.body as { code: string }).code;
    const out = await withTransaction(async (c) => {
      const coupon = (await c.query<{ id: string; name: string; kind: string; currency: string | null; duration: string; duration_cycles: number | null;
        max_redemptions: number | null; redeemed: number; valid_until: Date | null; status: string }>(
        'SELECT * FROM platform_coupons WHERE upper(code) = upper($1) FOR UPDATE', [code])).rows[0];
      if (!coupon) throw notFound(`No coupon with the code ${code.toUpperCase()}.`);
      if (coupon.status !== 'active') throw conflict(`The coupon ${code.toUpperCase()} is archived.`);
      if (coupon.valid_until && coupon.valid_until < new Date()) throw conflict(`The coupon ${code.toUpperCase()} expired on ${coupon.valid_until.toISOString().slice(0, 10)}.`);
      if (coupon.max_redemptions !== null && coupon.redeemed >= coupon.max_redemptions) throw conflict(`The coupon ${code.toUpperCase()} has been used ${coupon.redeemed} time(s) — its limit.`);
      if (coupon.kind === 'amount') {
        const planCurrency = (await c.query<{ currency: string }>(
          `SELECT p.currency FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.network_id = $1`, [id])).rows[0]?.currency;
        if (planCurrency && planCurrency.toUpperCase() !== (coupon.currency ?? '').toUpperCase()) {
          throw new AppError('conflict', `The coupon is in ${coupon.currency}, the network's plan in ${planCurrency} — it wouldn't apply.`, { reason: 'currency' });
        }
      }
      const before = (await c.query('UPDATE subscription_discounts SET ended_at = now() WHERE network_id = $1 AND ended_at IS NULL RETURNING id', [id])).rows[0] ?? null;
      const row = (await c.query(
        `INSERT INTO subscription_discounts (network_id, coupon_id, cycles_left, applied_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, coupon.id, coupon.duration === 'repeating' ? coupon.duration_cycles : coupon.duration === 'once' ? 1 : null, meId(req)])).rows[0]!;
      await c.query('UPDATE platform_coupons SET redeemed = redeemed + 1 WHERE id = $1', [coupon.id]);
      return { discount: row, replaced: before, coupon: coupon.name };
    });
    await writePlatformAudit(req, id, { action: 'discount.apply', entityType: 'subscription_discount', entityId: out.discount['id'] as string, after: { code: code.toUpperCase(), replaced: out.replaced } });
    sendOk(res, out.discount, undefined, 201);
  }));

  r.delete('/networks/:id/discount', requirePerm('billing', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const row = (await query('UPDATE subscription_discounts SET ended_at = now() WHERE network_id = $1 AND ended_at IS NULL RETURNING id', [id])).rows[0];
    if (!row) throw notFound('This network has no discount.');
    await writePlatformAudit(req, id, { action: 'discount.remove', entityType: 'subscription_discount', entityId: row['id'] as string });
    sendOk(res, { removed: true });
  }));

  // ---------- Credit notes ----------
  r.post('/invoices/:id/credit-notes', requirePerm('billing', 'full'), validateBody(creditSchema), asyncHandler(async (req, res) => {
    const invoiceId = req.params.id!;
    if (!UUID_RE.test(invoiceId)) throw notFound('Invoice not found');
    const b = req.body as z.infer<typeof creditSchema>;
    const note = await withTransaction(async (c) => {
      const inv = (await c.query<{ id: string; number: string; network_id: string; status: string; total: string; currency: string; credited: string; left: string }>(
        `SELECT i.id, i.number, i.network_id, i.status, i.total::text, i.currency,
                COALESCE((SELECT SUM(amount) FROM platform_credit_notes WHERE invoice_id = i.id), 0)::text AS credited,
                (i.total - COALESCE((SELECT SUM(amount) FROM platform_credit_notes WHERE invoice_id = i.id), 0))::text AS left
           FROM platform_invoices i WHERE i.id = $1 FOR UPDATE`, [invoiceId])).rows[0];
      if (!inv) throw notFound('Invoice not found');
      await assertNetworkInScope(req, inv.network_id);
      if (inv.status !== 'paid') throw conflict(`Credit notes are for paid invoices — ${inv.number} is ${inv.status}${inv.status === 'open' ? ' (void it, or record a lower payment)' : ''}.`);
      const amount = b.amount ?? inv.left;
      if (Number(inv.left) <= 0) throw conflict(`${inv.number} is fully credited already.`);
      const over = (await c.query<{ over: boolean }>('SELECT $1::numeric > $2::numeric AS over', [amount, inv.left])).rows[0]!.over;
      if (over) throw badRequest(`At most ${inv.currency} ${inv.left} is left to credit on ${inv.number}.`);
      if (Number(amount) <= 0) throw badRequest('The credit must be more than 0.');
      const seq = (await c.query<{ n: string }>(`SELECT nextval('platform_credit_note_seq')::text AS n`)).rows[0]!.n;
      const number = `CN-${new Date().getUTCFullYear()}-${seq.padStart(5, '0')}`;
      return (await c.query(
        `INSERT INTO platform_credit_notes (number, invoice_id, network_id, amount, currency, reason, refunded, refund_method, refund_reference, created_by)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10) RETURNING *, amount::text AS amount`,
        [number, inv.id, inv.network_id, amount, inv.currency, b.reason, b.refunded, b.refunded ? b.refundMethod ?? null : null,
          b.refunded ? b.refundReference ?? null : null, meId(req)])).rows[0]!;
    });
    await writePlatformAudit(req, note['network_id'] as string, { action: 'invoice.credit_note', entityType: 'platform_credit_note', entityId: note['id'] as string, after: note });
    sendOk(res, note, undefined, 201);
  }));

  r.get('/credit-notes', requirePerm('billing', 'read'), validateQuery(paginationSchema.extend({ networkId: z.string().uuid().optional() }).strict()), asyncHandler(async (req, res) => {
    const f = res.locals.query as { limit: number; offset: number; networkId?: string };
    const ids = await scopedNetworkIds(req);
    const { rows } = await query(
      `SELECT c.*, c.amount::text AS amount, i.number AS invoice_number, COALESCE(n.name, i.bill_to->>'name') AS network_name, COALESCE(pa.name, pa.email) AS created_by_name
         FROM platform_credit_notes c JOIN platform_invoices i ON i.id = c.invoice_id LEFT JOIN networks n ON n.id = c.network_id
         LEFT JOIN platform_admins pa ON pa.id = c.created_by
        WHERE ($1::uuid IS NULL OR c.network_id = $1) AND ($2::uuid[] IS NULL OR c.network_id = ANY($2::uuid[]))
        ORDER BY c.created_at DESC LIMIT $3 OFFSET $4`, [f.networkId ?? null, ids, f.limit, f.offset]);
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  // ---------- Invoice export ----------
  r.get('/invoices.csv', requirePerm('billing', 'read'), validateQuery(csvSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof csvSchema>;
    const ids = await scopedNetworkIds(req);
    const { rows } = await query(
      `SELECT i.number, i.issued_at, i.due_at, COALESCE(n.name, i.bill_to->>'name') AS network, i.bill_to->>'slug' AS slug, i.description, i.currency,
              i.subtotal::text, i.tax_rate::text, i.tax::text, i.total::text, i.status, (i.status = 'open' AND i.due_at <= now()) AS overdue,
              i.paid_at, i.paid_amount::text, i.payment_method, i.payment_reference, i.voided_at, i.void_reason,
              COALESCE((SELECT SUM(amount) FROM platform_credit_notes c WHERE c.invoice_id = i.id), 0)::text AS credited
         FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id
        WHERE ($1 = 'all' OR ($1 = 'overdue' AND i.status = 'open' AND i.due_at <= now()) OR ($1 <> 'overdue' AND i.status = $1))
          AND ($2::uuid IS NULL OR i.network_id = $2)
          AND ($3::text IS NULL OR i.number ILIKE $3 ESCAPE '\\' OR i.bill_to->>'name' ILIKE $3 ESCAPE '\\')
          AND ($4::date IS NULL OR i.issued_at >= $4::date::timestamp AT TIME ZONE 'UTC') AND ($5::date IS NULL OR i.issued_at < ($5::date + 1)::timestamp AT TIME ZONE 'UTC')
          AND ($6::uuid[] IS NULL OR i.network_id = ANY($6::uuid[]))
        ORDER BY i.issued_at DESC LIMIT 20000`,
      [f.status, f.networkId ?? null, f.q ? containsPattern(f.q) : null, f.from ?? null, f.to ?? null, ids]);
    const cols = ['number', 'issued_at', 'due_at', 'network', 'slug', 'description', 'currency', 'subtotal', 'tax_rate', 'tax', 'total', 'status', 'overdue',
      'paid_at', 'paid_amount', 'payment_method', 'payment_reference', 'credited', 'voided_at', 'void_reason'];
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`${cols.join(',')}\n${rows.map((row) => cols.map((c) => csvCell(row[c])).join(',')).join('\n')}${rows.length ? '\n' : ''}`);
    await writePlatformAudit(req, null, { action: 'invoice.export', entityType: 'platform_invoice', after: { rows: rows.length, filters: f } });
  }));

  return r;
}
