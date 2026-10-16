/**
 * Super Admin › Sales — the platform's own pipeline of prospective tenant networks.
 *
 * - Dashboard (/sales/summary): pipeline by stage, the weighted forecast, won this month, win rate and
 *   sales cycle (90 days), leads by source, the leaderboard, trials to convert, my open tasks, recent activity.
 * - Leads: list (search, stage / owner / source filters, sort) and CSV, the kanban (/sales/pipeline),
 *   create (an open lead with the same email → 409 naming it), edit — stage and owner changes land on the
 *   lead's timeline; lost needs a reason; a converted lead stays won — and delete (not a converted one).
 * - Timeline: notes, calls, emails and meetings, plus what the system records.
 * - Convert to customer: a network with its owner login (a temporary password, shown once — they choose
 *   their own at first sign-in) and optionally a plan (with its trial); the lead is won and linked to it,
 *   and the network remembers who sold it (an 'assigned' role sees the networks it sold).
 *
 * Roles: sales:read sees, sales:full changes. A role scoped 'assigned' sees only the leads it owns.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { AppError, badRequest, conflict, notFound, validationFailed } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query, withTransaction } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { csvCell } from '../../lib/csv.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { createNetwork } from '../../lib/networks/create.js';
import { assignPlan } from '../../lib/billing/subscriptions.js';
import { generateTemporaryPassword } from '../../lib/provisioning.js';
import { STAGES, OPEN_STAGES, SOURCES, LOGGED_ACTIVITIES, probabilitySql, logLeadActivity } from '../../lib/platform/sales.js';
import { requirePerm, can, isAssignedScope, networkScope } from './auth.js';
import { UUID_RE, optText, optEmail, optMoney, optDateTime, meId } from './fields.js';

interface LeadRow {
  id: string; company: string; email: string | null; stage: string; owner_id: string | null; plan_id: string | null;
  lost_reason: string | null; network_id: string | null; network_name: string | null; won_at: Date | null;
}

const LEAD_COLS = `l.id, l.company, l.contact_name, l.email, l.phone, l.website, l.country, l.source, l.stage, l.owner_id, l.plan_id,
  l.expected_mrr::text AS expected_mrr, l.currency, l.monthly_clicks::float8 AS monthly_clicks, l.tags, l.notes, l.message,
  l.next_step, l.next_step_at, l.lost_reason, l.network_id, l.stage_changed_at, l.won_at, l.lost_at, l.created_at, l.updated_at,
  COALESCE(o.name, o.email) AS owner_name, o.email AS owner_email, p.name AS plan_name, n.name AS network_name, n.slug AS network_slug,
  (SELECT COUNT(*) FROM platform_tasks t WHERE t.lead_id = l.id AND t.status = 'open')::int AS open_tasks`;
const LEAD_FROM = `sales_leads l LEFT JOIN platform_admins o ON o.id = l.owner_id
  LEFT JOIN subscription_plans p ON p.id = l.plan_id LEFT JOIN networks n ON n.id = l.network_id`;

const leadFields = {
  contactName: optText(200),
  email: optEmail,
  phone: optText(50),
  website: optText(300),
  country: optText(100),
  ownerId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  expectedMrr: optMoney,
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  monthlyClicks: z.number().int().min(0).max(1e12).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: optText(5000),
  nextStep: optText(300),
  nextStepAt: optDateTime,
};
const createLeadSchema = z.object({
  ...leadFields,
  company: z.string().trim().min(1).max(200),
  source: z.enum(SOURCES).default('manual'),
  stage: z.enum(OPEN_STAGES).default('new'),
}).strict();
const updateLeadSchema = z.object({
  ...leadFields,
  company: z.string().trim().min(1).max(200).optional(),
  source: z.enum(SOURCES).optional(),
  stage: z.enum(STAGES).optional(),
  lostReason: optText(500),
}).strict();
const activitySchema = z.object({ kind: z.enum(LOGGED_ACTIVITIES), body: z.string().trim().min(1).max(5000) }).strict();
const convertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(63).regex(/^[a-z0-9-]+$/, 'use only lowercase letters, digits and hyphens (e.g. "acme-media")'),
  defaultCurrency: z.string().trim().length(3).transform((v) => v.toUpperCase()).default('USD'),
  ownerEmail: z.string().trim().email().max(200).transform((v) => v.toLowerCase()),
  ownerName: optText(200),
  planId: z.string().uuid().nullable().optional(),
  trialDays: z.number().int().min(0).max(365).nullable().optional(),
  provisionSubdomain: z.boolean().default(true),
  accountManagerId: z.string().uuid().nullable().optional(),
}).strict();
const STAGE_FILTERS = [...STAGES, 'open', 'all'] as const;
const listSchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  stage: z.enum(STAGE_FILTERS).default('open'),
  owner: z.string().trim().refine((v) => v === 'me' || v === 'unassigned' || UUID_RE.test(v), 'must be me, unassigned or a member id').optional(),
  source: z.enum(SOURCES).optional(),
  sort: z.enum(['updated', 'created', 'next_step', 'value', 'company']).default('updated'),
}).strict();
const SORT: Record<z.infer<typeof listSchema>['sort'], string> = {
  updated: 'l.updated_at DESC', created: 'l.created_at DESC', next_step: 'l.next_step_at ASC NULLS LAST, l.updated_at DESC',
  value: 'l.expected_mrr DESC NULLS LAST, l.updated_at DESC', company: 'lower(l.company) ASC',
};

/** SQL limiting a sales_leads alias to the member's scope: every lead, or (an 'assigned' role) the ones it owns. */
function leadScope(req: Request, alias: string, next: number): { sql: string; params: unknown[] } {
  return isAssignedScope(req) ? { sql: `${alias}.owner_id = $${next}`, params: [meId(req)] } : { sql: 'TRUE', params: [] };
}

