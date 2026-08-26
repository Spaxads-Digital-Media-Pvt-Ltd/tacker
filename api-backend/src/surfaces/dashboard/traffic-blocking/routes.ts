/**
 * Manage Traffic Blockings (Partners › Traffic Blocking) — per Partner+Offer rules that flag a
 * click when a sub-placement (sub1..sub10) or source_id matches a filter. Filters are stored as a
 * single jsonb column (only enabled fields present) rather than 33 flat columns — see the
 * traffic-blocking migration. This page is admin-facing CRUD only; wiring the rules into the live
 * click-accept path is a separate, not-yet-built concern (matches how Postback "Test" fires a real
 * request but doesn't change click processing either). Tenant-scoped by network_id (§3A).
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

const TABLE = 'traffic_blockings';

const FIELD_KEYS = ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6', 'sub7', 'sub8', 'sub9', 'sub10', 'sourceId'] as const;
const MATCH_TYPES = ['begins_with', 'contains', 'does_not_contain', 'does_not_match', 'ends_with', 'exact_match', 'is_empty'] as const;
const MATCH_LABEL: Record<string, string> = {
  begins_with: 'Begins With', contains: 'Contains', does_not_contain: 'Does not contain',
  does_not_match: 'Does not match', ends_with: 'Ends With', exact_match: 'Exact Match', is_empty: 'Is Empty',
};

interface Row {
  id: string; publisher_id: string; offer_id: string; status: string;
  filters: Record<string, { matchType: string; value: string | null }>;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row {
  publisher_ref: number; publisher_name: string; offer_ref: number; offer_name: string;
}

const describeFilter = (f?: { matchType: string; value: string | null }): string | null => {
  if (!f) return null;
  if (f.matchType === 'is_empty') return 'Is Empty';
  return `${MATCH_LABEL[f.matchType] ?? f.matchType} "${f.value ?? ''}"`;
};

const dto = (r: JoinedRow) => ({
  id: r.id,
  publisherId: r.publisher_id, publisherRef: r.publisher_ref, publisherName: r.publisher_name,
  offerId: r.offer_id, offerRef: r.offer_ref, offerName: r.offer_name,
  status: r.status,
  filters: r.filters ?? {},
  filterSummary: Object.fromEntries(FIELD_KEYS.map((k) => [k, describeFilter(r.filters?.[k])])),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const filterEntrySchema = z.object({
  matchType: z.enum(MATCH_TYPES),
  value: z.string().max(500).nullable().optional(),
}).refine((v) => v.matchType === 'is_empty' || Boolean(v.value && v.value.length > 0), {
  message: 'value is required unless matchType is is_empty',
});
const filtersSchema = z.record(z.enum(FIELD_KEYS), filterEntrySchema).default({});

const baseSchema = z.object({
  publisherId: z.string().uuid(),
  offerId: z.string().uuid(),
  status: z.enum(['active', 'inactive']).default('active'),
  filters: filtersSchema,
});
const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

const SELECT = `
  SELECT t.*, p.ref AS publisher_ref, p.name AS publisher_name, o.ref AS offer_ref, o.name AS offer_name
    FROM traffic_blockings t
    JOIN publishers p ON p.id = t.publisher_id AND p.network_id = t.network_id
    JOIN offers o ON o.id = t.offer_id AND o.network_id = t.network_id
`;

export function trafficBlockingRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'active');
    const params: unknown[] = [networkId];
    let where = 't.network_id = $1';
    if (statusParam !== 'all') { where += ` AND t.status = $2`; params.push(statusParam); }
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    const pub = await db.selectOne('publishers', { id: b.publisherId });
    if (!pub) throw badRequest('publisherId does not belong to this network');
    const offer = await db.selectOne('offers', { id: b.offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    const row = await db.insert<Row>(TABLE, {
      publisher_id: b.publisherId, offer_id: b.offerId, status: b.status, filters: JSON.stringify(b.filters),
    });
    await writeAudit(req, { action: 'traffic_blocking.create', entityType: 'traffic_blocking', entityId: row.id, after: row });
    res.status(201);
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE t.id = $1 AND t.network_id = $2`, [row.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE t.id = $1 AND t.network_id = $2`, [req.params.id, req.scope!.networkId]);
    if (!rows[0]) throw notFound('Traffic blocking rule not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Traffic blocking rule not found');
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.publisherId) {
      const pub = await db.selectOne('publishers', { id: b.publisherId });
      if (!pub) throw badRequest('publisherId does not belong to this network');
    }
    if (b.offerId) {
      const offer = await db.selectOne('offers', { id: b.offerId });
      if (!offer) throw badRequest('offerId does not belong to this network');
    }
    const patch: Record<string, unknown> = {};
    if (b.publisherId !== undefined) patch['publisher_id'] = b.publisherId;
    if (b.offerId !== undefined) patch['offer_id'] = b.offerId;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.filters !== undefined) patch['filters'] = JSON.stringify(b.filters);
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Traffic blocking rule not found');
    await writeAudit(req, { action: 'traffic_blocking.update', entityType: 'traffic_blocking', entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE t.id = $1 AND t.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Traffic blocking rule not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'traffic_blocking.delete', entityType: 'traffic_blocking', entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  return r;
}
