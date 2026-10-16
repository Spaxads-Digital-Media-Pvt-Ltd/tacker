/**
 * Super Admin › Customer success — the account managers' panel.
 *
 * - /success/summary: accounts by health, average score, mine / unassigned, at-risk and biggest drops (7 days),
 *   onboarding that stalled, trials ending, my check-ins, the latest notes.
 * - /success/accounts: every network with its health (score, status, parts, signals, 7 days ago), onboarding,
 *   account manager and tags — filter and sort (worst first by default).
 * - /success/recalculate: recompute health now — all in scope, or { networkId } (the workers do it every 6 hours).
 * - A network's account (/networks/:id/account): health with its history (90 days) and milestones, the
 *   account manager and seller, tags, notes. Change the account manager / seller / tags; notes (pin one).
 *
 * Roles: success:read sees, success:full changes. An 'assigned' role (Account Manager) only its networks.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { computeHealth, MILESTONES } from '../../lib/platform/health.js';
import { requirePerm, networkScope, assertNetworkInScope, isAssignedScope } from './auth.js';
import { UUID_RE, meId } from './fields.js';

const accountsSchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['healthy', 'attention', 'at_risk', 'unscored']).optional(),
  manager: z.string().trim().refine((v) => v === 'me' || v === 'unassigned' || UUID_RE.test(v), 'must be me, unassigned or a member id').optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(['score', 'score_desc', 'name', 'onboarding', 'last_login', 'drop']).default('score'),
}).strict();
const SORT: Record<z.infer<typeof accountsSchema>['sort'], string> = {
  score: 'na.health_score ASC NULLS LAST, n.name', score_desc: 'na.health_score DESC NULLS LAST, n.name', name: 'lower(n.name)',
  onboarding: 'na.onboarding_pct ASC NULLS LAST, n.created_at DESC',
  last_login: `(na.health_signals->>'lastLoginAt') ASC NULLS FIRST`,
  drop: '(h7.score - na.health_score) DESC NULLS LAST, na.health_score',
};
const accountSchema = z.object({
  accountManagerId: z.string().uuid().nullable().optional(),
  salesOwnerId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
}).strict();
const noteSchema = z.object({ body: z.string().trim().min(1).max(10000), pinned: z.boolean().optional() }).strict();
const notePatchSchema = z.object({ body: z.string().trim().min(1).max(10000).optional(), pinned: z.boolean().optional() }).strict();

const ACCOUNT_COLS = `n.id, n.name, n.slug, n.status, n.suspended_reason, n.created_at, n.account_manager_id, n.sales_owner_id,
  COALESCE(am.name, am.email) AS account_manager_name, COALESCE(so.name, so.email) AS sales_owner_name,
  p.name AS plan_name, s.status AS subscription_status, s.trial_ends_at,
  COALESCE(na.tags, '{}') AS tags, na.health_score, na.health_status, COALESCE(na.health_components, '{}') AS health_components,
  COALESCE(na.health_signals, '{}') AS health_signals, na.onboarding_pct, na.health_computed_at, h7.score AS score_7d_ago`;
const ACCOUNT_FROM = `networks n
  LEFT JOIN network_accounts na ON na.network_id = n.id
  LEFT JOIN platform_admins am ON am.id = n.account_manager_id
  LEFT JOIN platform_admins so ON so.id = n.sales_owner_id
  LEFT JOIN subscriptions s ON s.network_id = n.id
  LEFT JOIN subscription_plans p ON p.id = s.plan_id
  LEFT JOIN LATERAL (SELECT score FROM network_health_history h WHERE h.network_id = n.id AND h.day <= CURRENT_DATE - 7 ORDER BY h.day DESC LIMIT 1) h7 ON true`;

async function activeMember(id: string, what: string): Promise<void> {
  const row = (await query<{ name: string; status: string }>(`SELECT COALESCE(name, email) AS name, status FROM platform_admins WHERE id = $1`, [id])).rows[0];
  if (!row) throw badRequest(`That ${what} is not a member of the platform team.`);
  if (row.status !== 'active') throw badRequest(`${row.name} is disabled — choose an active ${what}.`);
}

async function loadNote(req: Request, id: string): Promise<{ id: string; network_id: string; author_id: string | null }> {
  if (!UUID_RE.test(id)) throw notFound('Note not found');
  const note = (await query<{ id: string; network_id: string; author_id: string | null }>('SELECT id, network_id, author_id FROM network_notes WHERE id = $1', [id])).rows[0];
  if (!note) throw notFound('Note not found');
  await assertNetworkInScope(req, note.network_id);
  return note;
}

export function successRoutes(): Router {
  const r = Router();

  r.get('/success/summary', requirePerm('success', 'read'), asyncHandler(async (req, res) => {
    // The counts take me as $1 (then the scope); the lists only the scope.
    const sc2 = networkScope(req, 'n', 2);
    const sc1 = networkScope(req, 'n', 1);
    const p2 = [meId(req), ...sc2.params];
    const p = sc1.params;
    const live2 = `n.status <> 'deleted' AND ${sc2.sql}`;
    const live = `n.status <> 'deleted' AND ${sc1.sql}`;
    const [counts, atRisk, drops, stalled, trials, notes, tasks] = await Promise.all([
      query<Record<string, number | string | null>>(
        `SELECT COUNT(*)::int AS accounts,
                COUNT(*) FILTER (WHERE na.health_status = 'healthy')::int AS healthy,
                COUNT(*) FILTER (WHERE na.health_status = 'attention')::int AS attention,
                COUNT(*) FILTER (WHERE na.health_status = 'at_risk')::int AS at_risk,
                COUNT(*) FILTER (WHERE na.health_status IS NULL)::int AS unscored,
                ROUND(AVG(na.health_score))::int AS avg_score,
                COUNT(*) FILTER (WHERE n.account_manager_id = $1)::int AS mine,
                COUNT(*) FILTER (WHERE n.account_manager_id IS NULL)::int AS unassigned,
                COUNT(*) FILTER (WHERE na.onboarding_pct < 100)::int AS onboarding_open,
                MAX(na.health_computed_at) AS computed_at
           FROM networks n LEFT JOIN network_accounts na ON na.network_id = n.id WHERE ${live2}`, p2),
      query(`SELECT n.id, n.name, na.health_score, COALESCE(am.name, am.email) AS account_manager_name, na.health_components
               FROM networks n JOIN network_accounts na ON na.network_id = n.id LEFT JOIN platform_admins am ON am.id = n.account_manager_id
              WHERE ${live} AND na.health_status = 'at_risk' ORDER BY na.health_score, n.name LIMIT 8`, p),
      query(`SELECT n.id, n.name, na.health_score, h7.score AS score_7d_ago
               FROM networks n JOIN network_accounts na ON na.network_id = n.id
               JOIN LATERAL (SELECT score FROM network_health_history h WHERE h.network_id = n.id AND h.day <= CURRENT_DATE - 7 ORDER BY h.day DESC LIMIT 1) h7 ON true
              WHERE ${live} AND h7.score - na.health_score >= 10 ORDER BY (h7.score - na.health_score) DESC LIMIT 8`, p),
      query(`SELECT n.id, n.name, n.created_at, na.onboarding_pct, na.onboarding
               FROM networks n JOIN network_accounts na ON na.network_id = n.id
              WHERE ${live} AND na.onboarding_pct < 60 AND n.created_at < now() - interval '7 days' ORDER BY na.onboarding_pct, n.created_at LIMIT 8`, p),
      query(`SELECT n.id, n.name, s.trial_ends_at, na.health_score, na.health_status, pl.name AS plan_name
               FROM subscriptions s JOIN networks n ON n.id = s.network_id JOIN subscription_plans pl ON pl.id = s.plan_id
               LEFT JOIN network_accounts na ON na.network_id = n.id
              WHERE ${live} AND s.status = 'trialing' AND s.trial_ends_at < now() + interval '14 days' ORDER BY s.trial_ends_at LIMIT 8`, p),
      query(`SELECT nn.id, nn.body, nn.pinned, nn.created_at, n.id AS network_id, n.name AS network_name, COALESCE(pa.name, pa.email) AS author_name
               FROM network_notes nn JOIN networks n ON n.id = nn.network_id LEFT JOIN platform_admins pa ON pa.id = nn.author_id
              WHERE ${live} ORDER BY nn.created_at DESC LIMIT 6`, p),
      query(`SELECT t.id, t.title, t.priority, t.due_at, t.network_id, n.name AS network_name
               FROM platform_tasks t LEFT JOIN networks n ON n.id = t.network_id
              WHERE t.assignee_id = $1 AND t.status = 'open' AND t.kind = 'success' ORDER BY t.due_at ASC NULLS LAST LIMIT 8`, [meId(req)]),
    ]);
    sendOk(res, { counts: counts.rows[0], atRisk: atRisk.rows, drops: drops.rows, stalled: stalled.rows, trials: trials.rows, notes: notes.rows, myTasks: tasks.rows });
  }));

  r.get('/success/accounts', requirePerm('success', 'read'), validateQuery(accountsSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof accountsSchema>;
    const manager = f.manager === 'me' ? meId(req) : f.manager ?? null;
    const params: unknown[] = [f.q ? containsPattern(f.q) : null, f.status ?? null, manager, f.tag ?? null];
    const sc = networkScope(req, 'n', params.length + 1);
    params.push(...sc.params);
    const where = `n.status <> 'deleted'
      AND ($1::text IS NULL OR n.name ILIKE $1 ESCAPE '\\' OR n.slug ILIKE $1 ESCAPE '\\')
      AND (CASE $2::text WHEN 'unscored' THEN na.health_status IS NULL ELSE ($2::text IS NULL OR na.health_status = $2::text) END)
      AND ($3::text IS NULL OR ($3::text = 'unassigned' AND n.account_manager_id IS NULL) OR n.account_manager_id::text = $3::text)
      AND ($4::text IS NULL OR $4::text = ANY(na.tags))
      AND ${sc.sql}`;
    const [rows, count] = await Promise.all([
      query(`SELECT ${ACCOUNT_COLS} FROM ${ACCOUNT_FROM} WHERE ${where} ORDER BY ${SORT[f.sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, f.limit, f.offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM networks n LEFT JOIN network_accounts na ON na.network_id = n.id WHERE ${where}`, params),
    ]);
    sendOk(res, rows.rows, { limit: f.limit, offset: f.offset, total: count.rows[0]?.n ?? 0 });
  }));

  r.get('/success/tags', requirePerm('success', 'read'), asyncHandler(async (_req, res) => {
    const { rows } = await query<{ tag: string; n: number }>(
      `SELECT t AS tag, COUNT(*)::int AS n FROM network_accounts, unnest(tags) t GROUP BY t ORDER BY n DESC, t LIMIT 100`);
    sendOk(res, rows);
  }));

  // Every network in your scope — or one ({ networkId }).
  r.post('/success/recalculate', requirePerm('success', 'full'), validateBody(z.object({ networkId: z.string().uuid().optional() }).strict()), asyncHandler(async (req, res) => {
    const { networkId } = req.body as { networkId?: string };
    let ids: string[] | null = null;
    if (networkId) {
      if (!(await query('SELECT 1 FROM networks WHERE id = $1', [networkId])).rows[0]) throw notFound('Network not found');
      await assertNetworkInScope(req, networkId);
      ids = [networkId];
    } else if (isAssignedScope(req)) {
      const sc = networkScope(req, 'n', 1);
      ids = (await query<{ id: string }>(`SELECT n.id FROM networks n WHERE ${sc.sql}`, sc.params)).rows.map((x) => x.id);
    }
    const out = await computeHealth(ids);
    await writePlatformAudit(req, null, { action: 'success.recalculate', entityType: 'network_accounts', after: out });
    sendOk(res, out);
  }));

  // ---------- One network's account ----------
  r.get('/networks/:id/account', requirePerm('success', 'read'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const account = (await query(
      `SELECT ${ACCOUNT_COLS}, COALESCE(na.onboarding, '[]') AS onboarding FROM ${ACCOUNT_FROM} WHERE n.id = $1`, [id])).rows[0];
    if (!account) throw notFound('Network not found');
    const [history, notes] = await Promise.all([
      query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, score, status FROM network_health_history WHERE network_id = $1 AND day > CURRENT_DATE - 90 ORDER BY day`, [id]),
      query(`SELECT nn.id, nn.body, nn.pinned, nn.created_at, nn.updated_at, nn.author_id, COALESCE(pa.name, pa.email) AS author_name
               FROM network_notes nn LEFT JOIN platform_admins pa ON pa.id = nn.author_id WHERE nn.network_id = $1 ORDER BY nn.pinned DESC, nn.created_at DESC LIMIT 200`, [id]),
    ]);
    sendOk(res, { ...account, milestones: MILESTONES, history: history.rows, notes: notes.rows });
  }));

  r.patch('/networks/:id/account', requirePerm('success', 'full'), validateBody(accountSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const before = (await query<{ account_manager_id: string | null; sales_owner_id: string | null }>(
      'SELECT account_manager_id, sales_owner_id FROM networks WHERE id = $1', [id])).rows[0];
    if (!before) throw notFound('Network not found');
    const b = req.body as z.infer<typeof accountSchema>;
    if (b.accountManagerId) await activeMember(b.accountManagerId, 'account manager');
    if (b.salesOwnerId) await activeMember(b.salesOwnerId, 'seller');
    const sets: string[] = []; const params: unknown[] = [];
    if (b.accountManagerId !== undefined) { params.push(b.accountManagerId); sets.push(`account_manager_id = $${params.length}`); }
    if (b.salesOwnerId !== undefined) { params.push(b.salesOwnerId); sets.push(`sales_owner_id = $${params.length}`); }
    if (!sets.length && b.tags === undefined) throw badRequest('Nothing to update');
    if (sets.length) { params.push(id); await query(`UPDATE networks SET ${sets.join(', ')} WHERE id = $${params.length}`, params); }
    if (b.tags !== undefined) {
      const tags = [...new Set(b.tags.map((t) => t.toLowerCase()))];
      await query(`INSERT INTO network_accounts (network_id, tags) VALUES ($1, $2) ON CONFLICT (network_id) DO UPDATE SET tags = EXCLUDED.tags`, [id, tags]);
    }
    const after = (await query(`SELECT ${ACCOUNT_COLS} FROM ${ACCOUNT_FROM} WHERE n.id = $1`, [id])).rows[0];
    await writePlatformAudit(req, id, { action: 'network.account', entityType: 'network', entityId: id, before, after: { accountManagerId: after!['account_manager_id'], salesOwnerId: after!['sales_owner_id'], tags: after!['tags'] } });
    sendOk(res, after);
  }));

  r.post('/networks/:id/notes', requirePerm('success', 'full'), validateBody(noteSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id) || !(await query('SELECT 1 FROM networks WHERE id = $1', [id])).rows[0]) throw notFound('Network not found');
    await assertNetworkInScope(req, id);
    const b = req.body as z.infer<typeof noteSchema>;
    const row = (await query(
      `INSERT INTO network_notes (network_id, body, pinned, author_id) VALUES ($1, $2, $3, $4) RETURNING id, body, pinned, created_at, updated_at, author_id`,
      [id, b.body, b.pinned ?? false, meId(req)])).rows[0]!;
    await writePlatformAudit(req, id, { action: 'network.note', entityType: 'network_note', entityId: row['id'] as string });
    sendOk(res, row, undefined, 201);
  }));

  r.patch('/notes/:id', requirePerm('success', 'full'), validateBody(notePatchSchema), asyncHandler(async (req, res) => {
    const note = await loadNote(req, req.params.id!);
    const b = req.body as z.infer<typeof notePatchSchema>;
    if (b.body === undefined && b.pinned === undefined) throw badRequest('Nothing to update');
    const row = (await query(
      `UPDATE network_notes SET body = COALESCE($2, body), pinned = COALESCE($3, pinned) WHERE id = $1 RETURNING id, body, pinned, created_at, updated_at, author_id`,
      [note.id, b.body ?? null, b.pinned ?? null])).rows[0];
    sendOk(res, row);
  }));

  r.delete('/notes/:id', requirePerm('success', 'full'), asyncHandler(async (req, res) => {
    const note = await loadNote(req, req.params.id!);
    await query('DELETE FROM network_notes WHERE id = $1', [note.id]);
    await writePlatformAudit(req, note.network_id, { action: 'network.note_delete', entityType: 'network_note', entityId: note.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
