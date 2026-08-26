/**
 * Offer Custom Settings (Offers-flyout parity) — network-wide, category-grouped view (Revenue &
 * Payout / Caps / Throttle Rates / Landing Pages / Creatives), distinct from each Offer's own
 * per-country geo-rules. Tenant-scoped by network_id (spec §3A).
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

const TABLE = 'offer_custom_settings';
const CATEGORIES = ['revenue_payout', 'caps', 'throttle_rates', 'landing_pages', 'creatives'] as const;

interface Row {
  id: string; category: string; name: string; offer_id: string | null; partner_ids: string[];
  description: string | null; public_description: string | null; event: string | null; value: string | null;
  status: string; created_at: string; updated_at: string;
}
const dto = (r: Row) => ({
  id: r.id, category: r.category, name: r.name, offerId: r.offer_id, partnerIds: r.partner_ids,
  description: r.description, publicDescription: r.public_description, event: r.event, value: r.value,
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  name: z.string().min(1).max(200),
  offerId: z.string().uuid().nullable().optional(),
  partnerIds: z.array(z.string().uuid()).default([]),
  description: z.string().nullable().optional(),
  publicDescription: z.string().nullable().optional(),
  event: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  status: z.enum(['active', 'paused']).default('active'),
});
const updateSchema = createSchema.partial();

export function offerCustomSettingsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;
    if (category && !(CATEGORIES as readonly string[]).includes(category)) throw badRequest('Invalid category');
    const offerId = typeof req.query['offerId'] === 'string' ? req.query['offerId'] : undefined;
    const where: Record<string, unknown> = {};
    if (category) where['category'] = category;
    if (offerId) where['offer_id'] = offerId;
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<Row>(TABLE, {
      category: b.category, name: b.name, offer_id: b.offerId ?? null, partner_ids: JSON.stringify(b.partnerIds),
      description: b.description ?? null, public_description: b.publicDescription ?? null,
      event: b.event ?? null, value: b.value ?? null, status: b.status,
    });
    await writeAudit(req, { action: 'offer_custom_setting.create', entityType: 'offer_custom_setting', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.category !== undefined) patch['category'] = b.category;
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.offerId !== undefined) patch['offer_id'] = b.offerId;
    if (b.partnerIds !== undefined) patch['partner_ids'] = JSON.stringify(b.partnerIds);
    if (b.description !== undefined) patch['description'] = b.description;
    if (b.publicDescription !== undefined) patch['public_description'] = b.publicDescription;
    if (b.event !== undefined) patch['event'] = b.event;
    if (b.value !== undefined) patch['value'] = b.value;
    if (b.status !== undefined) patch['status'] = b.status;
    const [row] = await db.update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Custom setting not found');
    await writeAudit(req, { action: 'offer_custom_setting.update', entityType: 'offer_custom_setting', entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Custom setting not found');
    await writeAudit(req, { action: 'offer_custom_setting.delete', entityType: 'offer_custom_setting', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
