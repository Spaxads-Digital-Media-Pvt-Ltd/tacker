/**
 * Smart Links (feature-depth) — one link that rotates traffic across several offers by weight, with
 * optional per-item geo targeting and a fallback. Admin CRUD here; the tracking surface resolves
 * & redirects at /sl (see tracking/app.ts). Tenant-scoped by network_id; referenced offers are
 * verified to belong to the caller's network (spec §3A).
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

const LINKS = 'smart_links';
const ITEMS = 'smart_link_items';

interface LinkRow { id: string; name: string; rotation: string; status: string; fallback_url: string | null; created_at: string; updated_at: string }
interface ItemRow { id: string; smart_link_id: string; offer_id: string; weight: number; country: string | null }
const linkDTO = (r: LinkRow) => ({ id: r.id, name: r.name, rotation: r.rotation, status: r.status, fallbackUrl: r.fallback_url, createdAt: r.created_at });
const itemDTO = (r: ItemRow) => ({ id: r.id, offerId: r.offer_id, weight: r.weight, country: r.country });

const createLinkSchema = z.object({
  name: z.string().min(1).max(200),
  rotation: z.enum(['weighted', 'round_robin']).default('weighted'),
  status: z.enum(['active', 'paused']).default('active'),
  fallbackUrl: z.string().url().max(2000).nullable().optional(),
});
const updateLinkSchema = createLinkSchema.partial();
const createItemSchema = z.object({
  offerId: z.string().uuid(),
  weight: z.number().int().min(0).max(1000).default(1),
  country: z.string().max(3).nullable().optional(),
});

export function smartLinksRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<LinkRow>(LINKS, { where: {}, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(linkDTO));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const link = await db.selectOne<LinkRow>(LINKS, { id: req.params.id });
    if (!link) throw notFound('Smart link not found');
    const items = await db.selectMany<ItemRow>(ITEMS, { where: { smart_link_id: req.params.id }, limit: 500 });
    sendOk(res, { ...linkDTO(link), items: items.map(itemDTO) });
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createLinkSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createLinkSchema>;
    const row = await dbForRequest(req).insert<LinkRow>(LINKS, {
      name: b.name, rotation: b.rotation, status: b.status, fallback_url: b.fallbackUrl ?? null,
    });
    await writeAudit(req, { action: 'smart_link.create', entityType: 'smart_link', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, linkDTO(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateLinkSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateLinkSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.rotation !== undefined) patch['rotation'] = b.rotation;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.fallbackUrl !== undefined) patch['fallback_url'] = b.fallbackUrl;
    const [row] = await db.update<LinkRow>(LINKS, patch, { id: req.params.id });
    if (!row) throw notFound('Smart link not found');
    await writeAudit(req, { action: 'smart_link.update', entityType: 'smart_link', entityId: req.params.id, after: row });
    sendOk(res, linkDTO(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(LINKS, { id: req.params.id });
    if (n === 0) throw notFound('Smart link not found');
    await writeAudit(req, { action: 'smart_link.delete', entityType: 'smart_link', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  // --- Rotation items ---
  r.get('/:id/items', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<ItemRow>(ITEMS, { where: { smart_link_id: req.params.id }, limit: 500 });
    sendOk(res, rows.map(itemDTO));
  }));

  r.post('/:id/items', requireRole('admin', 'manager'), validateBody(createItemSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const link = await db.selectOne<LinkRow>(LINKS, { id: req.params.id });
    if (!link) throw notFound('Smart link not found');
    const b = req.body as z.infer<typeof createItemSchema>;
    const offer = await db.selectOne('offers', { id: b.offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    const row = await db.insert<ItemRow>(ITEMS, {
      smart_link_id: req.params.id, offer_id: b.offerId, weight: b.weight,
      country: b.country ? b.country.toUpperCase() : null,
    });
    await writeAudit(req, { action: 'smart_link.item.create', entityType: 'smart_link_item', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, itemDTO(row));
  }));

  r.delete('/:id/items/:itemId', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(ITEMS, { id: req.params.itemId, smart_link_id: req.params.id });
    if (n === 0) throw notFound('Item not found');
    await writeAudit(req, { action: 'smart_link.item.delete', entityType: 'smart_link_item', entityId: req.params.itemId });
    sendOk(res, { deleted: true });
  }));

  return r;
}
