/**
 * Offer Templates (Offers-flyout parity) — reusable pre-filled field sets for the Add Offer wizard.
 * `fieldValues` is the actual value snapshot ("Add Offer from Template" pre-fills a new offer from
 * it); `offerFields` is derived (its keys) so the Manage Templates list can show which fields a
 * template covers without re-parsing the values object. Tenant-scoped by network_id (spec §3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'offer_templates';

interface Row { id: string; ref: string; name: string; is_default: boolean; offer_fields: string[]; field_values: Record<string, string>; created_at: string; updated_at: string }
const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, isDefault: r.is_default, offerFields: r.offer_fields,
  fieldValues: r.field_values ?? {}, createdAt: r.created_at, updatedAt: r.updated_at,
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  isDefault: z.boolean().default(false),
  fieldValues: z.record(z.string(), z.string()).default({}),
});
const updateSchema = createSchema.partial();

export function offerTemplatesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where: {}, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(dto));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Offer template not found');
    sendOk(res, dto(row));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<Row>(TABLE, {
      name: b.name, is_default: b.isDefault,
      offer_fields: JSON.stringify(Object.keys(b.fieldValues)),
      field_values: JSON.stringify(b.fieldValues),
    });
    await writeAudit(req, { action: 'offer_template.create', entityType: 'offer_template', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.isDefault !== undefined) patch['is_default'] = b.isDefault;
    if (b.fieldValues !== undefined) {
      patch['field_values'] = JSON.stringify(b.fieldValues);
      patch['offer_fields'] = JSON.stringify(Object.keys(b.fieldValues));
    }
    // Only one default template per network — unset every other row first.
    if (b.isDefault === true) {
      await query('UPDATE offer_templates SET is_default = false WHERE network_id = $1 AND id != $2', [req.scope!.networkId, req.params.id]);
    }
    const [row] = await db.update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Offer template not found');
    await writeAudit(req, { action: 'offer_template.update', entityType: 'offer_template', entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Offer template not found');
    await writeAudit(req, { action: 'offer_template.delete', entityType: 'offer_template', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
