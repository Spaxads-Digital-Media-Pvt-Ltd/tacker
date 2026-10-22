/**
 * Manage Invoices (Advertisers › Invoices) — Accounts Receivable invoices generated for an
 * Advertiser over a billing period; the advertiser-side counterpart to Partners' Manage Invoices.
 * billedAmount is computed once at creation time by summing debit ledger_entries for that
 * advertiser within the period (same formula the old /api/invoices aggregation used) and stored as
 * a snapshot. Tenant-scoped by network_id (§3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound, badRequest, conflict } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { pool, query } from '../../../lib/db/pool.js';
import { settleInvoice } from '../../../lib/ledger/ledger.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { dateOnly } from '../../../lib/date-only.js';
import {
  liveInvoice, voidSchema, invoiceCurrency, deleteRefusal, notUnpaidRefusal, activityByCurrency, resolveInvoiceCurrency,
} from '../../../lib/invoices/lifecycle.js';
import { sendTransactional, networkName } from '../../../lib/email/transactional.js';
import { invoiceIssuedEmail } from '../../../lib/email/templates.js';
import { portalLoginUrl } from '../../../lib/portal-invite.js';

const TABLE = 'advertiser_invoices';

interface Row {
  id: string; ref: string; advertiser_id: string; status: string; visible_to_advertiser: boolean;
  payment_terms: string | null; currency: string;
  period_start: string | Date; period_end: string | Date;
  billed_amount: string; paid_amount: string; paid_at: string | null; notes: string | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row { advertiser_ref: number; advertiser_name: string; balance: string }


const dto = (r: JoinedRow) => ({
  id: r.id, ref: Number(r.ref),
  advertiserId: r.advertiser_id, advertiserRef: r.advertiser_ref, advertiserName: r.advertiser_name,
  status: r.status, visibleToAdvertiser: r.visible_to_advertiser,
  paymentTerms: r.payment_terms, currency: r.currency,
  periodStart: dateOnly(r.period_start), periodEnd: dateOnly(r.period_end),
  billedAmount: r.billed_amount, paidAmount: r.paid_amount,
  balance: r.balance,
  paidAt: r.paid_at, notes: r.notes,
  voidedAt: r.voided_at, voidedBy: r.voided_by, voidReason: r.void_reason,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'advertiser-invoice', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const SELECT = `
  SELECT i.*, a.ref AS advertiser_ref, a.name AS advertiser_name,
         (i.billed_amount - i.paid_amount)::numeric(14,2)::text AS balance
    FROM advertiser_invoices i
    JOIN advertisers a ON a.id = i.advertiser_id AND a.network_id = i.network_id
`;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const createSchema = z.object({
  advertiserId: z.string().uuid(),
  periodStart: dateStr,
  periodEnd: dateStr,
  // One invoice per currency (O4) — omitted: the only currency billed in that period, else the
  // advertiser's default currency.
  currency: invoiceCurrency.optional(),
  visibleToAdvertiser: z.boolean().default(true),
  paymentTerms: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine((b) => b.periodEnd >= b.periodStart, { message: 'periodEnd must be on or after periodStart', path: ['periodEnd'] });

const updateSchema = z.object({
  visibleToAdvertiser: z.boolean().optional(),
  paymentTerms: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** Net amount owed for the period: billing debits minus reversal / adjustment credits (a rejected
 * conversion stops being billed), in the invoice currency only. Exact numeric math in Postgres. */
async function billedAmountFor(networkId: string, advertiserId: string, currency: string, periodStart: string, periodEnd: string): Promise<string> {
  const { rows } = await query<{ total: string }>(
    `SELECT ROUND(COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0), 2)::text AS total
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = 'advertiser' AND account_id = $2 AND status = 'approved'
        AND entry_type <> 'receipt' AND currency = $5
        AND created_at >= ($3::date::timestamp AT TIME ZONE 'UTC') AND created_at < (($4::date + interval '1 day') AT TIME ZONE 'UTC')`,
    [networkId, advertiserId, periodStart, periodEnd, currency],
  );
  return rows[0]?.total ?? '0.00';
}

/**
 * Mark one advertiser invoice paid (audit F-03): in ONE transaction, lock the invoice row, re-check
 * it is unpaid, record the payment in the ledger (a 'receipt' credit against the advertiser's billing
 * — see settleInvoice) and mark it paid. Any failure rolls all of it back.
 */
