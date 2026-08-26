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
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'partner_invoices';

interface Row {
  id: string; ref: string; publisher_id: string; status: string; visible_to_partner: boolean;
  payment_terms: string | null; payment_method: string | null; currency: string;
  period_start: string | Date; period_end: string | Date;
  billed_amount: string; payments_amount: string; paid_at: string | null;
  public_notes: string | null; internal_notes: string | null;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row { publisher_ref: number; publisher_name: string }

/** node-pg parses `date` columns into JS Date objects at LOCAL midnight, not strings — normalize
 * with local getters (never toISOString/UTC, which can shift the day by the server's UTC offset). */
function toDateStr(v: string | Date): string {
  if (!(v instanceof Date)) return v;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

const dto = (r: JoinedRow) => ({
  id: r.id, ref: Number(r.ref),
  publisherId: r.publisher_id, publisherRef: r.publisher_ref, publisherName: r.publisher_name,
  status: r.status, visibleToPartner: r.visible_to_partner,
  paymentTerms: r.payment_terms, paymentMethod: r.payment_method, currency: r.currency,
  periodStart: toDateStr(r.period_start), periodEnd: toDateStr(r.period_end),
  billedAmount: r.billed_amount, paymentsAmount: r.payments_amount,
  balance: (Number(r.billed_amount) - Number(r.payments_amount)).toFixed(2),
  paidAt: r.paid_at, publicNotes: r.public_notes, internalNotes: r.internal_notes,
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
  SELECT i.*, p.ref AS publisher_ref, p.name AS publisher_name
    FROM partner_invoices i
    JOIN publishers p ON p.id = i.publisher_id AND p.network_id = i.network_id
`;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const createSchema = z.object({
  publisherId: z.string().uuid(),
  periodStart: dateStr,
  periodEnd: dateStr,
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

async function billedAmountFor(networkId: string, publisherId: string, periodStart: string, periodEnd: string): Promise<string> {
  const { rows } = await query<{ total: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS total
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2 AND status = 'approved'
        AND created_at >= $3::date AND created_at < ($4::date + interval '1 day')`,
    [networkId, publisherId, periodStart, periodEnd],
  );
  return rows[0]?.total ?? '0';
}

export function partnerInvoicesRoutes(): Router {
  const r = Router();

  r.get('/summary', asyncHandler(async (req, res) => {
    const { rows } = await query<{ billed: string; payments: string }>(
      `SELECT COALESCE(SUM(billed_amount), 0)::text AS billed, COALESCE(SUM(payments_amount), 0)::text AS payments
         FROM partner_invoices WHERE network_id = $1 AND status != 'deleted'`,
      [req.scope!.networkId],
    );
    const billed = Number(rows[0]?.billed ?? 0);
    const payments = Number(rows[0]?.payments ?? 0);
    sendOk(res, { billedAmount: billed.toFixed(2), paymentsAmount: payments.toFixed(2), balance: (billed - payments).toFixed(2) });
  }));

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'unpaid');
    const publisherId = req.query['publisherId'] ? String(req.query['publisherId']) : null;
    const params: unknown[] = [networkId];
    let where = 'i.network_id = $1';
    if (statusParam !== 'all') { params.push(statusParam); where += ` AND i.status = $${params.length}`; }
    if (publisherId) { params.push(publisherId); where += ` AND i.publisher_id = $${params.length}`; }
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY i.created_at DESC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    const publisher = await db.selectOne<{ id: string; payment_method: string | null }>('publishers', { id: b.publisherId });
    if (!publisher) throw badRequest('publisherId does not belong to this network');
    const billed = await billedAmountFor(networkId, b.publisherId, b.periodStart, b.periodEnd);
    const row = await db.insert<Row>(TABLE, {
      publisher_id: b.publisherId, status: 'unpaid', visible_to_partner: b.visibleToPartner,
      payment_terms: b.paymentTerms ?? null, payment_method: publisher.payment_method ?? null,
      currency: 'USD', period_start: b.periodStart, period_end: b.periodEnd,
      billed_amount: billed, payments_amount: '0',
      public_notes: b.publicNotes ?? null, internal_notes: b.internalNotes ?? null,
    });
    await writeAudit(req, { action: 'invoice.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [row.id, networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  const bulkApprovePaySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
  r.post('/bulk-approve-pay', requireRole('admin', 'manager'), validateBody(bulkApprovePaySchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof bulkApprovePaySchema>;
    let updated = 0;
    for (const id of b.ids) {
      const before = await db.selectOne<Row>(TABLE, { id });
      if (!before || before.status !== 'unpaid') continue;
      const [row] = await db.update<Row>(TABLE, { status: 'paid', payments_amount: before.billed_amount, paid_at: new Date() }, { id });
      if (row) {
        await writeAudit(req, { action: 'invoice.update', entityType: TABLE, entityId: id, before, after: row });
        updated++;
      }
    }
    sendOk(res, { updated });
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
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    if (before.status !== 'unpaid') throw badRequest('Only unpaid invoices can be approved and paid');
    const [row] = await db.update<Row>(TABLE, { status: 'paid', payments_amount: before.billed_amount, paid_at: new Date() }, { id: req.params.id });
    await writeAudit(req, { action: 'invoice.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    const [row] = await db.update<Row>(TABLE, { status: 'deleted' }, { id: req.params.id });
    await writeAudit(req, { action: 'invoice.delete', entityType: TABLE, entityId: req.params.id, before, after: row });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/ledger', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const invoice = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!invoice) throw notFound('Invoice not found');
    const { rows } = await query<{ id: string; entry_type: string; direction: string; amount: string; currency: string; conversion_id: string | null; created_at: string }>(
      `SELECT id, entry_type, direction, amount, currency, conversion_id, created_at
         FROM ledger_entries
        WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2 AND status = 'approved'
          AND created_at >= $3::date AND created_at < ($4::date + interval '1 day')
        ORDER BY created_at DESC LIMIT 500`,
      [req.scope!.networkId, invoice.publisher_id, toDateStr(invoice.period_start), toDateStr(invoice.period_end)],
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
