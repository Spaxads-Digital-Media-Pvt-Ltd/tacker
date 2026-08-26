/**
 * Manage Traffic Sources (Partners › Traffic Sources) — reusable presets of tracking-link query
 * parameters (Parameter/Value pairs, values often containing macros like {sub1}) a Partner picks
 * when generating a link, plus an optional postback URL fired on conversion. Tenant-scoped by
 * network_id (§3A).
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

const TABLE = 'traffic_sources';

interface Param { parameter: string; value: string }
interface Row {
  id: string; name: string; enable_postback: boolean; postback_url: string | null;
  visible_to_partners: boolean; parameters: Param[]; created_at: string; updated_at: string;
}

const dto = (r: Row) => ({
  id: r.id, name: r.name, enablePostback: r.enable_postback, postbackUrl: r.postback_url,
  visibleToPartners: r.visible_to_partners, parameters: r.parameters ?? [],
  trackingLinkParameters: (r.parameters ?? []).map((p) => `${p.parameter}=${p.value}`).join('&'),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const paramSchema = z.object({ parameter: z.string().min(1).max(120), value: z.string().min(1).max(500) });
const baseSchema = z.object({
  name: z.string().min(1).max(120),
  enablePostback: z.boolean().default(false),
  postbackUrl: z.string().max(2000).nullable().optional(),
  visibleToPartners: z.boolean().default(false),
  parameters: z.array(paramSchema).min(1),
}).refine((v) => !v.enablePostback || Boolean(v.postbackUrl && v.postbackUrl.length > 0), {
  message: 'postbackUrl is required when enablePostback is true', path: ['postbackUrl'],
});
const updateBaseSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enablePostback: z.boolean().optional(),
  postbackUrl: z.string().max(2000).nullable().optional(),
  visibleToPartners: z.boolean().optional(),
  parameters: z.array(paramSchema).min(1).optional(),
});

export function trafficSourcesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where: {}, limit: 500, orderBy: 'created_at', orderDir: 'desc' });
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(baseSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof baseSchema>;
    const row = await db.insert<Row>(TABLE, {
      name: b.name, enable_postback: b.enablePostback, postback_url: b.enablePostback ? b.postbackUrl : null,
      visible_to_partners: b.visibleToPartners, parameters: JSON.stringify(b.parameters),
    });
    await writeAudit(req, { action: 'traffic_source.create', entityType: 'traffic_source', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto({ ...row, parameters: b.parameters }));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Traffic source not found');
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateBaseSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Traffic source not found');
    const b = req.body as z.infer<typeof updateBaseSchema>;
    const nextEnablePostback = b.enablePostback ?? before.enable_postback;
    const nextPostbackUrl = b.postbackUrl !== undefined ? b.postbackUrl : before.postback_url;
    if (nextEnablePostback && !nextPostbackUrl) {
      throw badRequest('postbackUrl is required when enablePostback is true');
    }
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.enablePostback !== undefined) patch['enable_postback'] = b.enablePostback;
    if (b.postbackUrl !== undefined || b.enablePostback !== undefined) patch['postback_url'] = nextEnablePostback ? nextPostbackUrl : null;
    if (b.visibleToPartners !== undefined) patch['visible_to_partners'] = b.visibleToPartners;
    if (b.parameters !== undefined) patch['parameters'] = JSON.stringify(b.parameters);
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Traffic source not found');
    await writeAudit(req, { action: 'traffic_source.update', entityType: 'traffic_source', entityId: req.params.id, before, after: row });
    sendOk(res, dto({ ...row, parameters: b.parameters ?? before.parameters }));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Traffic source not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'traffic_source.delete', entityType: 'traffic_source', entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  return r;
}
