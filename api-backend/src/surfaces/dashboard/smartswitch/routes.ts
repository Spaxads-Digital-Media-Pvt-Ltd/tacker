/**
 * SmartSwitch (Offers-flyout parity) — automatic optimization/fraud-protection rules. Every
 * create/update/delete auto-appends a row to smartswitch_history, so the History sub-tab is a
 * genuine audit trail rather than a static shell. Tenant-scoped by network_id (spec §3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const RULES = 'smartswitch_rules';
const HISTORY = 'smartswitch_history';

function actorId(req: import('express').Request): string | null {
  return req.identity?.surface === 'dashboard' ? req.identity.userId : null;
}

interface RuleRow {
  id: string; name: string; action: string; action_delay: string | null; variable: string | null;
  actionable_variables: string | null; offer_ids: string[]; advertiser_ids: string[]; partner_ids: string[];
  status: string; created_at: string; updated_at: string;
}
interface HistoryRow { id: string; rule_id: string | null; rule_name: string; change: string; employee: string | null; created_at: string }

const ruleDto = (r: RuleRow) => ({
  id: r.id, name: r.name, action: r.action, actionDelay: r.action_delay, variable: r.variable,
  actionableVariables: r.actionable_variables, offerIds: r.offer_ids, advertiserIds: r.advertiser_ids,
  partnerIds: r.partner_ids, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});
const historyDto = (r: HistoryRow) => ({ id: r.id, ruleId: r.rule_id, ruleName: r.rule_name, change: r.change, employee: r.employee, createdAt: r.created_at });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  action: z.enum(['notify', 'block']).default('notify'),
  actionDelay: z.string().nullable().optional(),
  variable: z.string().nullable().optional(),
  actionableVariables: z.string().nullable().optional(),
  offerIds: z.array(z.string().uuid()).default([]),
  advertiserIds: z.array(z.string().uuid()).default([]),
  partnerIds: z.array(z.string().uuid()).default([]),
  status: z.enum(['active', 'paused']).default('active'),
});
const updateSchema = createSchema.partial();

export function smartSwitchRoutes(): Router {
  const r = Router();

  r.get('/rules', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<RuleRow>(RULES, { where: {}, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(ruleDto));
  }));

  r.get('/history', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<HistoryRow>(HISTORY, { where: {}, orderBy: 'created_at', orderDir: 'desc', limit: 500 });
    sendOk(res, rows.map(historyDto));
  }));

  r.post('/rules', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    const row = await db.insert<RuleRow>(RULES, {
      name: b.name, action: b.action, action_delay: b.actionDelay ?? null, variable: b.variable ?? null,
      actionable_variables: b.actionableVariables ?? null, offer_ids: JSON.stringify(b.offerIds),
      advertiser_ids: JSON.stringify(b.advertiserIds), partner_ids: JSON.stringify(b.partnerIds), status: b.status,
    });
    await db.insert(HISTORY, { rule_id: row.id, rule_name: row.name, change: 'Rule created', employee: actorId(req) });
    await writeAudit(req, { action: 'smartswitch_rule.create', entityType: 'smartswitch_rule', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, ruleDto(row));
  }));

  r.patch('/rules/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.action !== undefined) patch['action'] = b.action;
    if (b.actionDelay !== undefined) patch['action_delay'] = b.actionDelay;
    if (b.variable !== undefined) patch['variable'] = b.variable;
    if (b.actionableVariables !== undefined) patch['actionable_variables'] = b.actionableVariables;
    if (b.offerIds !== undefined) patch['offer_ids'] = JSON.stringify(b.offerIds);
    if (b.advertiserIds !== undefined) patch['advertiser_ids'] = JSON.stringify(b.advertiserIds);
    if (b.partnerIds !== undefined) patch['partner_ids'] = JSON.stringify(b.partnerIds);
    if (b.status !== undefined) patch['status'] = b.status;
    const [row] = await db.update<RuleRow>(RULES, patch, { id: req.params.id });
    if (!row) throw notFound('Rule not found');
    await db.insert(HISTORY, { rule_id: row.id, rule_name: row.name, change: 'Rule updated', employee: actorId(req) });
    await writeAudit(req, { action: 'smartswitch_rule.update', entityType: 'smartswitch_rule', entityId: req.params.id, after: row });
    sendOk(res, ruleDto(row));
  }));

  r.delete('/rules/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne<RuleRow>(RULES, { id: req.params.id });
    if (!existing) throw notFound('Rule not found');
    await db.delete(RULES, { id: req.params.id });
    await db.insert(HISTORY, { rule_id: null, rule_name: existing.name, change: 'Rule deleted', employee: actorId(req) });
    await writeAudit(req, { action: 'smartswitch_rule.delete', entityType: 'smartswitch_rule', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
