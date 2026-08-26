/**
 * Manage Postbacks (Partners › Postbacks › Manage) — the network-wide postback list, a first-class
 * page in the reference distinct from the per-offer/per-publisher nested postback tabs (which read
 * the same publisher_postbacks table, just pre-filtered). "Postback Level" (Global / Specific /
 * Global (Offer)) is derived from which of publisher_id/offer_id are set, not stored — Global means
 * "every offer for this partner", Global (Offer) means "every partner on this offer", Specific
 * means both. Tenant-scoped by network_id (spec §3A).
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
import { firePostbackTest, sampleMacros } from '../../../lib/postback/test.js';
import { requireRole } from '../auth.js';

const TABLE = 'publisher_postbacks';

interface Row {
  id: string; publisher_id: string | null; offer_id: string | null; level: string;
  delivery_method: string; html_code: string | null; description: string | null; delay: string | null;
  event: string | null; url: string | null; method: string; status: string;
  created_at: string; updated_at: string;
}
interface JoinedRow extends Row { publisher_name: string | null; offer_name: string | null }

const scopeOf = (r: { publisher_id: string | null; offer_id: string | null }): 'specific' | 'global' | 'global_offer' =>
  (r.publisher_id && r.offer_id) ? 'specific' : r.publisher_id ? 'global' : 'global_offer';

const dto = (r: JoinedRow) => ({
  id: r.id, publisherId: r.publisher_id, publisherName: r.publisher_name, offerId: r.offer_id, offerName: r.offer_name,
  scope: scopeOf(r), postbackType: r.level, deliveryMethod: r.delivery_method, htmlCode: r.html_code,
  description: r.description, delay: r.delay, event: r.event, url: r.url, method: r.method, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const baseSchema = z.object({
  status: z.enum(['active', 'disabled']).default('active'),
  description: z.string().max(1000).nullable().optional(),
  postbackType: z.enum(['conversion', 'event', 'cpc']).default('conversion'),
  publisherId: z.string().uuid().nullable().optional(),
  offerId: z.string().uuid().nullable().optional(),
  deliveryMethod: z.enum(['postback', 'html', 'meta', 'tiktok', 'snapchat', 'rumble']).default('postback'),
  method: z.enum(['GET', 'POST']).default('GET'),
  url: z.string().url().max(2000).nullable().optional(),
  htmlCode: z.string().max(20_000).nullable().optional(),
  event: z.string().max(100).nullable().optional(),
  delay: z.string().max(100).nullable().optional(),
});
const createSchema = baseSchema.refine((b) => b.publisherId || b.offerId, { message: 'publisherId or offerId is required' })
  .refine((b) => (b.deliveryMethod === 'html' ? Boolean(b.htmlCode) : Boolean(b.url)), { message: 'url is required unless deliveryMethod is html' });
const updateSchema = baseSchema.partial();

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'postback', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};
export function postbacksRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const { rows } = await query<JoinedRow>(
      `SELECT pb.*, p.name AS publisher_name, o.name AS offer_name
         FROM publisher_postbacks pb
         LEFT JOIN publishers p ON p.id = pb.publisher_id AND p.network_id = pb.network_id
         LEFT JOIN offers o ON o.id = pb.offer_id AND o.network_id = pb.network_id
        WHERE pb.network_id = $1
        ORDER BY pb.created_at DESC LIMIT 1000`,
      [req.scope!.networkId],
    );
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    if (b.publisherId) {
      const pub = await db.selectOne('publishers', { id: b.publisherId });
      if (!pub) throw badRequest('publisherId does not belong to this network');
    }
    if (b.offerId) {
      const offer = await db.selectOne('offers', { id: b.offerId });
      if (!offer) throw badRequest('offerId does not belong to this network');
    }
    const row = await db.insert<Row>(TABLE, {
      publisher_id: b.publisherId ?? null, offer_id: b.offerId ?? null, level: b.postbackType,
      delivery_method: b.deliveryMethod, html_code: b.htmlCode ?? null, description: b.description ?? null,
      delay: b.delay ?? null, event: b.event ?? null, url: b.url ?? null, method: b.method, status: b.status,
    });
    await writeAudit(req, { action: 'postback.create', entityType: 'postback', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto({ ...row, publisher_name: null, offer_name: null }));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<JoinedRow>(
      `SELECT pb.*, p.name AS publisher_name, o.name AS offer_name
         FROM publisher_postbacks pb
         LEFT JOIN publishers p ON p.id = pb.publisher_id AND p.network_id = pb.network_id
         LEFT JOIN offers o ON o.id = pb.offer_id AND o.network_id = pb.network_id
        WHERE pb.network_id = $1 AND pb.id = $2`,
      [req.scope!.networkId, req.params.id],
    );
    if (!rows[0]) throw notFound('Postback not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Postback not found');
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.publisherId) {
      const pub = await db.selectOne('publishers', { id: b.publisherId });
      if (!pub) throw badRequest('publisherId does not belong to this network');
    }
    if (b.offerId) {
      const offer = await db.selectOne('offers', { id: b.offerId });
      if (!offer) throw badRequest('offerId does not belong to this network');
    }
    const patch: Record<string, unknown> = {};
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.description !== undefined) patch['description'] = b.description;
    if (b.postbackType !== undefined) patch['level'] = b.postbackType;
    if (b.publisherId !== undefined) patch['publisher_id'] = b.publisherId;
    if (b.offerId !== undefined) patch['offer_id'] = b.offerId;
    if (b.deliveryMethod !== undefined) patch['delivery_method'] = b.deliveryMethod;
    if (b.method !== undefined) patch['method'] = b.method;
    if (b.url !== undefined) patch['url'] = b.url;
    if (b.htmlCode !== undefined) patch['html_code'] = b.htmlCode;
    if (b.event !== undefined) patch['event'] = b.event;
    if (b.delay !== undefined) patch['delay'] = b.delay;
    const [row] = await db.update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Postback not found');
    await writeAudit(req, { action: 'postback.update', entityType: 'postback', entityId: req.params.id, before, after: row });
    sendOk(res, dto({ ...row, publisher_name: null, offer_name: null }));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Postback not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'postback.delete', entityType: 'postback', entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  r.post('/:id/test', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Postback not found');
    if (!row.url) throw badRequest('This postback has no URL to test (HTML delivery methods fire client-side).');
    const result = await firePostbackTest(row.url, row.method as 'GET' | 'POST', sampleMacros({ publisher_id: row.publisher_id ?? 'test-publisher' }));
    await writeAudit(req, { action: 'postback.test', entityType: 'postback', entityId: row.id, after: result });
    sendOk(res, result);
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Postback not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'postback' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}
