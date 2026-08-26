/**
 * Manage Tiers (Partners › Tiers) — groups of Partners that share a payout margin and offer
 * visibility. margin_pct drives a client-side "Revenue & Payout Example" preview (Payout =
 * Revenue * (1 - margin/100)); nothing about that preview is stored. Labels reuse the existing
 * generic tags/taggings system (entity_type 'partner_tier'). Tenant-scoped by network_id (§3A).
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

const TABLE = 'partner_tiers';

interface Row {
  id: string; name: string; status: string; description: string | null;
  margin_pct: string; is_default: boolean; created_at: string; updated_at: string;
}
interface PartnerPreview { id: string; ref: number; name: string }
interface ListRow extends Row { partners_preview: PartnerPreview[]; partners_total: number; labels: string[] }

const dto = (r: ListRow) => ({
  id: r.id, name: r.name, status: r.status, description: r.description,
  marginPct: Number(r.margin_pct), isDefault: r.is_default,
  labels: r.labels ?? [],
  partners: r.partners_preview ?? [], partnersTotal: Number(r.partners_total ?? 0),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'partner_tier', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const baseSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'paused', 'deleted']).default('active'),
  description: z.string().max(1000).nullable().optional(),
  marginPct: z.number().min(0).max(100),
  labels: z.array(z.string().min(1).max(60)).default([]),
  partnerIds: z.array(z.string().uuid()).default([]),
});
const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

/** Replace a partner_tier's label set with `labels` (find-or-create each tag, then diff taggings). */
async function setLabels(db: ReturnType<typeof dbForRequest>, tierId: string, labels: string[]): Promise<void> {
  const existingTags = await db.selectMany<{ id: string; name: string }>('tags', { where: {}, limit: 1000 });
  const tagIds: string[] = [];
  for (const name of labels) {
    const hit = existingTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (hit) { tagIds.push(hit.id); continue; }
    const created = await db.insert<{ id: string }>('tags', { name, color: null });
    tagIds.push(created.id);
  }
  await db.delete('taggings', { entity_type: 'partner_tier', entity_id: tierId });
  for (const tagId of tagIds) {
    await db.insert('taggings', { tag_id: tagId, entity_type: 'partner_tier', entity_id: tierId });
  }
}

