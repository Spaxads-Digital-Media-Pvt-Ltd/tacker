/**
 * Super Admin › Tasks — the platform team's to-dos, shared by its panels (sales, customer success, support,
 * billing, other): a title, notes, a priority, a due date and an assignee, optionally about a lead or a
 * network. Completing a lead's task notes it on the lead's timeline.
 *
 * Who sees what: your own tasks (assigned to you, or that you created) always; the rest of a kind with
 * read on its section (sales → Sales, success → Customer success, support → Support, billing → Billing;
 * 'other' → everyone) — an 'assigned' role only for its networks / its leads. Changing one: its assignee
 * or creator, or full on its section.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { AppError, badRequest, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query, withTransaction } from '../../lib/db/pool.js';
import { sectionName, type Section } from '../../lib/platform/permissions.js';
import { logLeadActivity } from '../../lib/platform/sales.js';
import { notifyTaskAssigned } from '../../lib/platform/notify.js';
import { myTaskCounts } from '../../lib/platform/tasks.js';

const myName = async (req: Request) => (await query<{ n: string }>('SELECT COALESCE(name, email) AS n FROM platform_admins WHERE id = $1', [meId(req)])).rows[0]?.n ?? null;
import { can, isAssignedScope, assertNetworkInScope } from './auth.js';
import { UUID_RE, optText, optDateTime, meId, ident } from './fields.js';

const KINDS = ['sales', 'success', 'support', 'billing', 'other'] as const;
type Kind = (typeof KINDS)[number];
const SECTION: Record<Kind, Section | null> = { sales: 'sales', success: 'success', support: 'support', billing: 'billing', other: null };

interface TaskRow {
  id: string; title: string; kind: Kind; status: 'open' | 'done'; assignee_id: string | null; created_by: string | null;
  lead_id: string | null; network_id: string | null;
}

const TASK_COLS = `t.id, t.title, t.notes, t.kind, t.priority, t.status, t.due_at, t.completed_at, t.created_at, t.updated_at,
  t.assignee_id, COALESCE(a.name, a.email) AS assignee_name, t.created_by, COALESCE(c.name, c.email) AS created_by_name,
  t.lead_id, l.company AS lead_company, t.network_id, n.name AS network_name`;
const TASK_FROM = `platform_tasks t LEFT JOIN platform_admins a ON a.id = t.assignee_id LEFT JOIN platform_admins c ON c.id = t.created_by
  LEFT JOIN sales_leads l ON l.id = t.lead_id LEFT JOIN networks n ON n.id = t.network_id`;

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  notes: optText(5000),
  kind: z.enum(KINDS).default('other'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueAt: optDateTime,
  assigneeId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  networkId: z.string().uuid().nullable().optional(),
}).strict();
const updateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  notes: optText(5000),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  dueAt: optDateTime,
  assigneeId: z.string().uuid().nullable().optional(),
  status: z.enum(['open', 'done']).optional(),
}).strict();
const listSchema = paginationSchema.extend({
  assignee: z.string().trim().refine((v) => ['me', 'all', 'unassigned'].includes(v) || UUID_RE.test(v), 'must be me, all, unassigned or a member id').default('me'),
  status: z.enum(['open', 'done', 'all']).default('open'),
  due: z.enum(['overdue', 'today', 'week', 'any']).default('any'),
  kind: z.enum(KINDS).optional(),
  leadId: z.string().uuid().optional(),
  networkId: z.string().uuid().optional(),
}).strict();

/** The kinds this member may read beyond their own tasks. */
const readableKinds = (req: Request): Kind[] => KINDS.filter((k) => { const s = SECTION[k]; return !s || can(req, s, 'read'); });

/** SQL: tasks this member may see ($n = me, $n+1 = readable kinds). */
function visibleSql(req: Request, next: number): { sql: string; params: unknown[] } {
  const me = `$${next}`; const kinds = `$${next + 1}::text[]`;
  const scoped = isAssignedScope(req)
    ? ` AND (t.network_id IS NULL OR EXISTS (SELECT 1 FROM networks sn WHERE sn.id = t.network_id AND (sn.account_manager_id = ${me} OR sn.sales_owner_id = ${me})))
        AND (t.lead_id IS NULL OR EXISTS (SELECT 1 FROM sales_leads sl WHERE sl.id = t.lead_id AND sl.owner_id = ${me}))`
    : '';
  return { sql: `(t.assignee_id = ${me} OR t.created_by = ${me} OR (t.kind = ANY(${kinds})${scoped}))`, params: [meId(req), readableKinds(req)] };
}

/** May this member change the task? Its assignee or creator, or full on its section. */
function assertCanChange(req: Request, t: TaskRow): void {
  const me = meId(req);
  const section = SECTION[t.kind];
  if (t.assignee_id === me || t.created_by === me || !section || can(req, section, 'full')) return;
  throw new AppError('forbidden', `Your role (${ident(req).role?.name ?? 'none'}) can’t change ${sectionName(section)} tasks that aren’t yours.`,
    { reason: 'permission', section, level: 'full' });
}

async function loadTask(req: Request, id: string): Promise<TaskRow> {
  if (!UUID_RE.test(id)) throw notFound('Task not found');
  const v = visibleSql(req, 2);
  const row = (await query<TaskRow>(`SELECT t.* FROM platform_tasks t WHERE t.id = $1 AND ${v.sql}`, [id, ...v.params])).rows[0];
  if (!row) throw notFound('Task not found');
  return row;
}

async function assertAssignee(id: string): Promise<void> {
  const row = (await query<{ name: string; status: string }>(`SELECT COALESCE(name, email) AS name, status FROM platform_admins WHERE id = $1`, [id])).rows[0];
  if (!row) throw badRequest('That assignee is not a member of the platform team.');
  if (row.status !== 'active') throw badRequest(`${row.name} is disabled — assign the task to an active member.`);
}

