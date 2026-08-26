/**
 * Manage Applications (Partners › Offer Applications) — approval workflow layered on the existing
 * offer_publisher_access grants (created via the per-offer Access tab when a Partner requests, or
 * is granted, access to a gated Offer). Approve sets approval_status='approved' + access='allow'
 * (the pair the portal's offer-visibility gate already checks); Reject sets 'rejected' + 'deny'.
 * Tenant-scoped by network_id (§3A).
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

const TABLE = 'offer_publisher_access';

interface ListRow {
  id: string; approval_status: string; access: string; created_at: string; updated_at: string;
  publisher_id: string; publisher_ref: number; publisher_name: string;
  offer_id: string; offer_ref: number; offer_name: string;
  partner_manager_id: string | null; partner_manager_name: string | null;
  questionnaire_id: string | null; questionnaire_name: string | null;
}

const dto = (r: ListRow) => ({
  id: r.id, status: r.approval_status, access: r.access,
  publisherId: r.publisher_id, publisherRef: r.publisher_ref, publisherName: r.publisher_name,
  offerId: r.offer_id, offerRef: r.offer_ref, offerName: r.offer_name,
  partnerManagerId: r.partner_manager_id, partnerManagerName: r.partner_manager_name,
  questionnaireId: r.questionnaire_id, questionnaireName: r.questionnaire_name,
  requestDate: r.created_at, latestUpdate: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'offer_application', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const SELECT = `
  SELECT a.id, a.approval_status, a.access, a.created_at, a.updated_at,
         p.id AS publisher_id, p.ref AS publisher_ref, p.name AS publisher_name,
         o.id AS offer_id, o.ref AS offer_ref, o.name AS offer_name,
         u.id AS partner_manager_id, u.name AS partner_manager_name,
         q.id AS questionnaire_id, q.name AS questionnaire_name
    FROM offer_publisher_access a
    JOIN publishers p ON p.id = a.publisher_id AND p.network_id = a.network_id
    JOIN offers o ON o.id = a.offer_id AND o.network_id = a.network_id
    LEFT JOIN users u ON u.id = p.partner_manager_id
    LEFT JOIN questionnaires q ON q.id = o.questionnaire_id
`;

export function offerApplicationsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'pending');
    const params: unknown[] = [networkId];
    let where = 'a.network_id = $1';
    if (statusParam !== 'all') { where += ` AND a.approval_status = $2`; params.push(statusParam); }
    const { rows } = await query<ListRow>(`${SELECT} WHERE ${where} ORDER BY a.created_at DESC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  const decisionSchema = z.object({ status: z.enum(['approved', 'rejected']) });

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(decisionSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<{ id: string }>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Application not found');
    const b = req.body as z.infer<typeof decisionSchema>;
    const access = b.status === 'approved' ? 'allow' : 'deny';
    const [row] = await db.update(TABLE, { approval_status: b.status, access }, { id: req.params.id });
    if (!row) throw notFound('Application not found');
    await writeAudit(req, {
      action: b.status === 'approved' ? 'offer_application.approve' : 'offer_application.reject',
      entityType: 'offer_application', entityId: req.params.id, before, after: row,
    });
    const { rows } = await query<ListRow>(`${SELECT} WHERE a.id = $1 AND a.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, rows[0] ? dto(rows[0]) : null);
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Application not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'offer_application' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}
