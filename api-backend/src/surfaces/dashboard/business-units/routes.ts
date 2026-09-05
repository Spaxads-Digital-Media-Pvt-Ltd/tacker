/**
 * Control Center › Segmentation Options › Business Unit — a brand-new, bare catalog (no prior
 * backing concept anywhere in this app). Matches the reference's own minimal shape (verified live):
 * Name only, inline row add/edit, direct Edit/Delete icon buttons per row (no kebab, no status).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'business_units';

interface Row { id: string; ref: number; name: string; created_at: string; updated_at: string }
const dto = (r: Row) => ({ id: r.id, ref: r.ref, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at });

const createSchema = z.object({ name: z.string().min(1).max(120) });
const updateSchema = createSchema.partial();

export function businessUnitsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where: {}, orderBy: 'name', limit: 1000 });
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<Row>(TABLE, { name: b.name });
    await writeAudit(req, { action: 'business_unit.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof updateSchema>;
    const [row] = await dbForRequest(req).update<Row>(TABLE, { name: b.name }, { id: req.params.id });
    if (!row) throw notFound('Business unit not found');
    await writeAudit(req, { action: 'business_unit.update', entityType: TABLE, entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Business unit not found');
    await writeAudit(req, { action: 'business_unit.delete', entityType: TABLE, entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
