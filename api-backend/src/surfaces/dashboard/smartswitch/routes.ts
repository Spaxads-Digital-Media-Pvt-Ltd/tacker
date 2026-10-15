/**
 * SmartSwitch (D8) — rules that watch each partner's traffic on each offer and act on it: notify,
 * block the partner on the offer, redirect their traffic, or set their payout. The automation worker
 * runs them every 5 minutes (lib/automation/smartswitch.ts — conditions in the Automation grammar,
 * per offer × partner over a window, an optional delay, at most 25 actions per rule per run).
 *
 * Here: CRUD with the same checks the worker applies (an active rule must be runnable — conditions,
 * a minimum-volume clause for anything but notify, the action's URL / payout, its scope in this
 * network), a Preview of what a rule would act on right now (nothing changes), and the log — rule
 * edits and every action taken (smartswitch_history, kind change | action). Network-scoped (§3A).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound, validationFailed } from '../../../lib/http/errors.js';
import { rejectMalformedIdParams } from '../../../lib/http/path-params.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { assertAllSameNetwork } from '../../../lib/db/ownership.js';
import { writeAudit } from '../../../lib/audit.js';
import { teamMembersByLogin, memberLabel } from '../../../lib/auth/team-members.js';
import { roundMoney } from '../../../lib/money.js';
import {
  SMARTSWITCH_ACTIONS, smartSwitchProblem, previewSmartSwitchRule, type SmartSwitchParams,
} from '../../../lib/automation/smartswitch.js';
import { CONDITIONS_HELP } from '../../../lib/automation/alert-rules.js';
import { requireRole } from '../auth.js';

const RULES = 'smartswitch_rules';
const HISTORY = 'smartswitch_history';

function actorId(req: Request): string | null {
  return req.identity?.surface === 'dashboard' ? req.identity.userId : null;
}

interface RuleRow {
  id: string; name: string; action: string; action_delay: string | null; variable: string | null;
  actionable_variables: string | null; offer_ids: string[]; advertiser_ids: string[]; partner_ids: string[];
  status: string; conditions: string | null; action_params: SmartSwitchParams | null;
  last_evaluated_at: string | null; last_fired_at: string | null; last_error: string | null;
  created_at: string; updated_at: string;
}
interface HistoryRow {
  id: string; rule_id: string | null; rule_name: string; change: string; employee: string | null; created_at: string;
  kind: 'change' | 'action'; offer_id: string | null; publisher_id: string | null; details: Record<string, unknown> | null;
}

const ruleDto = (r: RuleRow) => ({
  id: r.id, name: r.name, action: r.action, actionDelay: r.action_delay, conditions: r.conditions,
  redirectUrl: r.action_params?.redirectUrl ?? null, payout: r.action_params?.payout ?? null,
  offerIds: r.offer_ids, advertiserIds: r.advertiser_ids, partnerIds: r.partner_ids, status: r.status,
  lastEvaluatedAt: r.last_evaluated_at, lastFiredAt: r.last_fired_at, lastError: r.last_error,
  // Free-text notes from before rules ran (kept, no longer edited).
  variable: r.variable, actionableVariables: r.actionable_variables,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try { return roundMoney(v); } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a decimal amount (e.g. 1.50)' }); return z.NEVER; }
});
const ruleFields = {
  name: z.string().trim().min(1).max(200),
  action: z.enum(SMARTSWITCH_ACTIONS),
  actionDelay: z.string().trim().max(40).nullable(),
  conditions: z.string().trim().max(500).nullable(),
  redirectUrl: z.string().trim().max(2000).nullable(),
  payout: money.nullable(),
  offerIds: z.array(z.string().uuid()).max(500),
  advertiserIds: z.array(z.string().uuid()).max(500),
  partnerIds: z.array(z.string().uuid()).max(2000),
  status: z.enum(['active', 'paused']),
  // Legacy free-text notes — still accepted, no longer used.
  variable: z.string().max(500).nullable(),
  actionableVariables: z.string().max(500).nullable(),
};
const createSchema = z.object({
  ...ruleFields,
  action: ruleFields.action.default('notify'),
  status: ruleFields.status.default('active'),
  offerIds: ruleFields.offerIds.default([]),
  advertiserIds: ruleFields.advertiserIds.default([]),
  partnerIds: ruleFields.partnerIds.default([]),
  actionDelay: ruleFields.actionDelay.optional(),
  conditions: ruleFields.conditions.optional(),
  redirectUrl: ruleFields.redirectUrl.optional(),
  payout: ruleFields.payout.optional(),
  variable: ruleFields.variable.optional(),
  actionableVariables: ruleFields.actionableVariables.optional(),
});
const updateSchema = z.object(ruleFields).partial();
type Body = z.infer<typeof updateSchema>;

/** The rule as it will be stored: checks that it can run (when active) and that its scope is this network's. */
async function finalize(networkId: string, before: RuleRow | null, b: Body): Promise<Record<string, unknown>> {
  const pick = <T>(next: T | undefined, prev: T): T => (next === undefined ? prev : next);
  const action = pick(b.action, before?.action ?? 'notify');
  const params: SmartSwitchParams = {
    redirectUrl: action === 'redirect' ? pick(b.redirectUrl, before?.action_params?.redirectUrl ?? null) : null,
    payout: action === 'payout' ? pick(b.payout, before?.action_params?.payout ?? null) : null,
  };
  const row = {
    name: pick(b.name, before?.name ?? ''),
    action,
    action_delay: pick(b.actionDelay, before?.action_delay ?? null) || null,
    conditions: pick(b.conditions, before?.conditions ?? null) || null,
    action_params: params,
    offer_ids: pick(b.offerIds, before?.offer_ids ?? []),
    advertiser_ids: pick(b.advertiserIds, before?.advertiser_ids ?? []),
    partner_ids: pick(b.partnerIds, before?.partner_ids ?? []),
    status: pick(b.status, before?.status ?? 'active'),
    variable: pick(b.variable, before?.variable ?? null),
    actionable_variables: pick(b.actionableVariables, before?.actionable_variables ?? null),
  };
  // A paused rule may be a draft; an active one must be able to run.
  if (row.status === 'active') {
    const problem = smartSwitchProblem({ conditions: row.conditions, action: row.action, actionDelay: row.action_delay, params });
    if (problem) throw validationFailed(problem, { help: CONDITIONS_HELP });
  }
  await assertAllSameNetwork(networkId, 'offers', row.offer_ids, 'offerIds');
  await assertAllSameNetwork(networkId, 'advertisers', row.advertiser_ids, 'advertiserIds');
  await assertAllSameNetwork(networkId, 'publishers', row.partner_ids, 'partnerIds');
  return {
    ...row,
    action_params: JSON.stringify(params), offer_ids: JSON.stringify(row.offer_ids),
    advertiser_ids: JSON.stringify(row.advertiser_ids), partner_ids: JSON.stringify(row.partner_ids),
    // What it was watching no longer applies to the edited rule.
    state: JSON.stringify({}),
  };
}