async function loadLead(req: Request, id: string): Promise<LeadRow> {
  if (!UUID_RE.test(id)) throw notFound('Lead not found');
  const sc = leadScope(req, 'l', 2);
  const row = (await query<LeadRow>(
    `SELECT l.*, n.name AS network_name FROM sales_leads l LEFT JOIN networks n ON n.id = l.network_id WHERE l.id = $1 AND ${sc.sql}`,
    [id, ...sc.params])).rows[0];
  if (!row) throw notFound('Lead not found');
  return row;
}

async function leadView(id: string): Promise<Record<string, unknown>> {
  return (await query(`SELECT ${LEAD_COLS} FROM ${LEAD_FROM} WHERE l.id = $1`, [id])).rows[0]!;
}

/** An active team member (an owner / account manager) — else 400 naming the problem. */
async function activeMemberName(id: string, what: string): Promise<string> {
  const row = (await query<{ name: string; status: string }>(
    `SELECT COALESCE(name, email) AS name, status FROM platform_admins WHERE id = $1`, [id])).rows[0];
  if (!row) throw badRequest(`That ${what} is not a member of the platform team.`);
  if (row.status !== 'active') throw badRequest(`${row.name} is disabled — choose an active ${what}.`);
  return row.name;
}

async function assertPlan(id: string): Promise<{ name: string }> {
  const plan = (await query<{ name: string; status: string }>('SELECT name, status FROM subscription_plans WHERE id = $1', [id])).rows[0];
  if (!plan) throw badRequest('That plan does not exist.');
  if (plan.status !== 'active') throw badRequest(`The plan "${plan.name}" is archived — unarchive it, or choose another.`);
  return plan;
}

