/**
 * Manage Invoices (Partners › Invoices) — Accounts Payable invoices generated for a Partner over a
 * billing period. `billedAmount` is computed once at creation time by summing ledger_entries for
 * that publisher within the period (same credit-minus-debit formula the old /api/invoices
 * aggregation used) and then stored as a snapshot, matching how a real invoice locks in an amount
 * once issued rather than drifting as new ledger entries land. The reference's per-invoice "Details"
 * line-item table (freely-editable, hand-typed items) has no honest equivalent in this app's data
 * model, so the detail page instead exposes a read-only breakdown of the real ledger_entries rows
 * that made up the snapshot (GET /:id/ledger) — real data instead of fabricated line items.
 * Tenant-scoped by network_id (§3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { AppError, notFound, badRequest, conflict } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { pool, query } from '../../../lib/db/pool.js';
import { settleInvoice } from '../../../lib/ledger/ledger.js';
import { notifyPayoutSent } from '../../../lib/email/notifications.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { dateOnly } from '../../../lib/date-only.js';
import {
  liveInvoice, voidSchema, invoiceCurrency, deleteRefusal, notUnpaidRefusal, activityByCurrency, resolveInvoiceCurrency,
} from '../../../lib/invoices/lifecycle.js';
import { sendTransactional, networkName } from '../../../lib/email/transactional.js';
import { invoiceIssuedEmail } from '../../../lib/email/templates.js';
import { portalLoginUrl } from '../../../lib/portal-invite.js';

const TABLE = 'partner_invoices';

interface Row {
  id: string; ref: string; publisher_id: string; status: string; visible_to_partner: boolean;
  payment_terms: string | null; payment_method: string | null; currency: string;
  period_start: string | Date; period_end: string | Date;
  billed_amount: string; payments_amount: string; paid_at: string | null;
  public_notes: string | null; internal_notes: string | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row { publisher_ref: number; publisher_name: string; balance: string }


const dto = (r: JoinedRow) => ({
  id: r.id, ref: Number(r.ref),
  publisherId: r.publisher_id, publisherRef: r.publisher_ref, publisherName: r.publisher_name,
  status: r.status, visibleToPartner: r.visible_to_partner,
  paymentTerms: r.payment_terms, paymentMethod: r.payment_method, currency: r.currency,
  periodStart: dateOnly(r.period_start), periodEnd: dateOnly(r.period_end),
  billedAmount: r.billed_amount, paymentsAmount: r.payments_amount,
  balance: r.balance,
  paidAt: r.paid_at, publicNotes: r.public_notes, internalNotes: r.internal_notes,
  voidedAt: r.voided_at, voidedBy: r.voided_by, voidReason: r.void_reason,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'invoice', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const SELECT = `
  SELECT i.*, p.ref AS publisher_ref, p.name AS publisher_name,
         (i.billed_amount - i.payments_amount)::numeric(14,2)::text AS balance
    FROM partner_invoices i
    JOIN publishers p ON p.id = i.publisher_id AND p.network_id = i.network_id
`;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const createSchema = z.object({
  publisherId: z.string().uuid(),
  periodStart: dateStr,
  periodEnd: dateStr,
  // One invoice per currency (O4) — omitted: the only currency the partner earned in that period.
  currency: invoiceCurrency.optional(),
  visibleToPartner: z.boolean().default(true),
  paymentTerms: z.string().max(50).nullable().optional(),
  publicNotes: z.string().max(2000).nullable().optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
}).refine((b) => b.periodEnd >= b.periodStart, { message: 'periodEnd must be on or after periodStart', path: ['periodEnd'] });

const updateSchema = z.object({
  visibleToPartner: z.boolean().optional(),
  paymentTerms: z.string().max(50).nullable().optional(),
  publicNotes: z.string().max(2000).nullable().optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
});

/** What the partner earned in the period: earnings minus reversals ± adjustments, in the invoice
 * currency. Payout-run debits are settlements, not activity, so they're excluded — otherwise a
 * period that was already paid out would invoice as ~0. Exact numeric math in Postgres. */
async function billedAmountFor(networkId: string, publisherId: string, currency: string, periodStart: string, periodEnd: string): Promise<string> {
  const { rows } = await query<{ total: string }>(
    `SELECT ROUND(COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0), 2)::text AS total
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2 AND status = 'approved'
        AND entry_type <> 'payout' AND currency = $5
        AND created_at >= $3::date AND created_at < ($4::date + interval '1 day')`,
    [networkId, publisherId, periodStart, periodEnd, currency],
  );
  return rows[0]?.total ?? '0.00';
}

