/**
 * Control Center › Segmentation Options › Categories — a real network-scoped catalog (previously
 * just derived from whatever free-text values existed on Offer.category). The reference's own list
 * (verified live) supports Active/Inactive/All filtering, inline row add/edit (no dedicated Add
 * page), and Edit only — no delete. Offer.category itself stays free text (unrelated form, not
 * converted to a strict FK) but the create/edit Offer form now suggests names from this catalog.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'offer_categories';

interface Row { id: string; ref: number; name: string; status: string; created_at: string; updated_at: string }
const dto = (r: Row) => ({ id: r.id, ref: r.ref, name: r.name, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });

const createSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'inactive']).default('active'),
});
const updateSchema = createSchema.partial();

export function offerCategoriesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const where: Record<string, unknown> = {};
    if (status && status !== 'all') {
      if (status !== 'active' && status !== 'inactive') throw badRequest('Invalid status');
      where['status'] = status;
    }
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where, orderBy: 'name', limit: 1000 });
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<Row>(TABLE, { name: b.name, status: b.status });
    await writeAudit(req, { action: 'offer_category.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    const [row] = await dbForRequest(req).update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Category not found');
    await writeAudit(req, { action: 'offer_category.update', entityType: TABLE, entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  return r;
}
