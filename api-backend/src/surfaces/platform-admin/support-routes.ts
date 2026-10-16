/**
 * Super Admin › Support — the platform's help desk.
 *
 * - /support/summary: the queue (open, waiting on the customer, on hold, unassigned, mine), first replies past
 *   their deadline (SLA), 30-day volume, first-reply time, resolution time and SLA met %, satisfaction (90 days),
 *   by category and priority, tickets per day (14), each agent's load, the oldest and the overdue.
 * - /support/tickets: the queue — filters (status, priority, assignee, network, category, overdue, search) and
 *   sorts; open one for a network (after a call); one ticket: its thread (internal notes included), the
 *   network (plan, health, account manager) and its other tickets; change status / priority / assignee /
 *   category / tags (status changes land on the thread); reply (or an internal note) — a reply records the
 *   first response, waits on the customer, and takes an unassigned ticket.
 * - /support/macros: saved replies (a reply that used one counts it). /settings/support: first-reply targets
 *   per priority, auto-close days, auto-assignment.
 *
 * Roles: support:read sees, support:full works tickets; settings with settings:read / full. An 'assigned'
 * role only its networks' tickets.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, conflict, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query, withTransaction } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { CATEGORIES, PRIORITIES, STATUSES, createTicket, saveSupportSettings, supportSettings } from '../../lib/platform/support.js';
import { requirePerm, networkScope, assertNetworkInScope } from './auth.js';
import { UUID_RE, meId, ident } from './fields.js';

const STATUS_FILTER = ['active', 'all', ...STATUSES] as const;
const listSchema = paginationSchema.extend({
  status: z.enum(STATUS_FILTER).default('active'),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.string().trim().refine((v) => v === 'me' || v === 'unassigned' || UUID_RE.test(v), 'must be me, unassigned or a member id').optional(),
  networkId: z.string().uuid().optional(),
  category: z.enum(CATEGORIES).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['priority', 'oldest', 'newest', 'updated', 'due']).default('priority'),
}).strict();
const SORT: Record<z.infer<typeof listSchema>['sort'], string> = {
  priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at`,
  oldest: 't.created_at ASC', newest: 't.created_at DESC', updated: 't.updated_at DESC',
  due: 't.first_response_due_at ASC NULLS LAST',
};
const BREACHED = `(t.first_response_at IS NULL AND t.status IN ('open', 'on_hold') AND t.first_response_due_at < now())`;
const TICKET_COLS = `t.id, t.number::text AS number, t.subject, t.category, t.priority, t.status, t.network_id, n.name AS network_name, n.slug AS network_slug,
  t.requester_user_id, t.requester_email, t.requester_name, t.assignee_id, COALESCE(a.name, a.email) AS assignee_name, t.tags,
  t.first_response_due_at, t.first_response_at, t.last_customer_at, t.last_staff_at, t.resolved_at, t.closed_at,
  t.satisfaction, t.satisfaction_comment, t.created_at, t.updated_at, ${BREACHED} AS breached,
  (SELECT left(m.body, 200) FROM support_messages m WHERE m.ticket_id = t.id AND NOT m.internal AND m.author_kind <> 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_message,
  (SELECT m.author_kind FROM support_messages m WHERE m.ticket_id = t.id AND NOT m.internal AND m.author_kind <> 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_author`;
const TICKET_FROM = `support_tickets t JOIN networks n ON n.id = t.network_id LEFT JOIN platform_admins a ON a.id = t.assignee_id`;

const newTicketSchema = z.object({
  networkId: z.string().uuid(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  category: z.enum(CATEGORIES).default('technical'),
  priority: z.enum(PRIORITIES).default('normal'),
  requesterEmail: z.string().trim().email().max(200).optional(),
  requesterName: z.string().trim().max(200).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
}).strict();
const patchSchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  category: z.enum(CATEGORIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
}).strict();
const replySchema = z.object({
  body: z.string().trim().min(1).max(20000),
  internal: z.boolean().default(false),
  status: z.enum(STATUSES).optional(),
  macroId: z.string().uuid().optional(),
}).strict();
const macroSchema = z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(20000) }).strict();
const settingsSchema = z.object({
  firstResponseHours: z.object(Object.fromEntries(PRIORITIES.map((p) => [p, z.number().int().min(1).max(720)])) as Record<(typeof PRIORITIES)[number], z.ZodNumber>).strict(),
  autoCloseDays: z.number().int().min(1).max(90),
  autoAssign: z.boolean(),
}).strict();

const LABEL: Record<string, string> = { open: 'Open', pending: 'Waiting on the customer', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed' };
const memberName = async (id: string) => (await query<{ n: string }>('SELECT COALESCE(name, email) AS n FROM platform_admins WHERE id = $1', [id])).rows[0]?.n ?? null;

async function loadTicket(req: Request, id: string): Promise<{ id: string; network_id: string; status: string; assignee_id: string | null; number: string; subject: string }> {
  if (!UUID_RE.test(id)) throw notFound('Ticket not found');
  const t = (await query<{ id: string; network_id: string; status: string; assignee_id: string | null; number: string; subject: string }>(
    'SELECT id, network_id, status, assignee_id, number::text AS number, subject FROM support_tickets WHERE id = $1', [id])).rows[0];
  if (!t) throw notFound('Ticket not found');
  await assertNetworkInScope(req, t.network_id);
  return t;
}

async function activeMember(id: string): Promise<string> {
  const row = (await query<{ name: string; status: string }>(`SELECT COALESCE(name, email) AS name, status FROM platform_admins WHERE id = $1`, [id])).rows[0];
  if (!row) throw badRequest('That assignee is not a member of the platform team.');
  if (row.status !== 'active') throw badRequest(`${row.name} is disabled — assign the ticket to an active member.`);
  return row.name;
}

/** Status side effects: resolved / closed stamp their time; anything else clears them. */
const statusSets = (status: string): string[] => [
  status === 'resolved' ? 'resolved_at = COALESCE(resolved_at, now())' : status === 'closed' ? 'resolved_at = COALESCE(resolved_at, now())' : 'resolved_at = NULL',
  status === 'closed' ? 'closed_at = now()' : 'closed_at = NULL',
];

