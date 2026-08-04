/**
 * Custom fields (spec feature-depth) — a network defines extra fields for its publishers/advertisers
 * (and offers), then sets per-entity values. Definitions live in custom_field_defs; values live in
 * each entity's metadata jsonb under `custom` (see mergeCustomFields). Tenant-scoped by network_id.
 *   - customFieldRoutes()   → /api/custom-fields   (the definition dictionary)
 * Reused across publishers (W2) and advertisers (W3).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'custom_field_defs';

interface DefRow {
  id: string; entity_type: string; key: string; label: string; field_type: string;
  options: string[]; required: boolean; sort_order: number; created_at: string;
}
const toDTO = (r: DefRow) => ({
  id: r.id, entityType: r.entity_type, key: r.key, label: r.label, fieldType: r.field_type,
  options: r.options, required: r.required, sortOrder: r.sort_order, createdAt: r.created_at,
});

const createSchema = z.object({
  entityType: z.enum(['publisher', 'advertiser', 'offer']),
  key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/i, 'letters, numbers, underscore only'),
  label: z.string().min(1).max(120),
  fieldType: z.enum(['text', 'number', 'boolean', 'select']).default('text'),
  options: z.array(z.string().max(100)).max(50).default([]),
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

const listQuery = z.object({ entity: z.enum(['publisher', 'advertiser', 'offer']).optional() });

export function customFieldRoutes(): Router {
  const r = Router();

  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof listQuery>;
    const rows = await dbForRequest(req).selectMany<DefRow>(TABLE, {
      where: q.entity ? { entity_type: q.entity } : {}, orderBy: 'sort_order', limit: 500,
    });
    sendOk(res, rows.map(toDTO));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<DefRow>(TABLE, {
      entity_type: b.entityType, key: b.key, label: b.label, field_type: b.fieldType,
      options: b.options, required: b.required, sort_order: b.sortOrder,
    });
    await writeAudit(req, { action: 'custom_field.create', entityType: 'custom_field_def', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, toDTO(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Custom field not found');
    await writeAudit(req, { action: 'custom_field.delete', entityType: 'custom_field_def', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}

/**
 * Merge submitted custom-field values into an entity's existing metadata jsonb under `custom`.
 * Callers pass the entity's current metadata and the incoming values; returns the new metadata.
 */
export function mergeCustomFields(
  metadata: Record<string, unknown> | null | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const base = metadata ?? {};
  const existingCustom = (base['custom'] as Record<string, unknown> | undefined) ?? {};
  return { ...base, custom: { ...existingCustom, ...values } };
}
