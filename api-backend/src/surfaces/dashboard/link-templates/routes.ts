/**
 * Manage Link Templates (Advertisers › Link Templates) — default landing page URL templates per
 * Advertiser, macro-parameterized (e.g. {advertiser_id}, {sub1}), matching the reference's "Manage
 * Link Templates" page. Tenant-scoped by network_id (§3A).
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

const TABLE = 'advertiser_link_templates';

interface Row {
  id: string; ref: string; advertiser_id: string; name: string; destination_url: string;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row { advertiser_ref: number; advertiser_name: string }

const dto = (r: JoinedRow) => ({
  id: r.id, ref: Number(r.ref),
  advertiserId: r.advertiser_id, advertiserRef: r.advertiser_ref, advertiserName: r.advertiser_name,
  name: r.name, destinationUrl: r.destination_url,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'link-template', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const SELECT = `
  SELECT t.*, a.ref AS advertiser_ref, a.name AS advertiser_name
    FROM advertiser_link_templates t
    JOIN advertisers a ON a.id = t.advertiser_id AND a.network_id = t.network_id
`;

const baseSchema = z.object({
  name: z.string().min(1).max(200),
  advertiserId: z.string().uuid(),
  destinationUrl: z.string().min(1).max(2000),
});
const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

export function linkTemplatesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const q = req.query['q'] ? String(req.query['q']) : null;
    const params: unknown[] = [networkId];
    let where = 't.network_id = $1';
    if (q) { params.push(`%${q}%`); where += ` AND t.name ILIKE $${params.length}`; }
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    const advertiser = await db.selectOne('advertisers', { id: b.advertiserId });
    if (!advertiser) throw badRequest('advertiserId does not belong to this network');
    const row = await db.insert<Row>(TABLE, {
      name: b.name, advertiser_id: b.advertiserId, destination_url: b.destinationUrl,
    });
    await writeAudit(req, { action: 'link-template.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE t.id = $1 AND t.network_id = $2`, [row.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE t.id = $1 AND t.network_id = $2`, [req.params.id, req.scope!.networkId]);
    if (!rows[0]) throw notFound('Link template not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Link template not found');
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.advertiserId) {
      const advertiser = await db.selectOne('advertisers', { id: b.advertiserId });
      if (!advertiser) throw badRequest('advertiserId does not belong to this network');
    }
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.advertiserId !== undefined) patch['advertiser_id'] = b.advertiserId;
    if (b.destinationUrl !== undefined) patch['destination_url'] = b.destinationUrl;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Link template not found');
    await writeAudit(req, { action: 'link-template.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    const { rows } = await query<JoinedRow>(`${SELECT} WHERE t.id = $1 AND t.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, dto(rows[0]!));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Link template not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'link-template.delete', entityType: TABLE, entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Link template not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, TABLE, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}