async function payAdvertiserInvoice(networkId: string, invoiceId: string, createdBy: string | null): Promise<{ before: Row; after: Row }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query<Row>(
      `SELECT * FROM ${TABLE} WHERE id = $1 AND network_id = $2 FOR UPDATE`, [invoiceId, networkId])).rows[0];
    if (!before) throw notFound('Invoice not found');
    const refused = notUnpaidRefusal(before.status, 'pay');
    if (refused) throw refused;
    const { settled } = await settleInvoice(client, {
      networkId, accountType: 'advertiser', accountId: before.advertiser_id,
      invoiceId, invoiceRef: before.ref, amount: String(before.billed_amount), currency: before.currency,
      periodStart: dateOnly(before.period_start), periodEnd: dateOnly(before.period_end), createdBy,
    });
    const after = (await client.query<Row>(
      `UPDATE ${TABLE} SET status = 'paid', paid_amount = $3, paid_at = now()
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

/** A live invoice for this advertiser + currency whose period overlaps [start, end] — double billing. */
async function overlappingInvoice(networkId: string, advertiserId: string, currency: string, start: string, end: string) {
  return (await query<{ ref: string; period_start: string | Date; period_end: string | Date }>(
    `SELECT ref, period_start, period_end FROM ${TABLE}
      WHERE network_id = $1 AND advertiser_id = $2 AND currency = $3 AND ${liveInvoice()}
        AND daterange(period_start, period_end, '[]') && daterange($4::date, $5::date, '[]')
      ORDER BY period_start LIMIT 1`,
    [networkId, advertiserId, currency, start, end])).rows[0] ?? null;
}

const overlapMessage = (o: { ref: string; period_start: string | Date; period_end: string | Date }, currency: string) =>
  `Invoice #${o.ref} already covers ${dateOnly(o.period_start)} to ${dateOnly(o.period_end)} for this advertiser in ${currency}. `
  + 'Invoice periods can\'t overlap: choose dates outside it, or void that invoice first.';

export function advertiserInvoicesRoutes(): Router {
  const r = Router();

  // Totals in the network's default currency (never adds amounts in different currencies together);
  // `otherCurrencies` lists invoice currencies left out of these totals.
  r.get('/summary', asyncHandler(async (req, res) => {
    const { rows } = await query<{ currency: string; billed: string; paid: string; balance: string; other: string[] }>(
      `SELECT n.default_currency AS currency,
              COALESCE(SUM(i.billed_amount) FILTER (WHERE i.currency = n.default_currency), 0)::numeric(14,2)::text AS billed,
              COALESCE(SUM(i.paid_amount) FILTER (WHERE i.currency = n.default_currency), 0)::numeric(14,2)::text AS paid,
              COALESCE(SUM(i.billed_amount - i.paid_amount) FILTER (WHERE i.currency = n.default_currency), 0)::numeric(14,2)::text AS balance,
              COALESCE(array_agg(DISTINCT i.currency) FILTER (WHERE i.currency <> n.default_currency), '{}') AS other
         FROM networks n
         LEFT JOIN advertiser_invoices i ON i.network_id = n.id AND ${liveInvoice('i')}
        WHERE n.id = $1
        GROUP BY n.default_currency`,
      [req.scope!.networkId],
    );
    const s = rows[0];
    // Every currency's own totals (O4) — never added across currencies.
    const byCurrency = (await query<{ currency: string; billed: string; paid: string; balance: string }>(
      `SELECT currency, SUM(billed_amount)::numeric(14,2)::text AS billed, SUM(paid_amount)::numeric(14,2)::text AS paid,
              SUM(billed_amount - paid_amount)::numeric(14,2)::text AS balance
         FROM advertiser_invoices WHERE network_id = $1 AND ${liveInvoice()} GROUP BY currency ORDER BY currency`,
      [req.scope!.networkId])).rows.map((c) => ({ currency: c.currency, billedAmount: c.billed, paidAmount: c.paid, balance: c.balance }));
    sendOk(res, { currency: s?.currency ?? 'USD', billedAmount: s?.billed ?? '0.00', paidAmount: s?.paid ?? '0.00', balance: s?.balance ?? '0.00', otherCurrencies: s?.other ?? [], byCurrency });
  }));

  const listQuery = z.object({
    status: z.enum(['all', 'unpaid', 'paid', 'void', 'deleted']).default('unpaid'),
    advertiserId: z.string().uuid().optional(),
  });
  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { status: statusParam, advertiserId } = res.locals.query as z.infer<typeof listQuery>;
    const params: unknown[] = [networkId];
    let where = 'i.network_id = $1';
    if (statusParam !== 'all') { params.push(statusParam); where += ` AND i.status = $${params.length}`; }
    if (advertiserId) { params.push(advertiserId); where += ` AND i.advertiser_id = $${params.length}`; }
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY i.created_at DESC LIMIT ${LIST_CAP}`, params);
    warnIfCapped(rows, LIST_CAP, 'advertiser-invoices.list');
    sendOk(res, rows.map(dto));
  }));

  // What an invoice for this advertiser + period would bill, per currency (O4), and which currencies
  // already have a live invoice overlapping the period — the create form's currency choice.
  const previewQuery = z.object({ advertiserId: z.string().uuid(), periodStart: dateStr, periodEnd: dateStr });
  r.get('/preview', validateQuery(previewQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const q = res.locals.query as z.infer<typeof previewQuery>;
    const advertiser = await dbForRequest(req).selectOne<{ default_currency: string }>('advertisers', { id: q.advertiserId });
    if (!advertiser) throw badRequest('advertiserId does not belong to this network');
    const activity = await activityByCurrency(networkId, 'advertiser', q.advertiserId, q.periodStart, q.periodEnd);
    const currencies = await Promise.all(activity.map(async (a) => {
      const o = await overlappingInvoice(networkId, q.advertiserId, a.currency, q.periodStart, q.periodEnd);
      return { currency: a.currency, billedAmount: a.amount, overlaps: o ? { ref: Number(o.ref) } : null };
    }));
    sendOk(res, { defaultCurrency: advertiser.default_currency || 'USD', currencies });
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    const advertiser = await db.selectOne<{ default_currency: string }>('advertisers', { id: b.advertiserId });
    if (!advertiser) throw badRequest('advertiserId does not belong to this network');
    const activity = await activityByCurrency(networkId, 'advertiser', b.advertiserId, b.periodStart, b.periodEnd);
    const currency = resolveInvoiceCurrency(b.currency, activity, advertiser.default_currency || 'USD', 'advertiser');
    const overlap = await overlappingInvoice(networkId, b.advertiserId, currency, b.periodStart, b.periodEnd);
    if (overlap) throw conflict(overlapMessage(overlap, currency));
    const billed = await billedAmountFor(networkId, b.advertiserId, currency, b.periodStart, b.periodEnd);
    let row: Row;
    try {
      row = await db.insert<Row>(TABLE, {
        advertiser_id: b.advertiserId, status: 'unpaid', visible_to_advertiser: b.visibleToAdvertiser,
        payment_terms: b.paymentTerms ?? null, currency, period_start: b.periodStart, period_end: b.periodEnd,
        billed_amount: billed, paid_amount: '0', notes: b.notes ?? null,
      });
    } catch (err) {
      // A concurrent create won the race: the DB exclusion constraint (no overlapping periods) refused this one.
      if ((err as { code?: string }).code !== '23P01') throw err;
      const o = await overlappingInvoice(networkId, b.advertiserId, currency, b.periodStart, b.periodEnd);
      throw conflict(o ? overlapMessage(o, currency) : 'Another invoice for this advertiser already covers part of this period.');
    }
    await writeAudit(req, { action: 'advertiser-invoice.create', entityType: TABLE, entityId: row.id, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [row.id, networkId]);
    const inv = dto(rows[0]!);
    // F-24: "Advertiser Invoice Generated" — emailed when the invoice is visible to the advertiser. Its
    // single `notes` field may be internal, so it isn't included.
    let email: Awaited<ReturnType<typeof sendTransactional>> | null = null;
    if (inv.visibleToAdvertiser) {
      const to = (await query<{ contact_email: string | null }>('SELECT contact_email FROM advertisers WHERE id = $1 AND network_id = $2', [b.advertiserId, networkId])).rows[0];
      email = await sendTransactional(networkId, 'advertiser_invoice_generated', [to?.contact_email], invoiceIssuedEmail({
        networkName: await networkName(networkId), recipientName: inv.advertiserName, audience: 'advertiser', ref: inv.ref,
        periodStart: inv.periodStart ?? '', periodEnd: inv.periodEnd ?? '', amount: inv.billedAmount, currency: inv.currency,
        paymentTerms: inv.paymentTerms, notes: null, loginUrl: portalLoginUrl(),
      }));
    }
    sendOk(res, { ...inv, email }, undefined, 201);
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
    if (b.visibleToAdvertiser !== undefined) patch['visible_to_advertiser'] = b.visibleToAdvertiser;
    if (b.paymentTerms !== undefined) patch['payment_terms'] = b.paymentTerms;
    if (b.notes !== undefined) patch['notes'] = b.notes;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Invoice not found');
    await writeAudit(req, { action: 'advertiser-invoice.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.post('/:id/pay', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const createdBy = req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : null;
    const { before, after } = await payAdvertiserInvoice(req.scope!.networkId, req.params.id!, createdBy);
    await writeAudit(req, { action: 'advertiser-invoice.update', entityType: TABLE, entityId: req.params.id, before, after });
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
    const actor = req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : null;
    const [row] = await db.update<Row>(TABLE, { status: 'void', voided_at: new Date().toISOString(), voided_by: actor, void_reason: reason }, { id: before.id, status: 'unpaid' });
    if (!row) throw conflict('This invoice changed meanwhile — reload it.');
    await writeAudit(req, { action: 'advertiser-invoice.void', entityType: TABLE, entityId: before.id, before, after: row });
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
        WHERE network_id = $1 AND account_type = 'advertiser' AND account_id = $2 AND status = 'approved'
          AND currency = $5
          AND created_at >= ($3::date::timestamp AT TIME ZONE 'UTC') AND created_at < (($4::date + interval '1 day') AT TIME ZONE 'UTC')
        ORDER BY created_at DESC LIMIT 500`,
      [req.scope!.networkId, invoice.advertiser_id, dateOnly(invoice.period_start), dateOnly(invoice.period_end), invoice.currency],
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