function listWhere(req: Request, f: z.infer<typeof listSchema>): { where: string; params: unknown[] } {
  const owner = f.owner === 'me' ? meId(req) : f.owner ?? null;
  const params: unknown[] = [f.q ? containsPattern(f.q) : null, f.stage, owner, f.source ?? null];
  const sc = leadScope(req, 'l', params.length + 1);
  params.push(...sc.params);
  return {
    where: `($1::text IS NULL OR l.company ILIKE $1 ESCAPE '\\' OR l.contact_name ILIKE $1 ESCAPE '\\' OR l.email ILIKE $1 ESCAPE '\\' OR l.website ILIKE $1 ESCAPE '\\')
      AND (CASE $2::text WHEN 'open' THEN l.stage NOT IN ('won', 'lost') WHEN 'all' THEN TRUE ELSE l.stage = $2::text END)
      AND ($3::text IS NULL OR ($3::text = 'unassigned' AND l.owner_id IS NULL) OR l.owner_id::text = $3::text)
      AND ($4::text IS NULL OR l.source = $4::text)
      AND ${sc.sql}`,
    params,
  };
}

/** Amounts per currency (never summed across currencies). */
type PerCurrency = { currency: string; amount: string }[];

export function salesRoutes(): Router {
  const r = Router();

  // ---------- Dashboard ----------
  r.get('/sales/summary', requirePerm('sales', 'read'), asyncHandler(async (req, res) => {
    const sc = leadScope(req, 'l', 1);
    const p = sc.params;
    const me = meId(req);
    const [stages, kpis, forecast, wonMonth, sources, leaders, trend, tasks, recent] = await Promise.all([
      query<{ stage: string; currency: string; count: number; mrr: string }>(
        `SELECT l.stage, l.currency, COUNT(*)::int AS count, COALESCE(SUM(l.expected_mrr), 0)::text AS mrr
           FROM sales_leads l WHERE (l.stage NOT IN ('won', 'lost') OR COALESCE(l.won_at, l.lost_at) >= now() - interval '30 days') AND ${sc.sql}
          GROUP BY l.stage, l.currency`, p),
      query<Record<string, number | null>>(
        `SELECT COUNT(*) FILTER (WHERE l.stage NOT IN ('won', 'lost'))::int AS open,
                COUNT(*) FILTER (WHERE l.created_at >= date_trunc('month', now()))::int AS new_this_month,
                COUNT(*) FILTER (WHERE l.stage = 'won' AND l.won_at >= date_trunc('month', now()))::int AS won_this_month,
                COUNT(*) FILTER (WHERE l.stage = 'won' AND l.won_at >= now() - interval '90 days')::int AS won_90d,
                COUNT(*) FILTER (WHERE l.stage = 'lost' AND l.lost_at >= now() - interval '90 days')::int AS lost_90d,
                ROUND(AVG(EXTRACT(EPOCH FROM (l.won_at - l.created_at)) / 86400) FILTER (WHERE l.stage = 'won' AND l.won_at >= now() - interval '90 days'))::int AS avg_cycle_days,
                COUNT(*) FILTER (WHERE l.stage NOT IN ('won', 'lost') AND l.next_step_at < now())::int AS overdue_next_steps,
                COUNT(*) FILTER (WHERE l.stage NOT IN ('won', 'lost') AND l.owner_id IS NULL)::int AS unassigned
           FROM sales_leads l WHERE ${sc.sql}`, p),
      query<{ currency: string; pipeline: string; weighted: string }>(
        `SELECT l.currency, COALESCE(SUM(l.expected_mrr), 0)::text AS pipeline, ROUND(COALESCE(SUM(l.expected_mrr * ${probabilitySql('l')}), 0), 2)::text AS weighted
           FROM sales_leads l WHERE l.stage NOT IN ('won', 'lost') AND ${sc.sql} GROUP BY l.currency ORDER BY l.currency`, p),
      query<{ currency: string; amount: string; deals: number }>(
        `SELECT l.currency, COALESCE(SUM(l.expected_mrr), 0)::text AS amount, COUNT(*)::int AS deals
           FROM sales_leads l WHERE l.stage = 'won' AND l.won_at >= date_trunc('month', now()) AND ${sc.sql} GROUP BY l.currency ORDER BY l.currency`, p),
      query<{ source: string; leads: number; won: number }>(
        `SELECT l.source, COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE l.stage = 'won')::int AS won
           FROM sales_leads l WHERE l.created_at >= now() - interval '180 days' AND ${sc.sql} GROUP BY l.source ORDER BY leads DESC`, p),
      query(
        `WITH w AS (SELECT l.owner_id, l.currency, SUM(l.expected_mrr) AS amount FROM sales_leads l
                     WHERE l.stage = 'won' AND l.won_at >= date_trunc('quarter', now()) AND ${sc.sql} GROUP BY l.owner_id, l.currency)
         SELECT pa.id, COALESCE(pa.name, pa.email) AS name,
                COUNT(*) FILTER (WHERE l.stage NOT IN ('won', 'lost'))::int AS open,
                COUNT(*) FILTER (WHERE l.stage = 'won' AND l.won_at >= date_trunc('month', now()))::int AS won_this_month,
                COUNT(*) FILTER (WHERE l.stage = 'won' AND l.won_at >= date_trunc('quarter', now()))::int AS won_this_quarter,
                COALESCE((SELECT json_agg(json_build_object('currency', w.currency, 'amount', w.amount::text) ORDER BY w.currency) FROM w WHERE w.owner_id = pa.id), '[]'::json) AS won_mrr_quarter
           FROM sales_leads l JOIN platform_admins pa ON pa.id = l.owner_id
          WHERE ${sc.sql} GROUP BY pa.id ORDER BY won_this_quarter DESC, open DESC LIMIT 10`, p),
      query<{ week: string; created: number; won: number }>(
        `SELECT to_char(w, 'YYYY-MM-DD') AS week,
                (SELECT COUNT(*) FROM sales_leads l WHERE l.created_at >= w AND l.created_at < w + interval '7 days' AND ${sc.sql})::int AS created,
                (SELECT COUNT(*) FROM sales_leads l WHERE l.stage = 'won' AND l.won_at >= w AND l.won_at < w + interval '7 days' AND ${sc.sql})::int AS won
           FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') w ORDER BY w`, p),
      query(
        `SELECT t.id, t.title, t.priority, t.due_at, t.lead_id, t.network_id, l.company AS lead_company, n.name AS network_name
           FROM platform_tasks t LEFT JOIN sales_leads l ON l.id = t.lead_id LEFT JOIN networks n ON n.id = t.network_id
          WHERE t.assignee_id = $1 AND t.status = 'open' ORDER BY t.due_at ASC NULLS LAST, t.created_at LIMIT 8`, [me]),
      query(
        `SELECT a.id, a.kind, a.body, a.meta, a.created_at, l.id AS lead_id, l.company, COALESCE(pa.name, pa.email) AS actor_name
           FROM sales_activities a JOIN sales_leads l ON l.id = a.lead_id LEFT JOIN platform_admins pa ON pa.id = a.actor_id
          WHERE ${sc.sql} ORDER BY a.created_at DESC LIMIT 12`, p),
    ]);
    // Trials to convert: networks in a trial — sales sees them only with networks:read (scoped as networks are).
    let trials: unknown[] | null = null;
    if (can(req, 'networks', 'read')) {
      const ns = networkScope(req, 'n', 1);
      trials = (await query(
        `SELECT n.id AS network_id, n.name AS network_name, s.trial_ends_at, p.name AS plan_name, COALESCE(so.name, so.email) AS sales_owner
           FROM subscriptions s JOIN networks n ON n.id = s.network_id JOIN subscription_plans p ON p.id = s.plan_id
           LEFT JOIN platform_admins so ON so.id = n.sales_owner_id
          WHERE s.status = 'trialing' AND n.status = 'active' AND ${ns.sql} ORDER BY s.trial_ends_at LIMIT 10`, ns.params)).rows;
    }
    const byStage = new Map<string, { stage: string; count: number; mrr: PerCurrency }>(STAGES.map((s) => [s, { stage: s, count: 0, mrr: [] }]));
    for (const row of stages.rows) {
      const s = byStage.get(row.stage)!;
      s.count += row.count;
      if (Number(row.mrr) > 0) s.mrr.push({ currency: row.currency, amount: row.mrr });
    }
    const k = kpis.rows[0]!;
    const closed = (k['won_90d'] ?? 0) + (k['lost_90d'] ?? 0);
    sendOk(res, {
      kpis: { ...k, win_rate_90d: closed ? Math.round(((k['won_90d'] ?? 0) / closed) * 100) : null },
      stages: [...byStage.values()],
      forecast: forecast.rows,
      wonThisMonth: wonMonth.rows,
      sources: sources.rows,
      leaderboard: leaders.rows,
      trend: trend.rows,
      myTasks: tasks.rows,
      recent: recent.rows,
      trials,
    });
  }));

  // ---------- Leads ----------
  r.get('/sales/leads', requirePerm('sales', 'read'), validateQuery(listSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof listSchema>;
    const { where, params } = listWhere(req, f);
    const [rows, count] = await Promise.all([
      query(`SELECT ${LEAD_COLS} FROM ${LEAD_FROM} WHERE ${where} ORDER BY ${SORT[f.sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, f.limit, f.offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM sales_leads l WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit: f.limit, offset: f.offset, total: count.rows[0]?.n ?? 0 });
  }));

  r.get('/sales/leads.csv', requirePerm('sales', 'read'), validateQuery(listSchema.omit({ limit: true, offset: true })), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof listSchema>;
    const { where, params } = listWhere(req, f);
    const { rows } = await query(`SELECT ${LEAD_COLS} FROM ${LEAD_FROM} WHERE ${where} ORDER BY ${SORT[f.sort]} LIMIT 10000`, params);
    const cols = ['company', 'contact_name', 'email', 'phone', 'website', 'country', 'source', 'stage', 'owner_name', 'expected_mrr', 'currency',
      'monthly_clicks', 'plan_name', 'next_step', 'next_step_at', 'lost_reason', 'network_slug', 'created_at', 'won_at', 'lost_at'];
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`${cols.join(',')}\n${rows.map((row) => cols.map((c) => csvCell(row[c])).join(',')).join('\n')}${rows.length ? '\n' : ''}`);
    await writePlatformAudit(req, null, { action: 'lead.export', entityType: 'sales_lead', after: { rows: rows.length, filters: f } });
  }));

  // The kanban: every open lead by stage (and the last 30 days' won / lost), a column's count and value.
  r.get('/sales/pipeline', requirePerm('sales', 'read'), validateQuery(z.object({
    owner: listSchema.shape.owner, q: listSchema.shape.q,
  }).strict()), asyncHandler(async (req, res) => {
    const f = res.locals.query as { owner?: string; q?: string };
    const { where, params } = listWhere(req, { ...f, stage: 'all', sort: 'updated', limit: 0, offset: 0 });
    const { rows } = await query<Record<string, unknown> & { stage: string }>(
      `SELECT * FROM (
         SELECT ${LEAD_COLS}, row_number() OVER (PARTITION BY l.stage ORDER BY l.stage_changed_at DESC) AS rn
           FROM ${LEAD_FROM} WHERE ${where} AND (l.stage NOT IN ('won', 'lost') OR COALESCE(l.won_at, l.lost_at) >= now() - interval '30 days')
       ) x WHERE x.rn <= 200`, params);
    const { rows: totals } = await query<{ stage: string; currency: string; count: number; mrr: string }>(
      `SELECT l.stage, l.currency, COUNT(*)::int AS count, COALESCE(SUM(l.expected_mrr), 0)::text AS mrr FROM sales_leads l
        WHERE ${where} AND (l.stage NOT IN ('won', 'lost') OR COALESCE(l.won_at, l.lost_at) >= now() - interval '30 days') GROUP BY l.stage, l.currency`, params);
    sendOk(res, STAGES.map((stage) => ({
      stage,
      count: totals.filter((t) => t.stage === stage).reduce((n, t) => n + t.count, 0),
      mrr: totals.filter((t) => t.stage === stage && Number(t.mrr) > 0).map((t) => ({ currency: t.currency, amount: t.mrr })),
      leads: rows.filter((l) => l.stage === stage).map(({ rn: _rn, ...l }) => l),
    })));
  }));

  r.post('/sales/leads', requirePerm('sales', 'full'), validateBody(createLeadSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createLeadSchema>;
    if (b.email) {
      const dup = (await query<{ id: string; company: string }>(
        `SELECT id, company FROM sales_leads WHERE lower(email) = $1 AND stage NOT IN ('won', 'lost') LIMIT 1`, [b.email])).rows[0];
      if (dup) throw new AppError('conflict', `${b.email} already has an open lead (${dup.company}) — open it instead.`, { reason: 'duplicate', leadId: dup.id });
    }
    const owner = b.ownerId === undefined ? meId(req) : b.ownerId;
    if (owner) await activeMemberName(owner, 'owner');
    if (b.planId) await assertPlan(b.planId);
    const id = await withTransaction(async (client) => {
      const created = (await client.query<{ id: string }>(
        `INSERT INTO sales_leads (company, contact_name, email, phone, website, country, source, stage, owner_id, plan_id, expected_mrr, currency,
                                  monthly_clicks, tags, notes, next_step, next_step_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12, $13, $14, $15, $16, $17::timestamptz, $18) RETURNING id`,
        [b.company, b.contactName ?? null, b.email ?? null, b.phone ?? null, b.website ?? null, b.country ?? null, b.source, b.stage, owner,
          b.planId ?? null, b.expectedMrr ?? null, b.currency ?? 'USD', b.monthlyClicks ?? null, b.tags ?? [], b.notes ?? null,
          b.nextStep ?? null, b.nextStepAt ?? null, meId(req)])).rows[0]!.id;
      await logLeadActivity(client, created, 'created', null, { source: b.source, stage: b.stage }, meId(req));
      return created;
    });
    const lead = await leadView(id);
    await writePlatformAudit(req, null, { action: 'lead.create', entityType: 'sales_lead', entityId: id, after: lead });
    sendOk(res, lead, undefined, 201);
  }));

  r.get('/sales/leads/:id', requirePerm('sales', 'read'), asyncHandler(async (req, res) => {
    const lead = await loadLead(req, req.params.id!);
    const [view, activities, tasks] = await Promise.all([
      leadView(lead.id),
      query(
        `SELECT a.id, a.kind, a.body, a.meta, a.created_at, a.actor_id, COALESCE(pa.name, pa.email) AS actor_name
           FROM sales_activities a LEFT JOIN platform_admins pa ON pa.id = a.actor_id WHERE a.lead_id = $1 ORDER BY a.created_at DESC LIMIT 300`, [lead.id]),
      query(
        `SELECT t.id, t.title, t.notes, t.kind, t.priority, t.status, t.due_at, t.completed_at, t.assignee_id, COALESCE(pa.name, pa.email) AS assignee_name
           FROM platform_tasks t LEFT JOIN platform_admins pa ON pa.id = t.assignee_id
          WHERE t.lead_id = $1 ORDER BY (t.status = 'done'), t.due_at ASC NULLS LAST, t.created_at`, [lead.id]),
    ]);
    sendOk(res, { ...view, activities: activities.rows, tasks: tasks.rows });
  }));

  r.patch('/sales/leads/:id', requirePerm('sales', 'full'), validateBody(updateLeadSchema), asyncHandler(async (req, res) => {
    const lead = await loadLead(req, req.params.id!);
    const b = req.body as z.infer<typeof updateLeadSchema>;
    const sets: string[] = []; const params: unknown[] = [];
    const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    const cols: [keyof typeof b, string, string?][] = [
      ['company', 'company'], ['contactName', 'contact_name'], ['email', 'email'], ['phone', 'phone'], ['website', 'website'], ['country', 'country'],
      ['source', 'source'], ['expectedMrr', 'expected_mrr', '::numeric'], ['currency', 'currency'], ['monthlyClicks', 'monthly_clicks'],
      ['tags', 'tags'], ['notes', 'notes'], ['nextStep', 'next_step'], ['nextStepAt', 'next_step_at', '::timestamptz'],
    ];
    for (const [k, col, cast] of cols) if (b[k] !== undefined) set(col, b[k], cast);
    if (b.planId !== undefined && b.planId !== lead.plan_id) { if (b.planId) await assertPlan(b.planId); set('plan_id', b.planId); }

    let ownerChange: { from: string | null; to: string | null } | null = null;
    if (b.ownerId !== undefined && b.ownerId !== lead.owner_id) {
      const to = b.ownerId ? await activeMemberName(b.ownerId, 'owner') : null;
      const from = lead.owner_id ? (await query<{ n: string }>('SELECT COALESCE(name, email) AS n FROM platform_admins WHERE id = $1', [lead.owner_id])).rows[0]?.n ?? null : null;
      set('owner_id', b.ownerId);
      ownerChange = { from, to };
    }

    const stage = b.stage ?? lead.stage;
    const stageChanged = stage !== lead.stage;
    if (stageChanged) {
      if (lead.network_id) throw conflict(`This lead became the network ${lead.network_name ?? ''} — it stays won.`);
      set('stage', stage);
      sets.push('stage_changed_at = now()');
      sets.push(stage === 'won' ? 'won_at = now()' : 'won_at = NULL');
      sets.push(stage === 'lost' ? 'lost_at = now()' : 'lost_at = NULL');
    }
    const lostReason = stage === 'lost' ? (b.lostReason !== undefined ? b.lostReason : lead.lost_reason) : null;
    if (stage === 'lost' && !lostReason) throw validationFailed('Say why the deal was lost (lost reason).', { lostReason: ['Required when the stage is lost'] });
    if (lostReason !== lead.lost_reason) set('lost_reason', lostReason);
    if (!sets.length) throw badRequest('Nothing to update');

    params.push(lead.id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE sales_leads SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      if (stageChanged) await logLeadActivity(client, lead.id, 'stage', stage === 'lost' ? lostReason : null, { from: lead.stage, to: stage }, meId(req));
      if (ownerChange) await logLeadActivity(client, lead.id, 'owner', null, ownerChange, meId(req));
    });
    const after = await leadView(lead.id);
    await writePlatformAudit(req, null, { action: stageChanged ? 'lead.stage' : 'lead.update', entityType: 'sales_lead', entityId: lead.id, before: lead, after });
    sendOk(res, after);
  }));

  r.delete('/sales/leads/:id', requirePerm('sales', 'full'), asyncHandler(async (req, res) => {
    const lead = await loadLead(req, req.params.id!);
    if (lead.network_id) throw conflict(`This lead became the network ${lead.network_name ?? ''} — it stays as the record of the sale.`);
    await query('DELETE FROM sales_leads WHERE id = $1', [lead.id]);
    await writePlatformAudit(req, null, { action: 'lead.delete', entityType: 'sales_lead', entityId: lead.id, before: lead });
    sendOk(res, { deleted: true });
  }));

  r.post('/sales/leads/:id/activities', requirePerm('sales', 'full'), validateBody(activitySchema), asyncHandler(async (req, res) => {
    const lead = await loadLead(req, req.params.id!);
    const b = req.body as z.infer<typeof activitySchema>;
    await withTransaction(async (client) => {
      await logLeadActivity(client, lead.id, b.kind, b.body, {}, meId(req));
      await client.query('UPDATE sales_leads SET updated_at = now() WHERE id = $1', [lead.id]);
    });
    const row = (await query(
      `SELECT a.id, a.kind, a.body, a.meta, a.created_at, a.actor_id, COALESCE(pa.name, pa.email) AS actor_name
         FROM sales_activities a LEFT JOIN platform_admins pa ON pa.id = a.actor_id WHERE a.lead_id = $1 ORDER BY a.created_at DESC LIMIT 1`, [lead.id])).rows[0];
    sendOk(res, row, undefined, 201);
  }));

  // ---------- Convert to customer ----------
  r.post('/sales/leads/:id/convert', requirePerm('sales', 'full'), validateBody(convertSchema), asyncHandler(async (req, res) => {
    const lead = await loadLead(req, req.params.id!);
    if (lead.network_id) throw conflict(`Already converted — it's the network ${lead.network_name ?? ''}.`);
    const b = req.body as z.infer<typeof convertSchema>;
    const plan = b.planId ? await assertPlan(b.planId) : null;
    if (b.accountManagerId) await activeMemberName(b.accountManagerId, 'account manager');
    const temporaryPassword = generateTemporaryPassword();
    const { network } = await createNetwork({
      name: b.name, slug: b.slug, defaultCurrency: b.defaultCurrency, provisionSubdomain: b.provisionSubdomain,
      owner: { email: b.ownerEmail, password: temporaryPassword, name: b.ownerName ?? undefined },
      salesOwnerId: lead.owner_id ?? meId(req), accountManagerId: b.accountManagerId ?? null,
    });
    await writePlatformAudit(req, network.id, { action: 'network.create', entityType: 'network', entityId: network.id, after: { ...network, fromLead: lead.id } });

    // The lead is won and linked to the network at once — a plan problem below can't leave it unlinked.
    await withTransaction(async (c) => {
      await c.query(
        `UPDATE sales_leads SET stage = 'won', network_id = $2, won_at = COALESCE(won_at, now()), lost_at = NULL, lost_reason = NULL,
                stage_changed_at = CASE WHEN stage <> 'won' THEN now() ELSE stage_changed_at END, plan_id = COALESCE($3, plan_id)
          WHERE id = $1`, [lead.id, network.id, b.planId ?? null]);
      await logLeadActivity(c, lead.id, 'converted', null,
        { networkId: network.id, networkName: network.name, slug: network.slug, plan: plan?.name ?? null, trialDays: b.trialDays ?? null, fromStage: lead.stage }, meId(req));
    });

    let subscription: unknown = null; let invoice: unknown = null; let planError: string | null = null;
    if (b.planId) {
      try {
        const out = await assignPlan(network.id, b.planId, { trialDays: b.trialDays ?? null }, meId(req));
        subscription = out.subscription; invoice = out.invoice;
        await writePlatformAudit(req, network.id, {
          action: 'subscription.assign', entityType: 'subscription', entityId: out.subscription.id, after: { ...out.subscription, invoice: out.invoice?.number ?? null },
        });
      } catch (err) {
        planError = err instanceof Error ? err.message : 'The plan could not be assigned.';
      }
    }
    await writePlatformAudit(req, network.id, { action: 'lead.convert', entityType: 'sales_lead', entityId: lead.id, before: lead, after: { networkId: network.id, plan: plan?.name ?? null } });
    sendOk(res, {
      lead: await leadView(lead.id),
      network: { id: network.id, name: network.name, slug: network.slug },
      owner: { email: b.ownerEmail, temporaryPassword },
      subscription, invoice, planError,
    }, undefined, 201);
  }));

  return r;
}