/**
 * Pay one partner invoice (audit F-03): in ONE transaction, lock the invoice row, re-check it is
 * unpaid, settle it in the ledger (a real payout to the partner — see settleInvoice) and mark it paid.
 * Any failure rolls all of it back, so an invoice is never marked paid without its ledger payout, and
 * a balance already paid by a payout run is never paid again.
 */
async function payPartnerInvoice(networkId: string, invoiceId: string, createdBy: string | null): Promise<{ before: Row; after: Row }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query<Row>(
      `SELECT * FROM ${TABLE} WHERE id = $1 AND network_id = $2 FOR UPDATE`, [invoiceId, networkId])).rows[0];
    if (!before) throw notFound('Invoice not found');
    const refused = notUnpaidRefusal(before.status, 'pay');
    if (refused) throw refused;
    const { settled } = await settleInvoice(client, {
      networkId, accountType: 'publisher', accountId: before.publisher_id,
      invoiceId, invoiceRef: before.ref, amount: String(before.billed_amount), currency: before.currency,
      periodStart: dateOnly(before.period_start), periodEnd: dateOnly(before.period_end), createdBy,
    });
    const after = (await client.query<Row>(
      `UPDATE ${TABLE} SET status = 'paid', payments_amount = $3, paid_at = now()
        WHERE id = $1 AND network_id = $2 RETURNING *`, [invoiceId, networkId, settled])).rows[0]!;
    await client.query('COMMIT');
    return { before, after };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Payout Batch Completed → the partner, for a paid invoice (O11). Fire-and-forget. */
function paidEmail(networkId: string, inv: Row): void {
  void notifyPayoutSent(networkId, [{ publisherId: inv.publisher_id, amount: String(inv.payments_amount ?? inv.billed_amount) }], inv.currency, `Invoice #${inv.ref}`);
}

/** A live invoice for this partner + currency whose period overlaps [start, end] — double billing. */
async function overlappingInvoice(networkId: string, publisherId: string, currency: string, start: string, end: string) {
  return (await query<{ ref: string; period_start: string | Date; period_end: string | Date }>(
    `SELECT ref, period_start, period_end FROM ${TABLE}
      WHERE network_id = $1 AND publisher_id = $2 AND currency = $3 AND ${liveInvoice()}
        AND daterange(period_start, period_end, '[]') && daterange($4::date, $5::date, '[]')
      ORDER BY period_start LIMIT 1`,
    [networkId, publisherId, currency, start, end])).rows[0] ?? null;
}

const overlapMessage = (o: { ref: string; period_start: string | Date; period_end: string | Date }, currency: string) =>
  `Invoice #${o.ref} already covers ${dateOnly(o.period_start)} to ${dateOnly(o.period_end)} for this partner in ${currency}. `
  + 'Invoice periods can\'t overlap: choose dates outside it, or void that invoice first.';

const actorOf = (req: import('express').Request): string | null =>
  req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : null;

