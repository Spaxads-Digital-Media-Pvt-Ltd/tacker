/**
 * Super Admin › staff security and the bell (lib/platform/staff-security.ts).
 *
 * - /me/sessions: your signed-in sessions (address, browser, last seen); sign one out, or every other one.
 * - /me/sign-ins: your sign-in history. /admins/:id/sessions and /admins/:id/sign-ins (team:read; signing a
 *   member out everywhere is team:full). /security/sign-ins: everyone's (team:read), failures first-class.
 * - /notifications: your bell — list (unread first), count, mark one / all read.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateQuery } from '../../lib/http/validate.js';
import { forbidden, notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { listSessions, listSignIns, revokeSessions } from '../../lib/platform/staff-security.js';
import { requirePerm } from './auth.js';
import { ident, meId } from './fields.js';

const signInsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), failed: z.enum(['1', '0']).optional() });

export function securityRoutes(): Router {
  const r = Router();

  r.get('/me/sessions', asyncHandler(async (req, res) => {
    const current = ident(req).sessionId;
    sendOk(res, (await listSessions(meId(req))).map((s) => ({ ...s, current: s.id === current })));
  }));
  r.delete('/me/sessions/:id', asyncHandler(async (req, res) => {
    const n = await revokeSessions(meId(req), { sessionId: req.params.id, by: meId(req) });
    if (!n) throw notFound('Session not found (or already ended)');
    sendOk(res, { revoked: n });
  }));
  // Sign out everywhere else (this session stays).
  r.post('/me/sessions/revoke-others', asyncHandler(async (req, res) => {
    const n = await revokeSessions(meId(req), { ...(ident(req).sessionId ? { exceptId: ident(req).sessionId } : {}), by: meId(req) });
    await writePlatformAudit(req, null, { action: 'platform.sessions.revoke_others', entityType: 'platform_admin', entityId: meId(req), after: { revoked: n } });
    sendOk(res, { revoked: n });
  }));
  r.get('/me/sign-ins', validateQuery(signInsQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof signInsQuery>;
    sendOk(res, await listSignIns({ adminId: meId(req), limit: q.limit, failedOnly: q.failed === '1' }));
  }));

  r.get('/admins/:id/sessions', requirePerm('team', 'read'), asyncHandler(async (req, res) => {
    sendOk(res, await listSessions(req.params.id!));
  }));
  r.post('/admins/:id/sessions/revoke-all', requirePerm('team', 'full'), asyncHandler(async (req, res) => {
    const target = (await query<{ owner: boolean }>(`SELECT r.key = 'owner' AS owner FROM platform_admins a JOIN platform_roles r ON r.id = a.role_id WHERE a.id = $1`, [req.params.id])).rows[0];
    if (!target) throw notFound('Member not found');
    if (target.owner && ident(req).role?.key !== 'owner') throw forbidden('Only an Owner can sign an Owner out.');
    const n = await revokeSessions(req.params.id!, { by: meId(req) });
    await writePlatformAudit(req, null, { action: 'platform.sessions.revoke_all', entityType: 'platform_admin', entityId: req.params.id, after: { revoked: n } });
    sendOk(res, { revoked: n });
  }));
  r.get('/admins/:id/sign-ins', requirePerm('team', 'read'), validateQuery(signInsQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof signInsQuery>;
    sendOk(res, await listSignIns({ adminId: req.params.id!, limit: q.limit, failedOnly: q.failed === '1' }));
  }));
  r.get('/security/sign-ins', requirePerm('team', 'read'), validateQuery(signInsQuery), asyncHandler(async (_req, res) => {
    const q = res.locals.query as z.infer<typeof signInsQuery>;
    sendOk(res, await listSignIns({ limit: q.limit, failedOnly: q.failed === '1' }));
  }));

  // ── The bell ──
  r.get('/notifications', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, kind, title, body, link, read_at, created_at FROM platform_notifications WHERE admin_id = $1
        ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT 50`, [meId(req)]);
    const unread = (await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM platform_notifications WHERE admin_id = $1 AND read_at IS NULL', [meId(req)])).rows[0]!.n;
    sendOk(res, { unread, items: rows });
  }));
  r.post('/notifications/:id/read', asyncHandler(async (req, res) => {
    await query('UPDATE platform_notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND admin_id = $2', [req.params.id, meId(req)]);
    sendOk(res, { ok: true });
  }));
  r.post('/notifications/read-all', asyncHandler(async (req, res) => {
    const n = (await query('UPDATE platform_notifications SET read_at = now() WHERE admin_id = $1 AND read_at IS NULL', [meId(req)])).rowCount ?? 0;
    sendOk(res, { read: n });
  }));
  return r;
}
