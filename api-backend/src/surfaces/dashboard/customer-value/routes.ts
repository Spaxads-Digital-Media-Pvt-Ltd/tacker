/**
 * Customer Value (Customer Value › Custom Data Points / Payout & Revenue Rules / Conversion
 * Events Report). Real enforcement, not just CRUD: active rules are evaluated by
 * recordConversion() via lib/customer-value/evaluate.ts. Tenant-scoped by network_id (§3A).
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
import { CV_TEXT_OPERATORS, CV_NUMBER_OPERATORS } from '../../../lib/customer-value/evaluate.js';

const DATA_POINTS_TABLE = 'customer_data_points';
const RULES_TABLE = 'customer_value_rules';

// ---- Custom Data Points ----
interface DataPointRow {
  id: string; ref: string; name: string; data_type: string; parameter_key: string; created_at: string; updated_at: string;
}
const dataPointDto = (r: DataPointRow) => ({
  id: r.id, ref: Number(r.ref), name: r.name, dataType: r.data_type, parameterKey: r.parameter_key,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const dataPointSchema = z.object({
  name: z.string().min(1).max(200),
  dataType: z.enum(['text', 'number']),
  parameterKey: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers, underscore only'),
});

// ---- Payout & Revenue Rules ----
interface RuleRow {
  id: string; ref: string; name: string; status: string;
  conversion_event_grouping: string;
  apply_offers_mode: string; apply_offer_ids: string[];
  apply_advertisers_mode: string; apply_advertiser_ids: string[];
  apply_partners_mode: string; apply_partner_ids: string[];
  start_date: string | null; end_date: string | null;
  goal_cycle: string; recurring_duration: string | null;
  continuous_mode: string | null; continuous_days: number | null;
  set_goal_conditions: boolean; conditions: unknown;
  outcome_frequency: string; payout_value: string | null; revenue_value: string | null;
  created_at: string; updated_at: string;
}
const ruleDto = (r: RuleRow) => ({
  id: r.id, ref: Number(r.ref), name: r.name, status: r.status,
  conversionEventGrouping: r.conversion_event_grouping,
  applyOffersMode: r.apply_offers_mode, applyOfferIds: r.apply_offer_ids,
  applyAdvertisersMode: r.apply_advertisers_mode, applyAdvertiserIds: r.apply_advertiser_ids,
  applyPartnersMode: r.apply_partners_mode, applyPartnerIds: r.apply_partner_ids,
  startDate: r.start_date, endDate: r.end_date,
  goalCycle: r.goal_cycle, recurringDuration: r.recurring_duration,
  continuousMode: r.continuous_mode, continuousDays: r.continuous_days,
  setGoalConditions: r.set_goal_conditions, conditions: r.conditions,
  outcomeFrequency: r.outcome_frequency, payoutValue: r.payout_value, revenueValue: r.revenue_value,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const conditionSchema = z.object({
  dataPointId: z.string().uuid(),
  conditionLogic: z.enum(['any_value', 'sum_of_values']),
  operator: z.enum([...CV_TEXT_OPERATORS, ...CV_NUMBER_OPERATORS]),
  value: z.string().min(1).max(200),
});

const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'inactive']).default('active'),
  conversionEventGrouping: z.enum(['all_together', 'separately_by']).default('all_together'),
  applyOffersMode: z.enum(['all', 'specific']).default('all'),
  applyOfferIds: z.array(z.string().uuid()).max(500).default([]),
  applyAdvertisersMode: z.enum(['all', 'specific']).default('all'),
  applyAdvertiserIds: z.array(z.string().uuid()).max(500).default([]),
  applyPartnersMode: z.enum(['all', 'specific']).default('all'),
  applyPartnerIds: z.array(z.string().uuid()).max(500).default([]),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  goalCycle: z.enum(['recurring', 'continuous']).default('continuous'),
  recurringDuration: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).nullable().optional(),
  continuousMode: z.enum(['from_first_conversion', 'for_rule_duration']).nullable().optional(),
  continuousDays: z.number().int().min(1).max(3650).nullable().optional(),
  setGoalConditions: z.boolean().default(false),
  conditions: z.array(conditionSchema).max(20).default([]),
  outcomeFrequency: z.enum(['once_per_customer', 'every_cycle']).default('once_per_customer'),
  payoutValue: z.number().min(0).nullable().optional(),
  revenueValue: z.number().min(0).nullable().optional(),
}).refine((b) => b.applyOffersMode === 'all' || b.applyOfferIds.length > 0, {
  message: 'Select at least one Offer', path: ['applyOfferIds'],
}).refine((b) => b.applyAdvertisersMode === 'all' || b.applyAdvertiserIds.length > 0, {
  message: 'Select at least one Advertiser', path: ['applyAdvertiserIds'],
}).refine((b) => b.applyPartnersMode === 'all' || b.applyPartnerIds.length > 0, {
  message: 'Select at least one Partner', path: ['applyPartnerIds'],
}).refine((b) => b.goalCycle !== 'recurring' || b.recurringDuration, {
  message: 'recurringDuration is required for a Recurring Goal Cycle', path: ['recurringDuration'],
}).refine((b) => b.goalCycle !== 'continuous' || b.continuousMode, {
  message: 'continuousMode is required for a Continuous Goal Cycle', path: ['continuousMode'],
}).refine((b) => !b.setGoalConditions || b.conditions.length > 0, {
  message: 'At least one condition is required when Set Goal Conditions is Yes', path: ['conditions'],
}).refine((b) => b.payoutValue != null || b.revenueValue != null, {
  message: 'Set a Custom Payout and/or a Custom Revenue', path: ['payoutValue'],
});

function ruleToColumns(b: z.infer<typeof ruleSchema>): Record<string, unknown> {
  return {
    name: b.name, status: b.status, conversion_event_grouping: b.conversionEventGrouping,
    apply_offers_mode: b.applyOffersMode, apply_offer_ids: b.applyOfferIds,
    apply_advertisers_mode: b.applyAdvertisersMode, apply_advertiser_ids: b.applyAdvertiserIds,
    apply_partners_mode: b.applyPartnersMode, apply_partner_ids: b.applyPartnerIds,
    start_date: b.startDate || null, end_date: b.endDate || null,
    goal_cycle: b.goalCycle, recurring_duration: b.recurringDuration ?? null,
    continuous_mode: b.continuousMode ?? null, continuous_days: b.continuousDays ?? null,
    set_goal_conditions: b.setGoalConditions, conditions: JSON.stringify(b.conditions),
    outcome_frequency: b.outcomeFrequency, payout_value: b.payoutValue ?? null, revenue_value: b.revenueValue ?? null,
  };
}

export function customerValueRoutes(): Router {
  const r = Router();

  // Custom Data Points
  r.get('/data-points', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<DataPointRow>(DATA_POINTS_TABLE, { orderBy: 'ref', orderDir: 'asc', limit: 500 });
    sendOk(res, rows.map(dataPointDto));
  }));
  r.post('/data-points', requireRole('admin', 'manager'), validateBody(dataPointSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof dataPointSchema>;
    const row = await dbForRequest(req).insert<DataPointRow>(DATA_POINTS_TABLE, {
      name: b.name, data_type: b.dataType, parameter_key: b.parameterKey,
    });
    await writeAudit(req, { action: 'customer_data_point.create', entityType: DATA_POINTS_TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dataPointDto(row));
  }));
  r.patch('/data-points/:id', requireRole('admin', 'manager'), validateBody(dataPointSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof dataPointSchema>;
    const [row] = await dbForRequest(req).update<DataPointRow>(DATA_POINTS_TABLE, {
      name: b.name, data_type: b.dataType, parameter_key: b.parameterKey,
    }, { id: req.params.id });
    if (!row) throw notFound('Data point not found');
    await writeAudit(req, { action: 'customer_data_point.update', entityType: DATA_POINTS_TABLE, entityId: row.id, after: row });
    sendOk(res, dataPointDto(row));
  }));
  r.delete('/data-points/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(DATA_POINTS_TABLE, { id: req.params.id });
    if (!n) throw notFound('Data point not found');
    await writeAudit(req, { action: 'customer_data_point.delete', entityType: DATA_POINTS_TABLE, entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  // Payout & Revenue Rules
  r.get('/rules', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const statusParam = String(req.query['status'] ?? 'all');
    const params: unknown[] = [networkId];
    let where = 'network_id = $1';
    if (statusParam !== 'all') { params.push(statusParam); where += ` AND status = $${params.length}`; }
    const { rows } = await query<RuleRow>(`SELECT * FROM ${RULES_TABLE} WHERE ${where} ORDER BY ref ASC LIMIT 1000`, params);
    sendOk(res, rows.map(ruleDto));
  }));
  r.post('/rules', requireRole('admin', 'manager'), validateBody(ruleSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ruleSchema>;
    const row = await dbForRequest(req).insert<RuleRow>(RULES_TABLE, ruleToColumns(b));
    await writeAudit(req, { action: 'customer_value_rule.create', entityType: RULES_TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, ruleDto(row));
  }));
  r.get('/rules/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<RuleRow>(RULES_TABLE, { id: req.params.id });
    if (!row) throw notFound('Rule not found');
    sendOk(res, ruleDto(row));
  }));
  r.patch('/rules/:id', requireRole('admin', 'manager'), validateBody(ruleSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ruleSchema>;
    const [row] = await dbForRequest(req).update<RuleRow>(RULES_TABLE, ruleToColumns(b), { id: req.params.id });
    if (!row) throw notFound('Rule not found');
    await writeAudit(req, { action: 'customer_value_rule.update', entityType: RULES_TABLE, entityId: row.id, after: row });
    sendOk(res, ruleDto(row));
  }));
  r.delete('/rules/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(RULES_TABLE, { id: req.params.id });
    if (!n) throw notFound('Rule not found');
    await writeAudit(req, { action: 'customer_value_rule.delete', entityType: RULES_TABLE, entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  // Conversion Events Report — real debugging tool: enter a User ID, see every conversion that
  // carried it, the Custom Data Point values found on each, and which rule (if any) fired.
  r.get('/conversion-events', asyncHandler(async (req, res) => {
    const userId = typeof req.query['userId'] === 'string' ? req.query['userId'] : '';
    if (!userId) return sendOk(res, { userId: '', events: [] });
    const networkId = req.scope!.networkId;
    const from = typeof req.query['from'] === 'string' ? req.query['from'] : null;
    const to = typeof req.query['to'] === 'string' ? req.query['to'] : null;
    const limit = Math.min(Math.max(Number(req.query['limit']) || 26, 1), 500);
    const offset = Math.max(Number(req.query['offset']) || 0, 0);

    const { rows: dataPoints } = await query<DataPointRow>(
      `SELECT id, name, data_type, parameter_key FROM ${DATA_POINTS_TABLE} WHERE network_id = $1`, [networkId],
    );
    const params: unknown[] = [networkId, userId];
    let where = `c.network_id = $1 AND c.raw_params->>'user_id' = $2`;
    if (from) { params.push(from); where += ` AND c.created_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND c.created_at <= $${params.length}`; }
    params.push(limit, offset);
    const { rows } = await query<{
      conversion_id: string; created_at: string; offer_id: string; offer_name: string;
      event_name: string | null; status: string; payout: string | null; revenue: string | null;
      raw_params: Record<string, unknown>; rule_id: string | null; rule_name: string | null;
    }>(
      `SELECT c.conversion_id, c.created_at, c.offer_id, o.name AS offer_name, c.event_name, c.status,
              c.payout, c.revenue, c.raw_params, f.rule_id, cvr.name AS rule_name
         FROM conversions c
         JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
         LEFT JOIN customer_value_rule_firings f ON f.conversion_id = c.conversion_id AND f.network_id = c.network_id
         LEFT JOIN customer_value_rules cvr ON cvr.id = f.rule_id
        WHERE ${where}
        ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    sendOk(res, {
      userId,
      events: rows.map((row) => ({
        conversionId: row.conversion_id, createdAt: row.created_at, offerId: row.offer_id, offerName: row.offer_name,
        eventName: row.event_name, status: row.status, payout: row.payout, revenue: row.revenue,
        dataPoints: dataPoints
          .filter((dp) => row.raw_params[dp.parameter_key] != null)
          .map((dp) => ({ name: dp.name, parameterKey: dp.parameter_key, value: String(row.raw_params[dp.parameter_key]) })),
        ruleName: row.rule_name,
      })),
    });
  }));

  return r;
}