export function smartSwitchRoutes(): Router {
  const r = Router();
  rejectMalformedIdParams(r, 'id');

  r.get('/rules', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<RuleRow>(RULES, { where: {}, orderBy: 'created_at', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'smartswitch.rules');
    sendOk(res, rows.map(ruleDto));
  }));

  // The log: edits (who) and actions (what, on which partner / offer), newest first.
  const historyQuery = z.object({ ruleId: z.string().uuid().optional(), kind: z.enum(['change', 'action']).optional() });
  r.get('/history', validateQuery(historyQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof historyQuery>;
    const where: Record<string, unknown> = {};
    if (q.ruleId) where['rule_id'] = q.ruleId;
    if (q.kind) where['kind'] = q.kind;
    const rows = await dbForRequest(req).selectMany<HistoryRow>(HISTORY, { where, orderBy: 'created_at', orderDir: 'desc', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'smartswitch.history');
    const members = await teamMembersByLogin(req.scope!.networkId, rows.map((h) => h.employee));
    sendOk(res, rows.map((h) => ({
      id: h.id, ruleId: h.rule_id, ruleName: h.rule_name, kind: h.kind, change: h.change,
      offerId: h.offer_id, publisherId: h.publisher_id, details: h.details,
      // N2: who, by name — null for the system (actions) or a login with no team member.
      employee: h.employee, employeeName: h.employee ? memberLabel(members.get(h.employee)) : null,
      createdAt: h.created_at,
    })));
  }));

  r.post('/rules', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.insert<RuleRow>(RULES, await finalize(db.scope.networkId, null, req.body as Body));
    await db.insert(HISTORY, { rule_id: row.id, rule_name: row.name, change: 'Rule created', employee: actorId(req), kind: 'change' });
    await writeAudit(req, { action: 'smartswitch_rule.create', entityType: 'smartswitch_rule', entityId: row.id, after: row });
    sendOk(res, ruleDto(row), undefined, 201);
  }));

  r.patch('/rules/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<RuleRow>(RULES, { id: req.params.id });
    if (!before) throw notFound('Rule not found');
    const b = req.body as Body;
    const [row] = await db.update<RuleRow>(RULES, await finalize(db.scope.networkId, before, b), { id: before.id });
    const change = b.status !== undefined && b.status !== before.status && Object.keys(b).length === 1
      ? (b.status === 'active' ? 'Rule resumed' : 'Rule paused') : 'Rule updated';
    await db.insert(HISTORY, { rule_id: before.id, rule_name: row!.name, change, employee: actorId(req), kind: 'change' });
    await writeAudit(req, { action: 'smartswitch_rule.update', entityType: 'smartswitch_rule', entityId: before.id, before, after: row });
    sendOk(res, ruleDto(row!));
  }));

  r.delete('/rules/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne<RuleRow>(RULES, { id: req.params.id });
    if (!existing) throw notFound('Rule not found');
    await db.delete(RULES, { id: req.params.id });
    await db.insert(HISTORY, { rule_id: null, rule_name: existing.name, change: 'Rule deleted', employee: actorId(req), kind: 'change' });
    await writeAudit(req, { action: 'smartswitch_rule.delete', entityType: 'smartswitch_rule', entityId: req.params.id, before: existing });
    sendOk(res, { deleted: true });
  }));

  // Preview: what a rule (saved, or the form's unsaved values) would act on right now — nothing changes.
  const previewSchema = createSchema.partial({ name: true });
  r.post('/preview', requireRole('admin', 'manager'), validateBody(previewSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof previewSchema>;
    const networkId = req.scope!.networkId;
    await assertAllSameNetwork(networkId, 'offers', b.offerIds, 'offerIds');
    await assertAllSameNetwork(networkId, 'advertisers', b.advertiserIds, 'advertiserIds');
    await assertAllSameNetwork(networkId, 'publishers', b.partnerIds, 'partnerIds');
    const result = await previewSmartSwitchRule(networkId, {
      conditions: b.conditions ?? null, action: b.action, actionDelay: b.actionDelay ?? null,
      params: { redirectUrl: b.redirectUrl ?? null, payout: b.payout ?? null },
      offerIds: b.offerIds, advertiserIds: b.advertiserIds, partnerIds: b.partnerIds,
    });
    if ('problem' in result) throw validationFailed(result.problem, { help: CONDITIONS_HELP });
    sendOk(res, result);
  }));

  // How many actions a rule has taken (for the list) — one query, not per row.
  r.get('/rules/action-counts', asyncHandler(async (req, res) => {
    const { rows } = await query<{ rule_id: string; n: number }>(
      `SELECT rule_id::text, COUNT(*)::int AS n FROM smartswitch_history WHERE network_id = $1 AND kind = 'action' AND rule_id IS NOT NULL GROUP BY rule_id`,
      [req.scope!.networkId]);
    sendOk(res, Object.fromEntries(rows.map((x) => [x.rule_id, x.n])));
  }));

  return r;
}