export function supportRoutes(): Router {
  const r = Router();

  r.get('/support/summary', requirePerm('support', 'read'), asyncHandler(async (req, res) => {
    const sc2 = networkScope(req, 'n', 2);
    const sc1 = networkScope(req, 'n', 1);
    const from = 'support_tickets t JOIN networks n ON n.id = t.network_id';
    const [counts, byCategory, byPriority, trend, agents, oldest, overdue] = await Promise.all([
      query<Record<string, number | string | null>>(
        `SELECT COUNT(*) FILTER (WHERE t.status = 'open')::int AS open,
                COUNT(*) FILTER (WHERE t.status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE t.status = 'on_hold')::int AS on_hold,
                COUNT(*) FILTER (WHERE t.status IN ('open', 'pending', 'on_hold') AND t.assignee_id IS NULL)::int AS unassigned,
                COUNT(*) FILTER (WHERE t.status IN ('open', 'pending', 'on_hold') AND t.assignee_id = $1)::int AS mine,
                COUNT(*) FILTER (WHERE ${BREACHED})::int AS breached,
                COUNT(*) FILTER (WHERE t.created_at >= now() - interval '30 days')::int AS created_30d,
                COUNT(*) FILTER (WHERE t.resolved_at >= now() - interval '30 days')::int AS resolved_30d,
                ROUND(AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60)
                  FILTER (WHERE t.first_response_at IS NOT NULL AND t.created_by_admin_id IS NULL AND t.created_at >= now() - interval '30 days'))::int AS avg_first_response_min,
                ROUND((AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600) FILTER (WHERE t.resolved_at >= now() - interval '30 days'))::numeric, 1)::text AS avg_resolution_hours,
                COUNT(*) FILTER (WHERE t.created_by_admin_id IS NULL AND t.created_at >= now() - interval '30 days'
                                   AND (t.first_response_at IS NOT NULL OR t.first_response_due_at < now()))::int AS sla_total_30d,
                COUNT(*) FILTER (WHERE t.created_by_admin_id IS NULL AND t.created_at >= now() - interval '30 days'
                                   AND t.first_response_at IS NOT NULL AND t.first_response_at <= t.first_response_due_at)::int AS sla_met_30d,
                ROUND(AVG(t.satisfaction) FILTER (WHERE t.satisfaction IS NOT NULL AND t.resolved_at >= now() - interval '90 days'), 1)::text AS csat,
                COUNT(*) FILTER (WHERE t.satisfaction IS NOT NULL AND t.resolved_at >= now() - interval '90 days')::int AS csat_responses
           FROM ${from} WHERE ${sc2.sql}`, [meId(req), ...sc2.params]),
      query(`SELECT t.category, COUNT(*)::int AS n FROM ${from} WHERE t.status IN ('open', 'pending', 'on_hold') AND ${sc1.sql} GROUP BY t.category ORDER BY n DESC`, sc1.params),
      query(`SELECT t.priority, COUNT(*)::int AS n FROM ${from} WHERE t.status IN ('open', 'pending', 'on_hold') AND ${sc1.sql} GROUP BY t.priority`, sc1.params),
      query(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
                    (SELECT COUNT(*) FROM ${from} WHERE t.created_at >= d AND t.created_at < d + interval '1 day' AND ${sc1.sql})::int AS created,
                    (SELECT COUNT(*) FROM ${from} WHERE t.resolved_at >= d AND t.resolved_at < d + interval '1 day' AND ${sc1.sql})::int AS resolved
               FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`, sc1.params),
      query(`SELECT pa.id, COALESCE(pa.name, pa.email) AS name,
                    COUNT(t.id) FILTER (WHERE t.status IN ('open', 'pending', 'on_hold'))::int AS active,
                    COUNT(t.id) FILTER (WHERE t.status = 'open')::int AS open,
                    COUNT(t.id) FILTER (WHERE t.resolved_at >= now() - interval '7 days')::int AS resolved_7d
               FROM platform_admins pa JOIN platform_roles ro ON ro.id = pa.role_id
               LEFT JOIN (support_tickets t JOIN networks n ON n.id = t.network_id AND ${sc1.sql}) ON t.assignee_id = pa.id
              WHERE pa.status = 'active' AND (ro.permissions->>'support' = 'full' OR t.id IS NOT NULL)
              GROUP BY pa.id ORDER BY active DESC, name LIMIT 20`, sc1.params),
      query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.status = 'open' AND ${sc1.sql} ORDER BY t.created_at LIMIT 5`, sc1.params),
      query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE ${BREACHED} AND ${sc1.sql} ORDER BY t.first_response_due_at LIMIT 8`, sc1.params),
    ]);
    const c = counts.rows[0]!;
    const slaTotal = Number(c['sla_total_30d'] ?? 0);
    sendOk(res, {
      counts: { ...c, sla_met_pct: slaTotal ? Math.round((Number(c['sla_met_30d']) / slaTotal) * 100) : null },
      byCategory: byCategory.rows, byPriority: byPriority.rows, trend: trend.rows, agents: agents.rows, oldest: oldest.rows, overdue: overdue.rows,
    });
  }));

  r.get('/support/tickets', requirePerm('support', 'read'), validateQuery(listSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof listSchema>;
    const assignee = f.assignee === 'me' ? meId(req) : f.assignee ?? null;
    const params: unknown[] = [f.status, f.priority ?? null, assignee, f.networkId ?? null, f.category ?? null, f.overdue ?? null, f.q ? containsPattern(f.q) : null];
    const sc = networkScope(req, 'n', params.length + 1);
    params.push(...sc.params);
    const where = `(CASE $1::text WHEN 'active' THEN t.status IN ('open', 'pending', 'on_hold') WHEN 'all' THEN TRUE ELSE t.status = $1::text END)
      AND ($2::text IS NULL OR t.priority = $2::text)
      AND ($3::text IS NULL OR ($3::text = 'unassigned' AND t.assignee_id IS NULL) OR t.assignee_id::text = $3::text)
      AND ($4::uuid IS NULL OR t.network_id = $4::uuid)
      AND ($5::text IS NULL OR t.category = $5::text)
      AND ($6::text IS NULL OR ${BREACHED} = ($6::text = 'true'))
      AND ($7::text IS NULL OR t.subject ILIKE $7 ESCAPE '\\' OR t.number::text = trim(both '%' from $7::text) OR n.name ILIKE $7 ESCAPE '\\' OR t.requester_email ILIKE $7 ESCAPE '\\')
      AND ${sc.sql}`;
    const [rows, count] = await Promise.all([
      query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE ${where} ORDER BY ${SORT[f.sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, f.limit, f.offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${TICKET_FROM} WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit: f.limit, offset: f.offset, total: count.rows[0]?.n ?? 0 });
  }));

  r.post('/support/tickets', requirePerm('support', 'full'), validateBody(newTicketSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof newTicketSchema>;
    if (!(await query('SELECT 1 FROM networks WHERE id = $1', [b.networkId])).rows[0]) throw notFound('Network not found');
    await assertNetworkInScope(req, b.networkId);
    if (b.assigneeId) await activeMember(b.assigneeId);
    // The requester: a team member of the network with that email, if any.
    const user = b.requesterEmail
      ? (await query<{ id: string; name: string | null }>('SELECT id, name FROM users WHERE network_id = $1 AND lower(email) = lower($2)', [b.networkId, b.requesterEmail])).rows[0]
      : undefined;
    const t = await createTicket({
      networkId: b.networkId, subject: b.subject, body: b.body, category: b.category, priority: b.priority,
      requester: b.requesterEmail ? { userId: user?.id ?? null, email: b.requesterEmail.toLowerCase(), name: b.requesterName ?? user?.name ?? null } : null,
      createdByAdminId: meId(req), createdByAdminName: await memberName(meId(req)),
      assigneeId: b.assigneeId === undefined ? meId(req) : b.assigneeId,
    });
    await writePlatformAudit(req, b.networkId, { action: 'support.ticket_create', entityType: 'support_ticket', entityId: t.id, after: { number: t.number, subject: b.subject } });
    sendOk(res, (await query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.id = $1`, [t.id])).rows[0], undefined, 201);
  }));

  r.get('/support/tickets/:id', requirePerm('support', 'read'), asyncHandler(async (req, res) => {
    const t = await loadTicket(req, req.params.id!);
    const [ticket, messages, network, others] = await Promise.all([
      query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.id = $1`, [t.id]),
      query(`SELECT m.id, m.author_kind, m.author_name, m.body, m.internal, m.created_at, m.author_admin_id, m.author_user_id
               FROM support_messages m WHERE m.ticket_id = $1 ORDER BY m.created_at`, [t.id]),
      query(`SELECT n.id, n.name, n.slug, n.status, p.name AS plan_name, s.status AS subscription_status, na.health_score, na.health_status,
                    COALESCE(am.name, am.email) AS account_manager_name,
                    (SELECT u.email FROM users u WHERE u.network_id = n.id AND u.role = 'admin' ORDER BY u.created_at LIMIT 1) AS owner_email
               FROM networks n LEFT JOIN subscriptions s ON s.network_id = n.id LEFT JOIN subscription_plans p ON p.id = s.plan_id
               LEFT JOIN network_accounts na ON na.network_id = n.id LEFT JOIN platform_admins am ON am.id = n.account_manager_id WHERE n.id = $1`, [t.network_id]),
      query(`SELECT t.id, t.number::text AS number, t.subject, t.status, t.created_at FROM support_tickets t WHERE t.network_id = $1 AND t.id <> $2 ORDER BY t.created_at DESC LIMIT 5`,
        [t.network_id, t.id]),
    ]);
    sendOk(res, { ...ticket.rows[0], messages: messages.rows, network: network.rows[0], otherTickets: others.rows });
  }));

  r.patch('/support/tickets/:id', requirePerm('support', 'full'), validateBody(patchSchema), asyncHandler(async (req, res) => {
    const t = await loadTicket(req, req.params.id!);
    const b = req.body as z.infer<typeof patchSchema>;
    const sets: string[] = []; const params: unknown[] = []; const notes: string[] = [];
    const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    const who = await memberName(meId(req));
    if (b.status !== undefined && b.status !== t.status) {
      set('status', b.status); sets.push(...statusSets(b.status));
      notes.push(`${who ?? 'The support team'} changed the status: ${LABEL[t.status]} → ${LABEL[b.status]}.`);
    }
    if (b.priority !== undefined) set('priority', b.priority);
    if (b.category !== undefined) set('category', b.category);
    if (b.subject !== undefined) set('subject', b.subject);
    if (b.tags !== undefined) set('tags', [...new Set(b.tags.map((x) => x.toLowerCase()))]);
    if (b.assigneeId !== undefined && b.assigneeId !== t.assignee_id) {
      const name = b.assigneeId ? await activeMember(b.assigneeId) : null;
      set('assignee_id', b.assigneeId);
      notes.push(name ? `Assigned to ${name}.` : 'Unassigned.');
    }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(t.id);
    await withTransaction(async (c) => {
      await c.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      for (const n of notes) await c.query(`INSERT INTO support_messages (ticket_id, author_kind, author_name, body, internal) VALUES ($1, 'system', 'System', $2, true)`, [t.id, n]);
    });
    await writePlatformAudit(req, t.network_id, { action: 'support.ticket_update', entityType: 'support_ticket', entityId: t.id, before: t, after: b });
    sendOk(res, (await query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.id = $1`, [t.id])).rows[0]);
  }));

  // A reply (the customer sees it) or an internal note (only the team).
  r.post('/support/tickets/:id/messages', requirePerm('support', 'full'), validateBody(replySchema), asyncHandler(async (req, res) => {
    const t = await loadTicket(req, req.params.id!);
    const b = req.body as z.infer<typeof replySchema>;
    if (t.status === 'closed' && !b.internal) throw conflict('This ticket is closed — reopen it (status) to reply, or the customer opens a new one.');
    const who = await memberName(meId(req));
    // A reply waits on the customer unless a status is chosen; a note keeps the status.
    const next = b.status ?? (b.internal ? t.status : t.status === 'resolved' ? 'resolved' : 'pending');
    await withTransaction(async (c) => {
      await c.query(
        `INSERT INTO support_messages (ticket_id, author_kind, author_admin_id, author_name, body, internal) VALUES ($1, 'staff', $2, $3, $4, $5)`,
        [t.id, meId(req), who, b.body, b.internal]);
      const sets = [`status = $2`, ...statusSets(next)];
      if (!b.internal) sets.push('first_response_at = COALESCE(first_response_at, now())', 'last_staff_at = now()');
      // Answering an unassigned ticket takes it.
      sets.push(`assignee_id = COALESCE(assignee_id, $3)`);
      await c.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $1`, [t.id, next, b.internal ? null : meId(req)]);
      if (b.macroId) await c.query('UPDATE support_macros SET uses = uses + 1 WHERE id = $1', [b.macroId]);
    });
    await writePlatformAudit(req, t.network_id, { action: b.internal ? 'support.note' : 'support.reply', entityType: 'support_ticket', entityId: t.id, after: { status: next } });
    sendOk(res, (await query(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.id = $1`, [t.id])).rows[0], undefined, 201);
  }));

  // ---------- Saved replies ----------
  r.get('/support/macros', requirePerm('support', 'read'), asyncHandler(async (_req, res) => {
    sendOk(res, (await query(`SELECT m.*, COALESCE(pa.name, pa.email) AS created_by_name FROM support_macros m LEFT JOIN platform_admins pa ON pa.id = m.created_by
                                ORDER BY m.uses DESC, m.title`)).rows);
  }));
  r.post('/support/macros', requirePerm('support', 'full'), validateBody(macroSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof macroSchema>;
    sendOk(res, (await query('INSERT INTO support_macros (title, body, created_by) VALUES ($1, $2, $3) RETURNING *', [b.title, b.body, meId(req)])).rows[0], undefined, 201);
  }));
  r.patch('/support/macros/:id', requirePerm('support', 'full'), validateBody(macroSchema.partial()), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const b = req.body as Partial<z.infer<typeof macroSchema>>;
    const row = UUID_RE.test(id) ? (await query('UPDATE support_macros SET title = COALESCE($2, title), body = COALESCE($3, body) WHERE id = $1 RETURNING *',
      [id, b.title ?? null, b.body ?? null])).rows[0] : undefined;
    if (!row) throw notFound('Saved reply not found');
    sendOk(res, row);
  }));
  r.delete('/support/macros/:id', requirePerm('support', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id) || !(await query('DELETE FROM support_macros WHERE id = $1', [id])).rowCount) throw notFound('Saved reply not found');
    sendOk(res, { deleted: true });
  }));

  // ---------- Settings ----------
  r.get('/settings/support', requirePerm('settings', 'read'), asyncHandler(async (_req, res) => { sendOk(res, await supportSettings()); }));
  r.put('/settings/support', requirePerm('settings', 'full'), validateBody(settingsSchema), asyncHandler(async (req, res) => {
    const before = await supportSettings();
    const after = await saveSupportSettings(req.body as z.infer<typeof settingsSchema>, ident(req).platformAdminId);
    await writePlatformAudit(req, null, { action: 'settings.support', entityType: 'platform_settings', entityId: 'support', before, after });
    sendOk(res, after);
  }));

  return r;
}
