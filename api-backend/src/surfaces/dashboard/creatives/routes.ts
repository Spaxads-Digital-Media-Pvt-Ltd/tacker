/**
 * Offers › Creatives — matches the reference's real "Manage Creatives" (/offers/creatives): a
 * network-wide list over the same `offer_creatives` table the Offer Detail page's own per-offer
 * Creatives tab writes to (mounted at /api/offers/:id/creatives — see offers/asset-routes.ts), but
 * unscoped to one offer. One creative can target several offers at once — the reference stores that
 * as one row per offer, all sharing the same name/content, which is what "+ Creative" fans out into
 * here. Tenant-scoped by network_id (spec §3A); every selected offer is verified to belong to the
 * caller's network before any write.
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

const TABLE = 'offer_creatives';

interface Row {
  id: string; ref: string; offer_id: string; name: string; type: string; url: string | null; html: string | null;
  width: number | null; height: number | null; language: string | null; status: string;
  visible_to_partners: boolean; email_from: string | null; email_subject: string | null;
  created_at: string; updated_at: string;
}
const dto = (r: Row & { offer_name?: string; offer_ref?: string }) => ({
  id: r.id, ref: Number(r.ref), offerId: r.offer_id, offerName: r.offer_name, offerRef: r.offer_ref != null ? Number(r.offer_ref) : undefined,
  name: r.name, type: r.type, url: r.url, html: r.html, width: r.width, height: r.height, language: r.language,
  status: r.status, visibleToPartners: r.visible_to_partners, emailFrom: r.email_from, emailSubject: r.email_subject,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['image', 'html', 'link', 'email', 'video', 'archive', 'thumbnail', 'text']).default('image'),
  url: z.string().max(6_000_000).nullable().optional(),
  html: z.string().max(100_000).nullable().optional(),
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  status: z.enum(['active', 'paused', 'deleted']).default('active'),
  visibleToPartners: z.boolean().default(true),
  emailFrom: z.string().max(2000).nullable().optional(),
  emailSubject: z.string().max(2000).nullable().optional(),
  offerIds: z.array(z.string().uuid()).min(1).max(100),
});
const updateBodySchema = bodySchema.partial().extend({ offerIds: z.array(z.string().uuid()).max(100).optional() });

function columns(b: Partial<z.infer<typeof bodySchema>>) {
  const out: Record<string, unknown> = {};
  if (b.name !== undefined) out['name'] = b.name;
  if (b.type !== undefined) out['type'] = b.type;
  if (b.url !== undefined) out['url'] = b.url;
  if (b.html !== undefined) out['html'] = b.html;
  if (b.width !== undefined) out['width'] = b.width;
  if (b.height !== undefined) out['height'] = b.height;
  if (b.language !== undefined) out['language'] = b.language;
  if (b.status !== undefined) out['status'] = b.status;
  if (b.visibleToPartners !== undefined) out['visible_to_partners'] = b.visibleToPartners;
  if (b.emailFrom !== undefined) out['email_from'] = b.emailFrom;
  if (b.emailSubject !== undefined) out['email_subject'] = b.emailSubject;
  return out;
}

export function creativesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const { rows } = await query<Row & { offer_name: string; offer_ref: string }>(
      `SELECT c.*, o.name AS offer_name, o.ref AS offer_ref
         FROM offer_creatives c JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
        WHERE c.network_id = $1 ORDER BY c.created_at DESC LIMIT 1000`,
      [req.scope!.networkId],
    );
    sendOk(res, rows.map(dto));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Creative not found');
    sendOk(res, dto(row));
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Creative not found');
    const { rows } = await query<{ id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, TABLE, req.params.id],
    );
    sendOk(res, rows.map((h) => {
      const suffix = h.action.split('.').pop() ?? '';
      return {
        id: h.id, operationTime: h.created_at, service: 'creative', changes: h.action,
        employee: h.actor_id, method: { create: 'POST', update: 'PATCH', delete: 'DELETE' }[suffix] ?? '—',
        portal: h.actor_type === 'user' ? 'Dashboard' : h.actor_type === 'api_key' ? 'API' : h.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
        userIp: h.ip, userAgent: h.user_agent,
      };
    }));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(bodySchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof bodySchema>;
    const created: Row[] = [];
    for (const offerId of b.offerIds) {
      const offer = await db.selectOne('offers', { id: offerId });
      if (!offer) throw badRequest('offerIds contains an offer outside this network');
      const row = await db.insert<Row>(TABLE, { offer_id: offerId, ...columns(b) });
      await writeAudit(req, { action: 'offer.creative.create', entityType: TABLE, entityId: row.id, after: row });
      created.push(row);
    }
    res.status(201);
    sendOk(res, created.map(dto));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateBodySchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Creative not found');
    const b = req.body as z.infer<typeof updateBodySchema>;
    const patch = columns(b);
    const extraOfferIds = (b.offerIds ?? []).filter((id) => id !== before.offer_id);

    const [row] = Object.keys(patch).length
      ? await db.update<Row>(TABLE, patch, { id: req.params.id })
      : [before];
    await writeAudit(req, { action: 'offer.creative.update', entityType: TABLE, entityId: req.params.id, before, after: row });

    // A creative can target several offers; the reference stores one row per offer. Newly-added
    // offers on Edit fan out into new sibling rows (same content, matching Add's own behavior) —
    // existing sibling rows for offers no longer selected are left as-is (this endpoint edits one
    // row's own content, not the whole fanned-out set).
    const fanned: Row[] = [];
    for (const offerId of extraOfferIds) {
      const offer = await db.selectOne('offers', { id: offerId });
      if (!offer) throw badRequest('offerIds contains an offer outside this network');
      const clone = await db.insert<Row>(TABLE, { offer_id: offerId, ...columns({ ...dtoToBody(row ?? before), ...b }) });
      await writeAudit(req, { action: 'offer.creative.create', entityType: TABLE, entityId: clone.id, after: clone });
      fanned.push(clone);
    }

    sendOk(res, [row ?? before, ...fanned].map(dto));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Creative not found');
    await writeAudit(req, { action: 'offer.creative.delete', entityType: TABLE, entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}

function dtoToBody(row: Row): Partial<z.infer<typeof bodySchema>> {
  return {
    name: row.name, type: row.type as z.infer<typeof bodySchema>['type'], url: row.url, html: row.html,
    width: row.width, height: row.height, language: row.language,
    status: row.status as z.infer<typeof bodySchema>['status'], visibleToPartners: row.visible_to_partners,
    emailFrom: row.email_from, emailSubject: row.email_subject,
  };
}
