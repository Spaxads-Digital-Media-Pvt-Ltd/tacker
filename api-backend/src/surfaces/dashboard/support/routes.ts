/**
 * Help & support (the network's staff → the platform's support team). Mounted at /api/support behind
 * requireAdmin: a network's staff see only their network's tickets (every query filters by network_id) and
 * never the support team's internal notes.
 *
 * - GET /summary: open and waiting-on-you counts (the Help menu's badge).
 * - GET /tickets?status=active|resolved|all: their tickets with the latest public message.
 * - POST /tickets { subject, category, priority, body }: a new ticket (first-reply deadline by priority,
 *   assigned to a Support member — lib/platform/support.ts).
 * - GET /tickets/:id: the ticket and its public thread (the agent shown by name).
 * - POST /tickets/:id/messages { body }: reply — the ticket goes back to the support team (open); a closed
 *   one can't be answered (open a new one).
 * - POST /tickets/:id/resolve · /reopen · /rate { satisfaction 1–5, comment? } (rate once resolved).
 *
 * A Super Admin's support session can read but not write here (it would speak as the customer).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { conflict, forbidden, notFound } from '../../../lib/http/errors.js';
import { paginationSchema } from '../../../lib/http/pagination.js';
import { query, withTransaction } from '../../../lib/db/pool.js';
import { CATEGORIES, PRIORITIES, createTicket } from '../../../lib/platform/support.js';
import type { AdminIdentity } from '../../../middleware/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const who = (req: Request) => req.identity as AdminIdentity;

const newSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  category: z.enum(CATEGORIES).default('technical'),
  priority: z.enum(PRIORITIES).default('normal'),
}).strict();
const replySchema = z.object({ body: z.string().trim().min(1).max(20000) }).strict();
const rateSchema = z.object({ satisfaction: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }).strict();
const listSchema = paginationSchema.extend({ status: z.enum(['active', 'resolved', 'all']).default('all') }).strict();

const COLS = `t.id, t.number::text AS number, t.subject, t.category, t.priority, t.status, t.created_at, t.updated_at, t.resolved_at, t.closed_at,
  t.satisfaction, t.satisfaction_comment, t.requester_name, t.requester_email, COALESCE(a.name, split_part(a.email, '@', 1)) AS agent_name,
  (SELECT left(m.body, 200) FROM support_messages m WHERE m.ticket_id = t.id AND NOT m.internal AND m.author_kind <> 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_message,
  (SELECT m.author_kind FROM support_messages m WHERE m.ticket_id = t.id AND NOT m.internal AND m.author_kind <> 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_author`;
const FROM = 'support_tickets t LEFT JOIN platform_admins a ON a.id = t.assignee_id';

function noSupportSession(req: Request): void {
  if (who(req).platformSupport) throw forbidden('This is a Super Admin support session — answer from the Super Admin console (Support), not as the customer.');
}

async function loadOwn(req: Request, id: string): Promise<{ id: string; status: string }> {
  if (!UUID_RE.test(id)) throw notFound('Ticket not found');
  const t = (await query<{ id: string; status: string }>('SELECT id, status FROM support_tickets WHERE id = $1 AND network_id = $2', [id, who(req).networkId])).rows[0];
  if (!t) throw notFound('Ticket not found');
  return t;
}

const view = async (req: Request, id: string) =>
  (await query(`SELECT ${COLS} FROM ${FROM} WHERE t.id = $1 AND t.network_id = $2`, [id, who(req).networkId])).rows[0];

export function supportTenantRoutes(): Router {
  const r = Router();

  r.get('/summary', asyncHandler(async (req, res) => {
    const { rows } = await query<{ open: number; waiting_on_you: number }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('open', 'pending', 'on_hold'))::int AS open,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS waiting_on_you
         FROM support_tickets WHERE network_id = $1`, [who(req).networkId]);
    sendOk(res, rows[0]);
  }));

  r.get('/tickets', validateQuery(listSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof listSchema>;
    const where = `t.network_id = $1 AND (CASE $2::text WHEN 'active' THEN t.status IN ('open', 'pending', 'on_hold')
                                                         WHEN 'resolved' THEN t.status IN ('resolved', 'closed') ELSE TRUE END)`;
    const params = [who(req).networkId, f.status];
    const [rows, count] = await Promise.all([
      query(`SELECT ${COLS} FROM ${FROM} WHERE ${where} ORDER BY (t.status = 'pending') DESC, t.updated_at DESC LIMIT $3 OFFSET $4`, [...params, f.limit, f.offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM support_tickets t WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit: f.limit, offset: f.offset, total: count.rows[0]?.n ?? 0 });
  }));

  r.post('/tickets', validateBody(newSchema), asyncHandler(async (req, res) => {
    noSupportSession(req);
    const b = req.body as z.infer<typeof newSchema>;
    const me = (await query<{ id: string; email: string; name: string | null }>(
      'SELECT id, email, name FROM users WHERE network_id = $1 AND auth_user_id = $2 LIMIT 1', [who(req).networkId, who(req).userId])).rows[0];
    const t = await createTicket({
      networkId: who(req).networkId, subject: b.subject, body: b.body, category: b.category, priority: b.priority,
      requester: { userId: me?.id ?? null, email: me?.email ?? null, name: me?.name ?? me?.email ?? null },
    });
    sendOk(res, await view(req, t.id), undefined, 201);
  }));

  r.get('/tickets/:id', asyncHandler(async (req, res) => {
    const t = await loadOwn(req, req.params.id!);
    const { rows } = await query(
      `SELECT m.id, m.author_kind, m.body, m.created_at,
              CASE WHEN m.author_kind = 'staff' THEN COALESCE(pa.name, split_part(pa.email, '@', 1), m.author_name) ELSE m.author_name END AS author_name
         FROM support_messages m LEFT JOIN platform_admins pa ON pa.id = m.author_admin_id
        WHERE m.ticket_id = $1 AND NOT m.internal ORDER BY m.created_at`, [t.id]);
    sendOk(res, { ...(await view(req, t.id)), messages: rows });
  }));

  r.post('/tickets/:id/messages', validateBody(replySchema), asyncHandler(async (req, res) => {
    noSupportSession(req);
    const t = await loadOwn(req, req.params.id!);
    if (t.status === 'closed') throw conflict('This ticket is closed — open a new one and mention its number.');
    const me = (await query<{ id: string; email: string; name: string | null }>(
      'SELECT id, email, name FROM users WHERE network_id = $1 AND auth_user_id = $2 LIMIT 1', [who(req).networkId, who(req).userId])).rows[0];
    await withTransaction(async (c) => {
      await c.query(`INSERT INTO support_messages (ticket_id, author_kind, author_user_id, author_name, body) VALUES ($1, 'customer', $2, $3, $4)`,
        [t.id, me?.id ?? null, me?.name ?? me?.email ?? null, (req.body as { body: string }).body]);
      await c.query(`UPDATE support_tickets SET status = 'open', last_customer_at = now(), resolved_at = NULL WHERE id = $1`, [t.id]);
    });
    sendOk(res, await view(req, t.id), undefined, 201);
  }));

  const setStatus = (to: 'resolved' | 'open', from: string[], message: (s: string) => string, note: string) =>
    asyncHandler(async (req, res) => {
      noSupportSession(req);
      const t = await loadOwn(req, req.params.id!);
      if (!from.includes(t.status)) throw conflict(message(t.status));
      await withTransaction(async (c) => {
        await c.query(`UPDATE support_tickets SET status = $2, resolved_at = ${to === 'resolved' ? 'now()' : 'NULL'}, closed_at = NULL WHERE id = $1`, [t.id, to]);
        await c.query(`INSERT INTO support_messages (ticket_id, author_kind, author_name, body) VALUES ($1, 'system', 'System', $2)`, [t.id, note]);
      });
      sendOk(res, await view(req, t.id));
    });
  r.post('/tickets/:id/resolve', setStatus('resolved', ['open', 'pending', 'on_hold'], (s) => `This ticket is already ${s}.`, 'The customer marked it resolved.'));
  r.post('/tickets/:id/reopen', setStatus('open', ['resolved'], (s) => (s === 'closed' ? 'This ticket is closed — open a new one and mention its number.' : `This ticket is ${s}, not resolved.`), 'The customer reopened it.'));

  r.post('/tickets/:id/rate', validateBody(rateSchema), asyncHandler(async (req, res) => {
    noSupportSession(req);
    const t = await loadOwn(req, req.params.id!);
    if (!['resolved', 'closed'].includes(t.status)) throw conflict('You can rate a ticket once it is resolved.');
    const b = req.body as z.infer<typeof rateSchema>;
    await query('UPDATE support_tickets SET satisfaction = $2, satisfaction_comment = $3 WHERE id = $1', [t.id, b.satisfaction, b.comment ?? null]);
    sendOk(res, await view(req, t.id));
  }));

  return r;
}
