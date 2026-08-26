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
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'advertiser_invoices';

interface Row {
  id: string; ref: string; advertiser_id: string; status: string; visible_to_advertiser: boolean;
  payment_terms: string | null; currency: string;
  period_start: string | Date; period_end: string | Date;
  billed_amount: string; paid_amount: string; paid_at: string | null; notes: string | null;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row { advertiser_ref: number; advertiser_name: string }

/** node-pg parses `date` columns into JS Date objects at LOCAL midnight, not strings — normalize
 * with local getters (never toISOString/UTC, which can shift the day by the server's UTC offset). */
function toDateStr(v: string | Date): string {
  if (!(v instanceof Date)) return v;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

const dto = (r: JoinedRow) => ({
  id: r.id, ref: Number(r.ref),
  advertiserId: r.advertiser_id, advertiserRef: r.advertiser_ref, advertiserName: r.advertiser_name,
  status: r.status, visibleToAdvertiser: r.visible_to_advertiser,
  paymentTerms: r.payment_terms, currency: r.currency,
  periodStart: toDateStr(r.period_start), periodEnd: toDateStr(r.period_end),
  billedAmount: r.billed_amount, paidAmount: r.paid_amount,
  balance: (Number(r.billed_amount) - Number(r.paid_amount)).toFixed(2),
  paidAt: r.paid_at, notes: r.notes,
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
  SELECT i.*, a.ref AS advertiser_ref, a.name AS advertiser_name
    FROM advertiser_invoices i
    JOIN advertisers a ON a.id = i.advertiser_id AND a.network_id = i.network_id
`;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const createSchema = z.object({
  advertiserId: z.string().uuid(),
  periodStart: dateStr,
  periodEnd: dateStr,
  visibleToAdvertiser: z.boolean().default(true),
  paymentTerms: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine((b) => b.periodEnd >= b.periodStart, { message: 'periodEnd must be on or after periodStart', path: ['periodEnd'] });

const updateSchema = z.object({
  visibleToAdvertiser: z.boolean().optional(),
  paymentTerms: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

async function billedAmountFor(networkId: string, advertiserId: string, periodStart: string, periodEnd: string): Promise<string> {
  const { rows } = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0)::text AS total
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = 'advertiser' AND account_id = $2 AND status = 'approved'
        AND created_at >= $3::date AND created_at < ($4::date + interval '1 day')`,
    [networkId, advertiserId, periodStart, periodEnd],
  );
  return rows[0]?.total ?? '0';
}

export function advertiserInvoicesRoutes(): Router {
  const r = Router();

  r.get('/summary', asyncHandler(async (req, res) => {
    const { rows } = await query<{ billed: string; paid: string }>(
      `SELECT COALESCE(SUM(billed_amount), 0)::text AS billed, COALESCE(SUM(paid_amount), 0)::text AS paid
         FROM advertiser_invoices WHERE network_id = $1 AND status != 'deleted'`,
      [req.scope!.networkId],
    );
    const billed = Number(rows[0]?.billed ?? 0);
    const paid = Number(rows[0]?.paid ?? 0);
    sendOk(res, { billedAmount: billed.toFixed(2), paidAmount: paid.toFixed(2), balance: (billed - paid).toFixed(2) });
  }));

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'unpaid');
    const advertiserId = req.query['advertiserId'] ? String(req.query['advertiserId']) : null;
    const params: unknown[] = [networkId];
    let where = 'i.network_id = $1';
    if (statusParam !== 'all') { params.push(statusParam); where += ` AND i.status = $${params.length}`; }
    if (advertiserId) { params.push(advertiserId); where += ` AND i.advertiser_id = $${params.length}`; }
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY i.created_at DESC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    const advertiser = await db.selectOne('advertisers', { id: b.advertiserId });
    if (!advertiser) throw badRequest('advertiserId does not belong to this network');
    const billed = await billedAmountFor(networkId, b.advertiserId, b.periodStart, b.periodEnd);
    const row = await db.insert<Row>(TABLE, {
      advertiser_id: b.advertiserId, status: 'unpaid', visible_to_advertiser: b.visibleToAdvertiser,
      payment_terms: b.paymentTerms ?? null, currency: 'USD', period_start: b.periodStart, period_end: b.periodEnd,
      billed_amount: billed, paid_amount: '0', notes: b.notes ?? null,
    });
    await writeAudit(req, { action: 'advertiser-invoice.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [row.id, networkId]);
    sendOk(res, dto(rows[0]!));
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
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    if (before.status !== 'unpaid') throw badRequest('Only unpaid invoices can be marked paid');
    const [row] = await db.update<Row>(TABLE, { status: 'paid', paid_amount: before.billed_amount, paid_at: new Date() }, { id: req.params.id });
    await writeAudit(req, { action: 'advertiser-invoice.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE i.id = $1 AND i.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Invoice not found');
    const [row] = await db.update<Row>(TABLE, { status: 'deleted' }, { id: req.params.id });
    await writeAudit(req, { action: 'advertiser-invoice.delete', entityType: TABLE, entityId: req.params.id, before, after: row });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/ledger', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const invoice = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!invoice) throw notFound('Invoice not found');
    const { rows } = await query<{ id: string; entry_type: string; direction: string; amount: string; currency: string; conversion_id: string | null; created_at: string }>(
      `SELECT id, entry_type, direction, amount, currency, conversion_id, created_at
         FROM ledger_entries
        WHERE network_id = $1 AND account_type = 'advertiser' AND account_id = $2 AND status = 'approved'
          AND created_at >= $3::date AND created_at < ($4::date + interval '1 day')
        ORDER BY created_at DESC LIMIT 500`,
      [req.scope!.networkId, invoice.advertiser_id, toDateStr(invoice.period_start), toDateStr(invoice.period_end)],
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
