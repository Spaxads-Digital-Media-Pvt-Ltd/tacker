/**
 * Tags — a network-level label dictionary plus polymorphic assignment to offers/publishers/
 * advertisers (spec feature-depth). One mechanism, reused across entities:
 *   - tagsRoutes()                      → /api/tags        (the dictionary: list/create/delete)
 *   - attachTagRoutes(r, 'offer')       → /:id/tags        (assign/unassign on an entity router)
 * All tenant-scoped by network_id (ScopedDb). Assignments verify the entity belongs to the
 * caller's network before writing (spec §3A).
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

type Db = ReturnType<typeof dbForRequest>;
type EntityType = 'offer' | 'publisher' | 'advertiser' | 'partner_tier';
const ENTITY_TABLE: Record<EntityType, string> = { offer: 'offers', publisher: 'publishers', advertiser: 'advertisers', partner_tier: 'partner_tiers' };

interface TagRow { id: string; name: string; color: string | null; created_at: string; }
const tagDTO = (r: TagRow) => ({ id: r.id, name: r.name, color: r.color, createdAt: r.created_at });

const createTagSchema = z.object({ name: z.string().min(1).max(60), color: z.string().max(20).nullable().optional() });
const assignTagSchema = z.object({
  tagId: z.string().uuid().optional(),
  name: z.string().min(1).max(60).optional(),
  color: z.string().max(20).nullable().optional(),
}).refine((v) => v.tagId || v.name, { message: 'tagId or name required' });

/** Find an existing tag by name (case-insensitive) or create it. Returns the tag row. */
async function findOrCreateTag(db: Db, name: string, color: string | null): Promise<TagRow> {
  const existing = await db.selectMany<TagRow>('tags', { where: {}, limit: 1000 });
  const hit = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  return db.insert<TagRow>('tags', { name, color });
}

/** /api/tags — the network's tag dictionary. */
export function tagsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<TagRow>('tags', { where: {}, limit: 1000, orderBy: 'name' });
    sendOk(res, rows.map(tagDTO));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createTagSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createTagSchema>;
    const row = await findOrCreateTag(db, b.name, b.color ?? null);
    await writeAudit(req, { action: 'tag.create', entityType: 'tag', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, tagDTO(row));
  }));

  // Bulk tag→entity map for list-page filtering (e.g. "filter Offers by tag"), so the caller
  // doesn't need N+1 requests against every entity's own /:id/tags.
  r.get('/assignments', asyncHandler(async (req, res) => {
    const entityType = req.query['entityType'];
    if (entityType !== 'offer' && entityType !== 'publisher' && entityType !== 'advertiser' && entityType !== 'partner_tier') {
      throw badRequest('entityType must be offer, publisher, advertiser, or partner_tier');
    }
    const rows = await dbForRequest(req).selectMany<{ tag_id: string; entity_id: string }>('taggings', {
      where: { entity_type: entityType }, limit: 10_000,
    });
    sendOk(res, rows.map((r) => ({ tagId: r.tag_id, entityId: r.entity_id })));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const n = await db.delete('tags', { id: req.params.id }); // taggings cascade via FK
    if (n === 0) throw notFound('Tag not found');
    await writeAudit(req, { action: 'tag.delete', entityType: 'tag', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}

/** Attach /:id/tags assign/unassign routes onto an entity's admin router. */
export function attachTagRoutes(r: Router, entityType: EntityType): void {
  async function ensureEntity(db: Db, id: string | undefined): Promise<void> {
    if (!id) throw notFound('Not found');
    const row = await db.selectOne(ENTITY_TABLE[entityType], { id });
    if (!row) throw notFound('Not found');
  }

  r.get('/:id/tags', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureEntity(db, req.params.id);
    const rows = await db.selectMany<{ tag_id: string }>('taggings', {
      where: { entity_type: entityType, entity_id: req.params.id }, limit: 1000,
    });
    const tagIds = new Set(rows.map((t) => t.tag_id));
    const all = await db.selectMany<TagRow>('tags', { where: {}, limit: 1000 });
    sendOk(res, all.filter((t) => tagIds.has(t.id)).map(tagDTO));
  }));

  r.post('/:id/tags', requireRole('admin', 'manager'), validateBody(assignTagSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureEntity(db, req.params.id);
    const b = req.body as z.infer<typeof assignTagSchema>;
    let tag: TagRow | null = null;
    if (b.tagId) {
      tag = await db.selectOne<TagRow>('tags', { id: b.tagId });
      if (!tag) throw badRequest('tagId does not belong to this network');
    } else {
      tag = await findOrCreateTag(db, b.name!, b.color ?? null);
    }
    // Idempotent assign (unique index on tag_id+entity → ignore duplicates).
    const existing = await db.selectOne('taggings', { tag_id: tag.id, entity_type: entityType, entity_id: req.params.id });
    if (!existing) {
      await db.insert('taggings', { tag_id: tag.id, entity_type: entityType, entity_id: req.params.id });
    }
    await writeAudit(req, { action: `${entityType}.tag.assign`, entityType: 'tagging', entityId: tag.id });
    res.status(201);
    sendOk(res, tagDTO(tag));
  }));

  r.delete('/:id/tags/:tagId', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const n = await db.delete('taggings', { tag_id: req.params.tagId, entity_type: entityType, entity_id: req.params.id });
    if (n === 0) throw notFound('Tag assignment not found');
    await writeAudit(req, { action: `${entityType}.tag.unassign`, entityType: 'tagging', entityId: req.params.tagId });
    sendOk(res, { deleted: true });
  }));
}
