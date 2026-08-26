/**
 * Manage Postback Controls (Advertisers › Postback Controls) — rules that automatically accept,
 * reject, or hold incoming conversions based on real conversion-time variables, optionally scoped
 * to specific Offers/Advertisers and/or Partners. This is REAL enforcement, not just CRUD: active
 * controls are evaluated by recordConversion() (see tracking/conversions/record.ts) via the shared
 * evaluator in lib/postback-controls/evaluate.ts. Tenant-scoped by network_id (§3A).
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
import { RULE_VARIABLES, RULE_OPERATORS } from '../../../lib/postback-controls/evaluate.js';

const TABLE = 'advertiser_postback_controls';

interface Row {
  id: string; ref: string; name: string; status: string;
  effective_start: string | null; effective_end: string | null;
  control_type: string; target_type: string | null; target_ids: string[]; partner_ids: string[];
  condition_logic: string; rules: unknown;
  created_at: string; updated_at: string;
}

const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, status: r.status,
  effectiveStart: r.effective_start, effectiveEnd: r.effective_end,
  controlType: r.control_type, targetType: r.target_type,
  targetIds: r.target_ids, partnerIds: r.partner_ids,
  conditionLogic: r.condition_logic, rules: r.rules,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'postback-control', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const ruleSchema = z.object({
  variable: z.enum(RULE_VARIABLES),
  operator: z.enum(RULE_OPERATORS),
  value: z.string().max(200),
});
const baseSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'inactive']).default('active'),
  effectiveStart: z.string().datetime().nullable().optional(),
  effectiveEnd: z.string().datetime().nullable().optional(),
  controlType: z.enum(['accept', 'reject', 'hold']),
  targetType: z.enum(['offer', 'advertiser']).nullable().optional(),
  targetIds: z.array(z.string().uuid()).max(500).default([]),
  partnerIds: z.array(z.string().uuid()).max(500).default([]),
  conditionLogic: z.enum(['all', 'any']).default('all'),
  rules: z.array(ruleSchema).max(20).default([]),
}).refine((b) => !b.effectiveStart || !b.effectiveEnd || b.effectiveEnd >= b.effectiveStart, {
  message: 'effectiveEnd must be on or after effectiveStart', path: ['effectiveEnd'],
});
const createSchema = baseSchema;
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  effectiveStart: z.string().datetime().nullable().optional(),
  effectiveEnd: z.string().datetime().nullable().optional(),
  controlType: z.enum(['accept', 'reject', 'hold']).optional(),
  targetType: z.enum(['offer', 'advertiser']).nullable().optional(),
  targetIds: z.array(z.string().uuid()).max(500).optional(),
  partnerIds: z.array(z.string().uuid()).max(500).optional(),
  conditionLogic: z.enum(['all', 'any']).optional(),
  rules: z.array(ruleSchema).max(20).optional(),
});

export function postbackControlsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'active');
    const q = req.query['q'] ? String(req.query['q']) : null;
    const params: unknown[] = [networkId];
    let where = 'network_id = $1';
    if (statusParam !== 'all') { params.push(statusParam); where += ` AND status = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND name ILIKE $${params.length}`; }
    const { rows } = await query<Row>(`SELECT * FROM ${TABLE} WHERE ${where} ORDER BY ref ASC LIMIT 1000`, params);
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    if (b.targetType && b.targetIds.length === 0) throw badRequest('targetIds is required when targetType is set');
    const row = await db.insert<Row>(TABLE, {
      name: b.name, status: b.status,
      effective_start: b.effectiveStart ?? null, effective_end: b.effectiveEnd ?? null,
      control_type: b.controlType, target_type: b.targetType ?? null,
      target_ids: b.targetIds, partner_ids: b.partnerIds,
      condition_logic: b.conditionLogic, rules: JSON.stringify(b.rules),
    });
    await writeAudit(req, { action: 'postback-control.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<Row>(`SELECT * FROM ${TABLE} WHERE id = $1 AND network_id = $2`, [req.params.id, req.scope!.networkId]);
    if (!rows[0]) throw notFound('Postback control not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Postback control not found');
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.effectiveStart !== undefined) patch['effective_start'] = b.effectiveStart;
    if (b.effectiveEnd !== undefined) patch['effective_end'] = b.effectiveEnd;
    if (b.controlType !== undefined) patch['control_type'] = b.controlType;
    if (b.targetType !== undefined) patch['target_type'] = b.targetType;
    if (b.targetIds !== undefined) patch['target_ids'] = b.targetIds;
    if (b.partnerIds !== undefined) patch['partner_ids'] = b.partnerIds;
    if (b.conditionLogic !== undefined) patch['condition_logic'] = b.conditionLogic;
    if (b.rules !== undefined) patch['rules'] = JSON.stringify(b.rules);
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Postback control not found');
    await writeAudit(req, { action: 'postback-control.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Postback control not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'postback-control.delete', entityType: TABLE, entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Postback control not found');
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