/** Replace a tier's partner membership with exactly `partnerIds` (all must belong to this network). */
async function setMembers(db: ReturnType<typeof dbForRequest>, networkId: string, tierId: string, partnerIds: string[]): Promise<void> {
  if (partnerIds.length > 0) {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2::uuid[])`,
      [networkId, partnerIds],
    );
    if (rows.length !== new Set(partnerIds).size) throw badRequest('One or more partnerIds do not belong to this network');
  }
  await db.delete('partner_tier_members', { tier_id: tierId });
  for (const publisherId of partnerIds) {
    await db.insert('partner_tier_members', { tier_id: tierId, publisher_id: publisherId });
  }
}

async function labelsFor(networkId: string, tierId: string): Promise<string[]> {
  const { rows } = await query<{ name: string }>(
    `SELECT tg.name FROM taggings tgg JOIN tags tg ON tg.id = tgg.tag_id
      WHERE tgg.network_id = $1 AND tgg.entity_type = 'partner_tier' AND tgg.entity_id = $2
      ORDER BY tg.name`,
    [networkId, tierId],
  );
  return rows.map((r) => r.name);
}

export function partnerTiersRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'active');
    const statuses = statusParam === 'all' ? ['active', 'paused', 'deleted'] : [statusParam];
    const { rows } = await query<ListRow>(
      `SELECT t.*,
              COALESCE((
                SELECT json_agg(json_build_object('id', p.id, 'ref', p.ref, 'name', p.name) ORDER BY m.created_at)
                FROM (SELECT * FROM partner_tier_members WHERE tier_id = t.id ORDER BY created_at LIMIT 2) m
                JOIN publishers p ON p.id = m.publisher_id
              ), '[]') AS partners_preview,
              (SELECT COUNT(*) FROM partner_tier_members WHERE tier_id = t.id) AS partners_total,
              COALESCE((
                SELECT json_agg(tg.name ORDER BY tg.name)
                FROM taggings tgg JOIN tags tg ON tg.id = tgg.tag_id
                WHERE tgg.network_id = t.network_id AND tgg.entity_type = 'partner_tier' AND tgg.entity_id = t.id
              ), '[]') AS labels
         FROM partner_tiers t
        WHERE t.network_id = $1 AND t.status = ANY($2::text[])
        ORDER BY t.created_at DESC LIMIT 500`,
      [networkId, statuses],
    );
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    const row = await db.insert<Row>(TABLE, {
      name: b.name, status: b.status, description: b.description ?? null, margin_pct: b.marginPct,
    });
    await setLabels(db, row.id, b.labels);
    await setMembers(db, req.scope!.networkId, row.id, b.partnerIds);
    await writeAudit(req, { action: 'partner_tier.create', entityType: 'partner_tier', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto({ ...row, partners_preview: [], partners_total: b.partnerIds.length, labels: b.labels }));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Tier not found');
    const labels = await labelsFor(req.scope!.networkId, row.id);
    const { rows: countRows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM partner_tier_members WHERE tier_id = $1`, [row.id],
    );
    sendOk(res, dto({ ...row, partners_preview: [], partners_total: Number(countRows[0]?.count ?? 0), labels }));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Tier not found');
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.description !== undefined) patch['description'] = b.description;
    if (b.marginPct !== undefined) patch['margin_pct'] = b.marginPct;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Tier not found');
    if (b.labels !== undefined) await setLabels(db, row.id, b.labels);
    if (b.partnerIds !== undefined) await setMembers(db, req.scope!.networkId, row.id, b.partnerIds);
    await writeAudit(req, { action: 'partner_tier.update', entityType: 'partner_tier', entityId: req.params.id, before, after: row });
    const labels = await labelsFor(req.scope!.networkId, row.id);
    const { rows: countRows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM partner_tier_members WHERE tier_id = $1`, [row.id],
    );
    sendOk(res, dto({ ...row, partners_preview: [], partners_total: Number(countRows[0]?.count ?? 0), labels }));
  }));

  r.post('/:id/set-default', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Tier not found');
    await query(`UPDATE partner_tiers SET is_default = false WHERE network_id = $1 AND is_default = true`, [req.scope!.networkId]);
    const [updated] = await db.update<Row>(TABLE, { is_default: true }, { id: req.params.id });
    await writeAudit(req, { action: 'partner_tier.set_default', entityType: 'partner_tier', entityId: req.params.id });
    sendOk(res, dto({ ...(updated ?? row), partners_preview: [], partners_total: 0, labels: [] }));
  }));

  r.get('/:id/members', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const tier = await db.selectOne(TABLE, { id: req.params.id });
    if (!tier) throw notFound('Tier not found');
    const search = String(req.query['search'] ?? '').trim();
    const status = String(req.query['status'] ?? 'active');
    const conditions = [`m.tier_id = $1`, `p.network_id = $2`];
    const params: unknown[] = [req.params.id, req.scope!.networkId];
    if (status !== 'all') { conditions.push(`p.status = $${params.length + 1}`); params.push(status); }
    if (search) { conditions.push(`p.name ILIKE $${params.length + 1}`); params.push(`%${search}%`); }
    const { rows } = await query<{ id: string; ref: number; name: string; status: string }>(
      `SELECT p.id, p.ref, p.name, p.status FROM partner_tier_members m
         JOIN publishers p ON p.id = m.publisher_id
        WHERE ${conditions.join(' AND ')} ORDER BY p.name LIMIT 500`,
      params,
    );
    sendOk(res, rows.map((p) => ({ id: p.id, ref: p.ref, name: p.name, status: p.status })));
  }));

  r.get('/:id/offers', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const tier = await db.selectOne(TABLE, { id: req.params.id });
    if (!tier) throw notFound('Tier not found');
    const { rows } = await query<{ id: string; offer_id: string; ref: number; name: string; apply_margin: boolean; auto_approve_partners: boolean }>(
      `SELECT tof.id, tof.offer_id, o.ref, o.name, tof.apply_margin, tof.auto_approve_partners
         FROM partner_tier_offers tof JOIN offers o ON o.id = tof.offer_id
        WHERE tof.tier_id = $1 AND tof.network_id = $2 ORDER BY o.name LIMIT 500`,
      [req.params.id, req.scope!.networkId],
    );
    sendOk(res, rows.map((o) => ({ id: o.id, offerId: o.offer_id, offerRef: o.ref, offerName: o.name, applyMargin: o.apply_margin, autoApprovePartners: o.auto_approve_partners })));
  }));

  const offerLinkSchema = z.object({
    offerId: z.string().uuid(),
    applyMargin: z.boolean().default(true),
    autoApprovePartners: z.boolean().default(true),
  });

  r.put('/:id/offers', requireRole('admin', 'manager'), validateBody(offerLinkSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const tier = await db.selectOne(TABLE, { id: req.params.id });
    if (!tier) throw notFound('Tier not found');
    const b = req.body as z.infer<typeof offerLinkSchema>;
    const offer = await db.selectOne('offers', { id: b.offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    const existing = await db.selectOne<{ id: string }>('partner_tier_offers', { tier_id: req.params.id, offer_id: b.offerId });
    if (existing) {
      await db.update('partner_tier_offers', { apply_margin: b.applyMargin, auto_approve_partners: b.autoApprovePartners }, { id: existing.id });
    } else {
      await db.insert('partner_tier_offers', { tier_id: req.params.id, offer_id: b.offerId, apply_margin: b.applyMargin, auto_approve_partners: b.autoApprovePartners });
    }
    await writeAudit(req, { action: 'partner_tier.offer.link', entityType: 'partner_tier', entityId: req.params.id, after: b });
    sendOk(res, { linked: true });
  }));

  r.delete('/:id/offers/:offerId', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const n = await db.delete('partner_tier_offers', { tier_id: req.params.id, offer_id: req.params.offerId });
    if (n === 0) throw notFound('Offer link not found');
    await writeAudit(req, { action: 'partner_tier.offer.unlink', entityType: 'partner_tier', entityId: req.params.id, before: { offerId: req.params.offerId } });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Tier not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'partner_tier' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}