export function partnerInvoicesRoutes(): Router {
  const r = Router();

  // Totals in the network's default currency (never adds different currencies together).
  r.get('/summary', asyncHandler(async (req, res) => {
    const { rows } = await query<{ currency: string; billed: string; payments: string; balance: string; other: string[] }>(
      `SELECT n.default_currency AS currency,
              COALESCE(SUM(i.billed_amount) FILTER (WHERE i.currency = n.default_currency), 0)::numeric(14,2)::text AS billed,
              COALESCE(SUM(i.payments_amount) FILTER (WHERE i.currency = n.default_currency), 0)::numeric(14,2)::text AS payments,
              COALESCE(SUM(i.billed_amount - i.payments_amount) FILTER (WHERE i.currency = n.default_currency), 0)::numeric(14,2)::text AS balance,
              COALESCE(array_agg(DISTINCT i.currency) FILTER (WHERE i.currency <> n.default_currency), '{}') AS other
         FROM networks n
         LEFT JOIN partner_invoices i ON i.network_id = n.id AND ${liveInvoice('i')}
        WHERE n.id = $1
        GROUP BY n.default_currency`,
      [req.scope!.networkId],
    );
    const s = rows[0];
    // Every currency's own totals (O4) — never added across currencies.
    const byCurrency = (await query<{ currency: string; billed: string; payments: string; balance: string }>(
      `SELECT currency, SUM(billed_amount)::numeric(14,2)::text AS billed, SUM(payments_amount)::numeric(14,2)::text AS payments,
              SUM(billed_amount - payments_amount)::numeric(14,2)::text AS balance
         FROM partner_invoices WHERE network_id = $1 AND ${liveInvoice()} GROUP BY currency ORDER BY currency`,
      [req.scope!.networkId])).rows.map((c) => ({ currency: c.currency, billedAmount: c.billed, paymentsAmount: c.payments, balance: c.balance }));
    sendOk(res, { currency: s?.currency ?? 'USD', billedAmount: s?.billed ?? '0.00', paymentsAmount: s?.payments ?? '0.00', balance: s?.balance ?? '0.00', otherCurrencies: s?.other ?? [], byCurrency });
  }));

  const listQuery = z.object({
    status: z.enum(['all', 'unpaid', 'paid', 'void', 'deleted']).default('unpaid'),
    publisherId: z.string().uuid().optional(),
  });
  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { status: statusParam, publisherId } = res.locals.query as z.infer<typeof listQuery>;
    const params: unknown[] = [networkId];
    let where = 'i.network_id = $1';
    if (statusParam !== 'all') { params.push(statusParam); where += ` AND i.status = $${params.length}`; }
    if (publisherId) { params.push(publisherId); where += ` AND i.publisher_id = $${params.length}`; }
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY i.created_at DESC LIMIT ${LIST_CAP}`, params);
    warnIfCapped(rows, LIST_CAP, 'partner-invoices.list');
    sendOk(res, rows.map(dto));
  }));

  // What an invoice for this partner + period would bill, per currency (O4), and which currencies
  // already have a live invoice overlapping the period — the create form's currency choice.
  const previewQuery = z.object({ publisherId: z.string().uuid(), periodStart: dateStr, periodEnd: dateStr });
  r.get('/preview', validateQuery(previewQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const q = res.locals.query as z.infer<typeof previewQuery>;
    const publisher = await dbForRequest(req).selectOne<{ id: string }>('publishers', { id: q.publisherId });
    if (!publisher) throw badRequest('publisherId does not belong to this network');
    const defaultCurrency = (await query<{ c: string }>('SELECT default_currency AS c FROM networks WHERE id = $1', [networkId])).rows[0]?.c ?? 'USD';
    const activity = await activityByCurrency(networkId, 'publisher', q.publisherId, q.periodStart, q.periodEnd);
    const currencies = await Promise.all(activity.map(async (a) => {
      const o = await overlappingInvoice(networkId, q.publisherId, a.currency, q.periodStart, q.periodEnd);
      return { currency: a.currency, billedAmount: a.amount, overlaps: o ? { ref: Number(o.ref) } : null };
    }));
    sendOk(res, { defaultCurrency, currencies });
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    const publisher = await db.selectOne<{ id: string; payment_method: string | null }>('publishers', { id: b.publisherId });
    if (!publisher) throw badRequest('publisherId does not belong to this network');
    const networkCurrency = (await query<{ c: string }>('SELECT default_currency AS c FROM networks WHERE id = $1', [networkId])).rows[0]?.c ?? 'USD';
    const activity = await activityByCurrency(networkId, 'publisher', b.publisherId, b.periodStart, b.periodEnd);
    const currency = resolveInvoiceCurrency(b.currency, activity, networkCurrency, 'partner');
    const overlap = await overlappingInvoice(networkId, b.publisherId, currency, b.periodStart, b.periodEnd);
    if (overlap) throw conflict(overlapMessage(overlap, currency));
    const billed = await billedAmountFor(networkId, b.publisherId, currency, b.periodStart, b.periodEnd);
    let row: Row;
    try {
      row = await db.insert<Row>(TABLE, {
        publisher_id: b.publisherId, status: 'unpaid', visible_to_partner: b.visibleToPartner,
        payment_terms: b.paymentTerms ?? null, payment_method: publisher.payment_method ?? null,
        currency, period_start: b.periodStart, period_end: b.periodEnd,
        billed_amount: billed, payments_amount: '0',
        public_notes: b.publicNotes ?? null, internal_notes: b.internalNotes ?? null,
      });
    } catch (err) {
      // A concurrent create won the race: the DB exclusion constraint (no overlapping periods) refused this one.
      if ((err as { code?: string }).code !== '23P01') throw err;
      const o = await overlappingInvoice(networkId, b.publisherId, currency, b.periodStart, b.periodEnd);
      throw conflict(o ? overlapMessage(o, currency) : 'Another invoice for this partner already covers part of this period.');
    }
    await writeAudit(req, { action: 'invoice.create', entityType: TABLE, entityId: row.id, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [row.id, networkId]);
    const inv = dto(rows[0]!);
    // F-24: "Partner Invoice Generated" — emailed to the partner when the invoice is visible to them.
    let email: Awaited<ReturnType<typeof sendTransactional>> | null = null;
    if (inv.visibleToPartner) {
      const to = (await query<{ contact_email: string | null }>('SELECT contact_email FROM publishers WHERE id = $1 AND network_id = $2', [b.publisherId, networkId])).rows[0];
      email = await sendTransactional(networkId, 'partner_invoice_generated', [to?.contact_email], invoiceIssuedEmail({
        networkName: await networkName(networkId), recipientName: inv.publisherName, audience: 'partner', ref: inv.ref,
        periodStart: inv.periodStart ?? '', periodEnd: inv.periodEnd ?? '', amount: inv.billedAmount, currency: inv.currency,
        paymentTerms: inv.paymentTerms, notes: inv.publicNotes, loginUrl: portalLoginUrl(),
      }));
    }
    sendOk(res, { ...inv, email }, undefined, 201);
  }));

  const bulkApprovePaySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
  // Each invoice is paid in its own transaction (payPartnerInvoice); one that can't be paid — already
  // paid, not found, or no longer fully open in the ledger — is reported in `skipped` with the reason.
  r.post('/bulk-approve-pay', requireRole('admin', 'manager'), validateBody(bulkApprovePaySchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof bulkApprovePaySchema>;
    const networkId = req.scope!.networkId;
    let updated = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const id of b.ids) {
      try {
        const { before, after } = await payPartnerInvoice(networkId, id, actorOf(req));
        await writeAudit(req, { action: 'invoice.update', entityType: TABLE, entityId: id, before, after });
        paidEmail(networkId, after);
        updated++;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        skipped.push({ id, reason: err.message });
      }
    }
    sendOk(res, { updated, skipped });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [req.params.id, req.scope!.networkId]);
    if (!rows[0]) throw notFound('Invoice not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    if (before.status === 'void' || before.status === 'deleted') throw notUnpaidRefusal(before.status, 'edit')!;
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.visibleToPartner !== undefined) patch['visible_to_partner'] = b.visibleToPartner;
    if (b.paymentTerms !== undefined) patch['payment_terms'] = b.paymentTerms;
    if (b.publicNotes !== undefined) patch['public_notes'] = b.publicNotes;
    if (b.internalNotes !== undefined) patch['internal_notes'] = b.internalNotes;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Invoice not found');
    await writeAudit(req, { action: 'invoice.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.post('/:id/approve-pay', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const { before, after } = await payPartnerInvoice(req.scope!.networkId, req.params.id!, actorOf(req));
    await writeAudit(req, { action: 'invoice.update', entityType: TABLE, entityId: req.params.id, before, after });
    paidEmail(req.scope!.networkId, after);
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  // Invoices are never deleted (O8): a paid one is final, an unpaid one is voided (below).
  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req) => {
    const before = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    throw deleteRefusal(before.status);
  }));

  // Void an unpaid invoice (O8): it stays (number, amounts, history) with who / when / why, and its
  // period is free for a corrected invoice. Paid invoices can't be voided.
  r.post('/:id/void', requireRole('admin', 'manager'), validateBody(voidSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    const refused = notUnpaidRefusal(before.status, 'void');
    if (refused) throw refused;
    const { reason } = req.body as z.infer<typeof voidSchema>;
    const [row] = await db.update<Row>(TABLE, { status: 'void', voided_at: new Date().toISOString(), voided_by: actorOf(req), void_reason: reason }, { id: before.id, status: 'unpaid' });
    if (!row) throw conflict('This invoice changed meanwhile — reload it.');
    await writeAudit(req, { action: 'invoice.void', entityType: TABLE, entityId: before.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [before.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.get('/:id/ledger', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const invoice = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!invoice) throw notFound('Invoice not found');
    const { rows } = await query<{ id: string; entry_type: string; direction: string; amount: string; currency: string; conversion_id: string | null; created_at: string }>(
      `SELECT id, entry_type, direction, amount, currency, conversion_id, created_at
         FROM ledger_entries
        WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2 AND status = 'approved'
          AND currency = $5
          AND created_at >= $3::date AND created_at < ($4::date + interval '1 day')
        ORDER BY created_at DESC LIMIT 500`,
      [req.scope!.networkId, invoice.publisher_id, dateOnly(invoice.period_start), dateOnly(invoice.period_end), invoice.currency],
    );
    sendOk(res, rows.map((e) => ({
      id: e.id, entryType: e.entry_type, direction: e.direction, amount: e.amount, currency: e.currency,
      conversionId: e.conversion_id, createdAt: e.created_at,
    })));
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Invoice not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, TABLE, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}
