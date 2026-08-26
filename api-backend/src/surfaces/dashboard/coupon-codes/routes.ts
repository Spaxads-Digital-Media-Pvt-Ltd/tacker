/**
 * Manage Coupon Codes (Partners › Coupon Codes) — a first-class, network-wide page over the same
 * offer_coupons table the per-offer Coupons tab manages (Offer detail → Coupons), so edits from
 * either surface show up in a shared History. The reference's "Active/Paused" status maps onto
 * this table's existing active/expired/disabled enum (Paused = disabled) rather than adding a new
 * DB value — no schema change needed beyond the Internal Notes column. Tenant-scoped (§3A).
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

const TABLE = 'offer_coupons';

interface Row {
  id: string; code: string; publisher_id: string | null; offer_id: string;
  description: string | null; discount: string | null; status: string; notes: string | null;
  starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string;
}
interface JoinedRow extends Row { publisher_ref: number | null; publisher_name: string | null; offer_ref: number; offer_name: string }

const dto = (r: JoinedRow) => ({
  id: r.id, code: r.code, status: r.status,
  publisherId: r.publisher_id, publisherRef: r.publisher_ref, publisherName: r.publisher_name,
  offerId: r.offer_id, offerRef: r.offer_ref, offerName: r.offer_name,
  description: r.description, discount: r.discount, notes: r.notes,
  startsAt: r.starts_at, endsAt: r.ends_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'coupon', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const SELECT = `
  SELECT c.*, p.ref AS publisher_ref, p.name AS publisher_name, o.ref AS offer_ref, o.name AS offer_name
    FROM offer_coupons c
    JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
    LEFT JOIN publishers p ON p.id = c.publisher_id AND p.network_id = c.network_id
`;

const baseSchema = z.object({
  code: z.string().min(1).max(100),
  status: z.enum(['active', 'expired', 'disabled']).default('active'),
  offerId: z.string().uuid(),
  publisherId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

export function couponCodesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'active');
    const params: unknown[] = [networkId];
    let where = 'c.network_id = $1';
    if (statusParam === 'active') { where += ` AND c.status = 'active'`; }
    else if (statusParam === 'paused') { where += ` AND c.status = 'disabled'`; }
    // 'all' → no extra filter
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY c.created_at DESC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    const offer = await db.selectOne('offers', { id: b.offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    if (b.publisherId) {
      const pub = await db.selectOne('publishers', { id: b.publisherId });
      if (!pub) throw badRequest('publisherId does not belong to this network');
    }
    const row = await db.insert<Row>(TABLE, {
      code: b.code, status: b.status, offer_id: b.offerId, publisher_id: b.publisherId ?? null,
      starts_at: b.startsAt ?? null, ends_at: b.endsAt ?? null, description: b.description ?? null, notes: b.notes ?? null,
    });
    await writeAudit(req, { action: 'coupon.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE c.id = $1 AND c.network_id = $2`, [row.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  const bulkCreateSchema = z.object({ items: z.array(createSchema).min(1).max(100) });
  r.post('/bulk', requireRole('admin', 'manager'), validateBody(bulkCreateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof bulkCreateSchema>;
    const created: Row[] = [];
    for (const item of b.items) {
      const offer = await db.selectOne('offers', { id: item.offerId });
      if (!offer) throw badRequest(`offerId ${item.offerId} does not belong to this network`);
      if (item.publisherId) {
        const pub = await db.selectOne('publishers', { id: item.publisherId });
        if (!pub) throw badRequest(`publisherId ${item.publisherId} does not belong to this network`);
      }
      const row = await db.insert<Row>(TABLE, {
        code: item.code, status: item.status, offer_id: item.offerId, publisher_id: item.publisherId ?? null,
        starts_at: item.startsAt ?? null, ends_at: item.endsAt ?? null, description: item.description ?? null, notes: item.notes ?? null,
      });
      await writeAudit(req, { action: 'coupon.create', entityType: TABLE, entityId: row.id, after: row });
      created.push(row);
    }
    res.status(201);
    sendOk(res, { created: created.length });
  }));

  const bulkUpdateSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), status: z.enum(['active', 'expired', 'disabled']) });
  r.patch('/bulk', requireRole('admin', 'manager'), validateBody(bulkUpdateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof bulkUpdateSchema>;
    let updated = 0;
    for (const id of b.ids) {
      const before = await db.selectOne<Row>(TABLE, { id });
      if (!before) continue;
      const [row] = await db.update<Row>(TABLE, { status: b.status }, { id });
      if (row) {
        await writeAudit(req, { action: 'coupon.update', entityType: TABLE, entityId: id, before, after: row });
        updated++;
      }
    }
    sendOk(res, { updated });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE c.id = $1 AND c.network_id = $2`, [req.params.id, req.scope!.networkId]);
    if (!rows[0]) throw notFound('Coupon code not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Coupon code not found');
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.offerId) { const offer = await db.selectOne('offers', { id: b.offerId }); if (!offer) throw badRequest('offerId does not belong to this network'); }
    if (b.publisherId) { const pub = await db.selectOne('publishers', { id: b.publisherId }); if (!pub) throw badRequest('publisherId does not belong to this network'); }
    const patch: Record<string, unknown> = {};
    if (b.code !== undefined) patch['code'] = b.code;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.offerId !== undefined) patch['offer_id'] = b.offerId;
    if (b.publisherId !== undefined) patch['publisher_id'] = b.publisherId;
    if (b.startsAt !== undefined) patch['starts_at'] = b.startsAt;
    if (b.endsAt !== undefined) patch['ends_at'] = b.endsAt;
    if (b.description !== undefined) patch['description'] = b.description;
    if (b.notes !== undefined) patch['notes'] = b.notes;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Coupon code not found');
    await writeAudit(req, { action: 'coupon.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE c.id = $1 AND c.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Coupon code not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'coupon.delete', entityType: TABLE, entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Coupon code not found');
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