const taskView = async (id: string) => (await query(`SELECT ${TASK_COLS} FROM ${TASK_FROM} WHERE t.id = $1`, [id])).rows[0]!;

export function taskRoutes(): Router {
  const r = Router();

  r.get('/tasks', validateQuery(listSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof listSchema>;
    const params: unknown[] = [
      f.assignee === 'me' ? meId(req) : f.assignee, f.status, f.due, f.kind ?? null, f.leadId ?? null, f.networkId ?? null,
    ];
    const v = visibleSql(req, params.length + 1);
    params.push(...v.params);
    const where = `${v.sql}
      AND (CASE $1::text WHEN 'all' THEN TRUE WHEN 'unassigned' THEN t.assignee_id IS NULL ELSE t.assignee_id::text = $1::text END)
      AND ($2::text = 'all' OR t.status = $2::text)
      AND (CASE $3::text WHEN 'overdue' THEN t.status = 'open' AND t.due_at < now()
                         WHEN 'today' THEN t.due_at < date_trunc('day', now()) + interval '1 day'
                         WHEN 'week' THEN t.due_at < date_trunc('day', now()) + interval '7 days' ELSE TRUE END)
      AND ($4::text IS NULL OR t.kind = $4::text)
      AND ($5::uuid IS NULL OR t.lead_id = $5::uuid)
      AND ($6::uuid IS NULL OR t.network_id = $6::uuid)`;
    const [rows, count] = await Promise.all([
      query(`SELECT ${TASK_COLS} FROM ${TASK_FROM} WHERE ${where}
              ORDER BY (t.status = 'done'), CASE WHEN t.status = 'done' THEN t.completed_at END DESC NULLS LAST,
                       t.due_at ASC NULLS LAST, (t.priority = 'high') DESC, t.created_at
              LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, f.limit, f.offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM platform_tasks t WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit: f.limit, offset: f.offset, total: count.rows[0]?.n ?? 0 });
  }));

  // My open tasks at a glance (the rail badge, the panels' homes).
  r.get('/tasks/summary', asyncHandler(async (req, res) => { sendOk(res, await myTaskCounts(meId(req))); }));

  r.post('/tasks', validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const section = SECTION[b.kind];
    if (section && !can(req, section, 'full')) {
      throw new AppError('forbidden', `Your role (${ident(req).role?.name ?? 'none'}) can’t add ${sectionName(section)} tasks.`, { reason: 'permission', section, level: 'full' });
    }
    if (b.leadId) {
      const lead = (await query<{ owner_id: string | null }>('SELECT owner_id FROM sales_leads WHERE id = $1', [b.leadId])).rows[0];
      if (!lead || !can(req, 'sales', 'read') || (isAssignedScope(req) && lead.owner_id !== meId(req))) throw notFound('Lead not found');
    }
    if (b.networkId) {
      if (!(await query('SELECT 1 FROM networks WHERE id = $1', [b.networkId])).rows[0]) throw notFound('Network not found');
      await assertNetworkInScope(req, b.networkId);
    }
    const assignee = b.assigneeId === undefined ? meId(req) : b.assigneeId;
    if (assignee) await assertAssignee(assignee);
    const id = (await query<{ id: string }>(
      `INSERT INTO platform_tasks (title, notes, kind, priority, due_at, assignee_id, lead_id, network_id, created_by)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9) RETURNING id`,
      [b.title, b.notes ?? null, b.kind, b.priority, b.dueAt ?? null, assignee, b.leadId ?? null, b.networkId ?? null, meId(req)])).rows[0]!.id;
    if (assignee && assignee !== meId(req)) void notifyTaskAssigned(id, await myName(req));
    sendOk(res, await taskView(id), undefined, 201);
  }));

  r.patch('/tasks/:id', validateBody(updateSchema), asyncHandler(async (req, res) => {
    const t = await loadTask(req, req.params.id!);
    assertCanChange(req, t);
    const b = req.body as z.infer<typeof updateSchema>;
    const sets: string[] = []; const params: unknown[] = [];
    const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    if (b.title !== undefined) set('title', b.title);
    if (b.notes !== undefined) set('notes', b.notes);
    if (b.priority !== undefined) set('priority', b.priority);
    if (b.dueAt !== undefined) set('due_at', b.dueAt, '::timestamptz');
    if (b.assigneeId !== undefined && b.assigneeId !== t.assignee_id) { if (b.assigneeId) await assertAssignee(b.assigneeId); set('assignee_id', b.assigneeId); }
    const done = b.status !== undefined && b.status !== t.status ? b.status === 'done' : null;
    if (done !== null) {
      set('status', b.status);
      if (done) { sets.push('completed_at = now()'); set('completed_by', meId(req)); } else sets.push('completed_at = NULL', 'completed_by = NULL');
    }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(t.id);
    await withTransaction(async (c) => {
      await c.query(`UPDATE platform_tasks SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      if (done && t.lead_id) await logLeadActivity(c, t.lead_id, 'task', t.title, { taskId: t.id }, meId(req));
    });
    if (b.assigneeId && b.assigneeId !== t.assignee_id && b.assigneeId !== meId(req)) void notifyTaskAssigned(t.id, await myName(req));
    sendOk(res, await taskView(t.id));
  }));

  r.delete('/tasks/:id', asyncHandler(async (req, res) => {
    const t = await loadTask(req, req.params.id!);
    assertCanChange(req, t);
    await query('DELETE FROM platform_tasks WHERE id = $1', [t.id]);
    sendOk(res, { deleted: true });
  }));

  return r;
}
