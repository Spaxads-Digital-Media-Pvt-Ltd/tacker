/**
 * Manage Tiered Commissions (Advertisers › Tiered Commissions) — volume-based payout/revenue
 * adjustment rules. Real enforcement (not just CRUD): active commissions are evaluated by
 * recordConversion() via lib/tiered-commissions/evaluate.ts. Tenant-scoped by network_id (§3A).
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
import { TIERED_VARIABLES, TIERED_ACTIONS, TIME_PERIODS } from '../../../lib/tiered-commissions/evaluate.js';

const TABLE = 'advertiser_tiered_commissions';

interface Row {
  id: string; ref: string; name: string; status: string; notes: string | null;
  effective_start: string | null; effective_end: string | null;
  target_type: string; target_ids: string[]; partner_ids: string[];
  time_period: string; retroactive_mode: string; goals: unknown;
  payout_enabled: boolean; payout_action: string | null; payout_value: string | null;
  revenue_enabled: boolean; revenue_action: string | null; revenue_value: string | null;
  created_at: string; updated_at: string;
}

const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, status: r.status, notes: r.notes,
  effectiveStart: r.effective_start, effectiveEnd: r.effective_end,
  targetType: r.target_type, targetIds: r.target_ids, partnerIds: r.partner_ids,
  timePeriod: r.time_period, retroactiveMode: r.retroactive_mode, goals: r.goals,
  payoutEnabled: r.payout_enabled, payoutAction: r.payout_action, payoutValue: r.payout_value,
  revenueEnabled: r.revenue_enabled, revenueAction: r.revenue_action, revenueValue: r.revenue_value,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'tiered-commission', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

const goalSchema = z.object({
  variable: z.enum(TIERED_VARIABLES),
  minValue: z.number().min(0),
  maxValue: z.number().min(0).nullable().optional(),
});
const baseSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: z.string().max(2000).nullable().optional(),
  effectiveStart: z.string().datetime().nullable().optional(),
  effectiveEnd: z.string().datetime().nullable().optional(),
  targetType: z.enum(['offer', 'advertiser']),
  targetIds: z.array(z.string().uuid()).min(1).max(500),
  partnerIds: z.array(z.string().uuid()).max(500).default([]),
  timePeriod: z.enum(TIME_PERIODS),
  retroactiveMode: z.enum(['disabled', 'enabled', 'custom']).default('disabled'),
  goals: z.array(goalSchema).min(1).max(20),
  payoutEnabled: z.boolean().default(false),
  payoutAction: z.enum(TIERED_ACTIONS).nullable().optional(),
  payoutValue: z.number().nullable().optional(),
  revenueEnabled: z.boolean().default(false),
  revenueAction: z.enum(TIERED_ACTIONS).nullable().optional(),
  revenueValue: z.number().nullable().optional(),
}).refine((b) => !b.effectiveStart || !b.effectiveEnd || b.effectiveEnd >= b.effectiveStart, {
  message: 'effectiveEnd must be on or after effectiveStart', path: ['effectiveEnd'],
}).refine((b) => !b.payoutEnabled || (b.payoutAction && b.payoutValue != null), {
  message: 'payoutAction and payoutValue are required when payoutEnabled', path: ['payoutAction'],
}).refine((b) => !b.revenueEnabled || (b.revenueAction && b.revenueValue != null), {
  message: 'revenueAction and revenueValue are required when revenueEnabled', path: ['revenueAction'],
});
const createSchema = baseSchema;
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().max(2000).nullable().optional(),
  effectiveStart: z.string().datetime().nullable().optional(),
  effectiveEnd: z.string().datetime().nullable().optional(),
  targetType: z.enum(['offer', 'advertiser']).optional(),
  targetIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  partnerIds: z.array(z.string().uuid()).max(500).optional(),
  timePeriod: z.enum(TIME_PERIODS).optional(),
  retroactiveMode: z.enum(['disabled', 'enabled', 'custom']).optional(),
  goals: z.array(goalSchema).min(1).max(20).optional(),
  payoutEnabled: z.boolean().optional(),
  payoutAction: z.enum(TIERED_ACTIONS).nullable().optional(),
  payoutValue: z.number().nullable().optional(),
  revenueEnabled: z.boolean().optional(),
  revenueAction: z.enum(TIERED_ACTIONS).nullable().optional(),
  revenueValue: z.number().nullable().optional(),
});

export function tieredCommissionsRoutes(): Router {
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
    const row = await db.insert<Row>(TABLE, {
      name: b.name, status: b.status, notes: b.notes ?? null,
      effective_start: b.effectiveStart ?? null, effective_end: b.effectiveEnd ?? null,
      target_type: b.targetType, target_ids: b.targetIds, partner_ids: b.partnerIds,
      time_period: b.timePeriod, retroactive_mode: b.retroactiveMode, goals: JSON.stringify(b.goals),
      payout_enabled: b.payoutEnabled, payout_action: b.payoutAction ?? null, payout_value: b.payoutValue ?? null,
      revenue_enabled: b.revenueEnabled, revenue_action: b.revenueAction ?? null, revenue_value: b.revenueValue ?? null,
    });
    await writeAudit(req, { action: 'tiered-commission.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query<Row>(`SELECT * FROM ${TABLE} WHERE id = $1 AND network_id = $2`, [req.params.id, req.scope!.networkId]);
    if (!rows[0]) throw notFound('Tiered commission not found');
    sendOk(res, dto(rows[0]));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Tiered commission not found');
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.payoutEnabled && !b.payoutAction && !before.payout_action) throw badRequest('payoutAction is required when payoutEnabled');
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.notes !== undefined) patch['notes'] = b.notes;
    if (b.effectiveStart !== undefined) patch['effective_start'] = b.effectiveStart;
    if (b.effectiveEnd !== undefined) patch['effective_end'] = b.effectiveEnd;
    if (b.targetType !== undefined) patch['target_type'] = b.targetType;
    if (b.targetIds !== undefined) patch['target_ids'] = b.targetIds;
    if (b.partnerIds !== undefined) patch['partner_ids'] = b.partnerIds;
    if (b.timePeriod !== undefined) patch['time_period'] = b.timePeriod;
    if (b.retroactiveMode !== undefined) patch['retroactive_mode'] = b.retroactiveMode;
    if (b.goals !== undefined) patch['goals'] = JSON.stringify(b.goals);
    if (b.payoutEnabled !== undefined) patch['payout_enabled'] = b.payoutEnabled;
    if (b.payoutAction !== undefined) patch['payout_action'] = b.payoutAction;
    if (b.payoutValue !== undefined) patch['payout_value'] = b.payoutValue;
    if (b.revenueEnabled !== undefined) patch['revenue_enabled'] = b.revenueEnabled;
    if (b.revenueAction !== undefined) patch['revenue_action'] = b.revenueAction;
    if (b.revenueValue !== undefined) patch['revenue_value'] = b.revenueValue;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Tiered commission not found');
    await writeAudit(req, { action: 'tiered-commission.update', entityType: TABLE, entityId: req.params.id, before, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Tiered commission not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'tiered-commission.delete', entityType: TABLE, entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Tiered commission not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, TABLE, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  // Summary tab (reference's "Summary" view): real per-Partner/Offer performance for a selected
  // tiered commission's scope, sourced from actual conversions — not fabricated projections.
  r.get('/:id/summary', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const commission = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!commission) throw notFound('Tiered commission not found');
    const targetCol = commission.target_type === 'offer' ? 'c.offer_id' : 'c.advertiser_id';
    const params: unknown[] = [req.scope!.networkId];
    let where = `c.network_id = $1 AND c.status = 'approved'`;
    if (commission.target_ids.length > 0) { params.push(commission.target_ids); where += ` AND ${targetCol} = ANY($${params.length})`; }
    if (commission.partner_ids.length > 0) { params.push(commission.partner_ids); where += ` AND c.publisher_id = ANY($${params.length})`; }
    const { rows } = await query<{
      publisher_id: string; publisher_name: string; offer_id: string; offer_name: string;
      conversions: string; revenue: string; payout: string;
    }>(
      `SELECT c.publisher_id, p.name AS publisher_name, c.offer_id, o.name AS offer_name,
              COUNT(*)::text AS conversions, COALESCE(SUM(c.revenue),0)::text AS revenue, COALESCE(SUM(c.payout),0)::text AS payout
         FROM conversions c
         JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
         LEFT JOIN publishers p ON p.id = c.publisher_id AND p.network_id = c.network_id
        WHERE ${where}
        GROUP BY c.publisher_id, p.name, c.offer_id, o.name
        ORDER BY conversions DESC LIMIT 200`,
      params,
    );
    sendOk(res, rows.map((r) => ({
      publisherId: r.publisher_id, publisherName: r.publisher_name ?? 'Unknown', offerId: r.offer_id, offerName: r.offer_name,
      conversions: Number(r.conversions), revenue: r.revenue, payout: r.payout,
    })));
  }));

  return r;
}
