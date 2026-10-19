/**
 * Super Admin › Trust & safety (trust:read sees, trust:full changes).
 *
 * - /trust/summary: the last 7 days' clicks, invalid and rejected clicks and average fraud score per network
 *   (the 15-minute rollups), the hourly scan's 24-hour rejection reasons and the addresses flagged in more than
 *   one network (lib/platform/trust.ts), the blocklist's hits, privacy requests open / due / overdue.
 * - /trust/blocklist: what /click rejects for every network (lib/platform/blocklist.ts) — IPs, CIDRs, ranges,
 *   user-agent phrases, referrer domains; optional expiry. /trust/scan runs the scan now.
 * - /trust/privacy: GDPR / CCPA requests — log one (due 30 / 45 days from receipt), erase (personal fields
 *   only, never amounts) or export what is held, then complete or reject; the subject is masked once done.
 *
 * An 'assigned' role sees only its networks (and the addresses that reached them).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, conflict, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { csvCell } from '../../lib/csv.js';
import {
  blocklistEntryError, blocklistHits, forgetBlocklistHits, getPlatformBlocklist, invalidatePlatformBlocklist, normalizeReferrerDomain,
  type BlockKind,
} from '../../lib/platform/blocklist.js';
import {
  DUE_DAYS, REGULATIONS, SUBJECT_TYPES, eraseSubject, exportSubject, hashSubject, lastTrustScan, maskSubject, normalizeSubject,
  scanTrust, subjectError, type PrivacyRequestRow, type Regulation, type SubjectType,
} from '../../lib/platform/trust.js';
import { requirePerm, can, networkScope, scopedNetworkIds, assertNetworkInScope } from './auth.js';
import { UUID_RE, meId, optText, optEmail, optDateTime } from './fields.js';

const KINDS = ['ip', 'user_agent', 'referrer'] as const;
const blockSchema = z.object({
  kind: z.enum(KINDS),
  value: z.string().trim().min(1).max(300),
  valueTo: z.string().trim().max(100).optional().nullable(),
  reason: optText(500),
  expiresAt: optDateTime,
}).strict();
const blockListSchema = z.object({ kind: z.enum(KINDS).optional(), q: z.string().trim().max(100).optional() }).strict();

const privacySchema = z.object({
  networkId: z.string().uuid().nullable().optional(),
  kind: z.enum(['erasure', 'access']),
  regulation: z.enum(REGULATIONS).default('gdpr'),
  subjectType: z.enum(SUBJECT_TYPES),
  subject: z.string().trim().min(1).max(300),
  requesterEmail: optEmail,
  receivedAt: optDateTime,
  notes: optText(5000),
  assigneeId: z.string().uuid().nullable().optional(),
}).strict();
const privacyPatchSchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'rejected']).optional(),
  notes: optText(5000),
  assigneeId: z.string().uuid().nullable().optional(),
}).strict();
const privacyListSchema = paginationSchema.extend({
  status: z.enum(['open', 'all', 'new', 'in_progress', 'completed', 'rejected']).default('open'),
  q: z.string().trim().max(100).optional(),
}).strict();

interface PrivacyRow extends PrivacyRequestRow {
  number: string; regulation: Regulation; status: string; requester_email: string | null; due_at: string; received_at: string;
  notes: string | null; result: unknown; assignee_id: string | null; completed_at: string | null; created_at: string;
}

const PRIVACY_COLS = `p.id, p.number::text AS number, p.network_id, n.name AS network_name, p.kind, p.regulation, p.subject_type, p.subject,
  p.requester_email, p.status, p.received_at, p.due_at, p.notes, p.result, p.assignee_id, COALESCE(a.name, a.email) AS assignee_name,
  p.created_at, p.updated_at, p.completed_at, (p.status IN ('new', 'in_progress') AND p.due_at < now()) AS overdue`;
const PRIVACY_FROM = `privacy_requests p LEFT JOIN networks n ON n.id = p.network_id LEFT JOIN platform_admins a ON a.id = p.assignee_id`;

/** Requests that name no network are platform-wide — an 'assigned' role sees only its networks' requests. */
function privacyScope(ids: string[] | null, next: number): { sql: string; params: unknown[] } {
  return ids === null ? { sql: 'TRUE', params: [] } : { sql: `p.network_id = ANY($${next}::uuid[])`, params: [ids] };
}

export function trustRoutes(): Router {
  const r = Router();

  r.get('/trust/summary', requirePerm('trust', 'read'), asyncHandler(async (req, res) => {
    const sc = networkScope(req, 'n', 1);
    const ids = await scopedNetworkIds(req);
    const [kpis, networks, suspicious, blocks, hits, privacy, scan, matcher] = await Promise.all([
      query<{ clicks: string; invalid: string; rejected: string; score_sum: string }>(
        `SELECT COALESCE(SUM(s.clicks), 0)::text AS clicks, COALESCE(SUM(s.invalid_clicks), 0)::text AS invalid,
                COALESCE(SUM(s.rejected_clicks), 0)::text AS rejected, COALESCE(SUM(s.fraud_score_sum), 0)::text AS score_sum
           FROM stats_clicks_15m s JOIN networks n ON n.id = s.network_id WHERE s.bucket >= now() - interval '7 days' AND ${sc.sql}`, sc.params),
      query<{ id: string; name: string; status: string; clicks: string; invalid: string; rejected: string; score_sum: string }>(
        `SELECT n.id, n.name, n.status, SUM(s.clicks)::text AS clicks, SUM(s.invalid_clicks)::text AS invalid,
                SUM(s.rejected_clicks)::text AS rejected, SUM(s.fraud_score_sum)::text AS score_sum
           FROM stats_clicks_15m s JOIN networks n ON n.id = s.network_id
          WHERE s.bucket >= now() - interval '7 days' AND ${sc.sql}
          GROUP BY n.id HAVING SUM(s.clicks) > 0
          ORDER BY SUM(s.invalid_clicks)::numeric / SUM(s.clicks) DESC, SUM(s.clicks) DESC LIMIT 25`, sc.params),
      query<{ ip: string; network_ids: string[]; clicks: number; flagged: number; avg_score: number; top_flags: string[]; first_seen: string; last_seen: string }>(
        `SELECT f.ip, f.network_ids, f.clicks, f.flagged, f.avg_score, f.top_flags, f.first_seen, f.last_seen
           FROM platform_fraud_ips f WHERE ($1::uuid[] IS NULL OR f.network_ids && $1::uuid[])
          ORDER BY f.flagged DESC, f.clicks DESC LIMIT 25`, [ids]),
      query<{ id: string; kind: BlockKind; value: string; value_to: string | null }>(
        `SELECT id, kind, value, value_to FROM platform_blocklist WHERE expires_at IS NULL OR expires_at > now()`),
      blocklistHits(),
      query<Record<string, number>>(
        `SELECT COUNT(*) FILTER (WHERE p.status IN ('new', 'in_progress'))::int AS open,
                COUNT(*) FILTER (WHERE p.status IN ('new', 'in_progress') AND p.due_at < now())::int AS overdue,
                COUNT(*) FILTER (WHERE p.status IN ('new', 'in_progress') AND p.due_at >= now() AND p.due_at < now() + interval '7 days')::int AS due_soon,
                COUNT(*) FILTER (WHERE p.status = 'completed' AND p.completed_at >= now() - interval '30 days')::int AS completed_30d
           FROM privacy_requests p WHERE ${privacyScope(ids, 1).sql}`, privacyScope(ids, 1).params),
      lastTrustScan(),
      getPlatformBlocklist(),
    ]);
    // Network names for the suspicious addresses (one query for all of them).
    const nameIds = [...new Set(suspicious.rows.flatMap((s) => s.network_ids))];
    const names = new Map((nameIds.length ? (await query<{ id: string; name: string }>('SELECT id, name FROM networks WHERE id = ANY($1::uuid[])', [nameIds])).rows : [])
      .map((n) => [n.id, n.name]));
    const k = kpis.rows[0]!;
    const avg = (sum: string, clicks: string) => (Number(clicks) > 0 ? Math.round(Number(sum) / Number(clicks)) : null);
    const pct = (part: string, whole: string) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 1000) / 10 : 0);
    const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);
    sendOk(res, {
      kpis: {
        clicks7d: Number(k.clicks), invalid7d: Number(k.invalid), rejected7d: Number(k.rejected), invalidPct: pct(k.invalid, k.clicks),
        avgScore: avg(k.score_sum, k.clicks),
      },
      networks: networks.rows.map((n) => ({
        id: n.id, name: n.name, status: n.status, clicks: Number(n.clicks), invalid: Number(n.invalid), rejected: Number(n.rejected),
        invalidPct: pct(n.invalid, n.clicks), avgScore: avg(n.score_sum, n.clicks),
      })),
      scan,
      suspicious: suspicious.rows.map((s) => ({
        ...s, networks: s.network_ids.filter((id) => ids === null || ids.includes(id)).map((id) => ({ id, name: names.get(id) ?? 'deleted network' })),
        blocked: Boolean(matcher?.match({ ip: s.ip, userAgent: null, referrer: null })),
      })),
      blocklist: {
        entries: blocks.rows.length, hits: totalHits,
        top: blocks.rows.map((b) => ({ ...b, hits: hits[b.id] ?? 0 })).filter((b) => b.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 5),
      },
      privacy: privacy.rows[0],
    });
  }));

  r.post('/trust/scan', requirePerm('trust', 'full'), asyncHandler(async (_req, res) => { sendOk(res, await scanTrust()); }));

  // ---------- Blocklist ----------
  r.get('/trust/blocklist', requirePerm('trust', 'read'), validateQuery(blockListSchema), asyncHandler(async (_req, res) => {
    const f = res.locals.query as z.infer<typeof blockListSchema>;
    const [rows, hits] = await Promise.all([
      query<{ id: string }>(
        `SELECT b.id, b.kind, b.value, b.value_to, b.reason, b.expires_at, b.created_at, COALESCE(a.name, a.email) AS created_by_name,
                (b.expires_at IS NOT NULL AND b.expires_at <= now()) AS expired
           FROM platform_blocklist b LEFT JOIN platform_admins a ON a.id = b.created_by
          WHERE ($1::text IS NULL OR b.kind = $1) AND ($2::text IS NULL OR b.value ILIKE $2 OR b.reason ILIKE $2)
          ORDER BY b.created_at DESC LIMIT 1000`, [f.kind ?? null, f.q ? containsPattern(f.q) : null]),
      blocklistHits(),
    ]);
    sendOk(res, rows.rows.map((b) => ({ ...b, hits: hits[b.id] ?? 0 })));
  }));

  r.post('/trust/blocklist', requirePerm('trust', 'full'), validateBody(blockSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof blockSchema>;
    const to = b.kind === 'ip' && b.valueTo ? b.valueTo : null;
    const err = blocklistEntryError(b.kind, b.value, to);
    if (err) throw badRequest(err);
    if (b.expiresAt && Date.parse(b.expiresAt) <= Date.now()) throw badRequest('The expiry must be in the future.');
    const value = b.kind === 'referrer' ? normalizeReferrerDomain(b.value) : b.value.trim();
    const row = (await query<{ id: string }>(
      `INSERT INTO platform_blocklist (kind, value, value_to, reason, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING id`, [b.kind, value, to, b.reason ?? null, b.expiresAt ?? null, meId(req)])).rows[0];
    if (!row) throw conflict(`${value} is already on the platform blocklist.`);
    await invalidatePlatformBlocklist();
    await writePlatformAudit(req, null, { action: 'trust.block', entityType: 'platform_blocklist', entityId: row.id, after: { kind: b.kind, value, valueTo: to, reason: b.reason ?? null, expiresAt: b.expiresAt ?? null } });
    sendOk(res, { id: row.id, kind: b.kind, value, value_to: to }, undefined, 201);
  }));

  r.delete('/trust/blocklist/:id', requirePerm('trust', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const row = UUID_RE.test(id) ? (await query<{ kind: string; value: string }>('DELETE FROM platform_blocklist WHERE id = $1 RETURNING kind, value', [id])).rows[0] : undefined;
    if (!row) throw notFound('Block not found');
    await invalidatePlatformBlocklist();
    await forgetBlocklistHits(id);
    await writePlatformAudit(req, null, { action: 'trust.unblock', entityType: 'platform_blocklist', entityId: id, before: row });
    sendOk(res, { deleted: true });
  }));

  // ---------- Privacy (GDPR / CCPA) requests ----------
  r.get('/trust/privacy', requirePerm('trust', 'read'), validateQuery(privacyListSchema), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof privacyListSchema>;
    const ids = await scopedNetworkIds(req);
    const sc = privacyScope(ids, 3);
    const where = `($1::text = 'all' OR ($1::text = 'open' AND p.status IN ('new', 'in_progress')) OR p.status = $1::text)
      AND ($2::text IS NULL OR p.number::text = $2 OR n.name ILIKE $2 OR p.requester_email ILIKE $2) AND ${sc.sql}`;
    const params = [f.status, f.q ? (/^\d+$/.test(f.q) ? f.q : containsPattern(f.q)) : null, ...sc.params];
    const [rows, count] = await Promise.all([
      query<PrivacyRow>(`SELECT ${PRIVACY_COLS} FROM ${PRIVACY_FROM} WHERE ${where} ORDER BY (p.status IN ('new', 'in_progress')) DESC, p.due_at
              LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, f.limit, f.offset]),
      query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${PRIVACY_FROM} WHERE ${where}`, params),
    ]);
    // The subject itself only for those who act on requests; read-only sees it masked.
    const full = can(req, 'trust', 'full');
    sendOk(res, rows.rows.map((p) => ({ ...p, subject: full ? p.subject : maskSubject(p.subject_type, p.subject) })),
      { limit: f.limit, offset: f.offset, total: count.rows[0]?.n ?? 0 });
  }));

  r.post('/trust/privacy', requirePerm('trust', 'full'), validateBody(privacySchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof privacySchema>;
    const err = subjectError(b.subjectType, b.subject);
    if (err) throw badRequest(err);
    if (b.networkId) {
      if (!(await query('SELECT 1 FROM networks WHERE id = $1', [b.networkId])).rows[0]) throw notFound('Network not found');
      await assertNetworkInScope(req, b.networkId);
    } else if ((await scopedNetworkIds(req)) !== null) {
      throw badRequest('Choose one of your networks — your role can’t log a request for every network.');
    }
    const received = b.receivedAt ? new Date(b.receivedAt) : new Date();
    if (received.getTime() > Date.now() + 60_000) throw badRequest('The date received can’t be in the future.');
    const due = new Date(received.getTime() + DUE_DAYS[b.regulation] * 86_400_000);
    const subject = normalizeSubject(b.subjectType, b.subject);
    const row = (await query<{ id: string; number: string }>(
      `INSERT INTO privacy_requests (network_id, kind, regulation, subject_type, subject, subject_hash, requester_email, received_at, due_at, notes, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, number::text AS number`,
      [b.networkId ?? null, b.kind, b.regulation, b.subjectType, subject, hashSubject(b.subjectType, subject), b.requesterEmail ?? null,
        received.toISOString(), due.toISOString(), b.notes ?? null, b.assigneeId === undefined ? meId(req) : b.assigneeId, meId(req)])).rows[0]!;
    await writePlatformAudit(req, b.networkId ?? null, {
      action: 'privacy.create', entityType: 'privacy_request', entityId: row.id,
      after: { number: row.number, kind: b.kind, regulation: b.regulation, subjectType: b.subjectType, subject: maskSubject(b.subjectType, subject), dueAt: due.toISOString() },
    });
    sendOk(res, { id: row.id, number: row.number, dueAt: due.toISOString() }, undefined, 201);
  }));

  async function loadPrivacy(req: Parameters<typeof scopedNetworkIds>[0], id: string): Promise<PrivacyRow & { network_name: string | null }> {
    if (!UUID_RE.test(id)) throw notFound('Request not found');
    const ids = await scopedNetworkIds(req);
    const sc = privacyScope(ids, 2);
    const row = (await query<PrivacyRow & { network_name: string | null }>(`SELECT ${PRIVACY_COLS} FROM ${PRIVACY_FROM} WHERE p.id = $1 AND ${sc.sql}`, [id, ...sc.params])).rows[0];
    if (!row) throw notFound('Request not found');
    return row;
  }

  /** Done (completed or rejected): stamp it and keep only the masked subject. */
  async function close(id: string, status: 'completed' | 'rejected', row: PrivacyRow, result?: unknown): Promise<void> {
    await query(
      `UPDATE privacy_requests SET status = $2, completed_at = now(), subject = $3, result = COALESCE($4::jsonb, result) WHERE id = $1`,
      [id, status, maskSubject(row.subject_type as SubjectType, row.subject), result === undefined ? null : JSON.stringify(result)]);
  }

  r.patch('/trust/privacy/:id', requirePerm('trust', 'full'), validateBody(privacyPatchSchema), asyncHandler(async (req, res) => {
    const row = await loadPrivacy(req, req.params.id!);
    const b = req.body as z.infer<typeof privacyPatchSchema>;
    const done = row.status === 'completed' || row.status === 'rejected';
    if (done && b.status && b.status !== row.status) throw conflict(`Request #${row.number} is ${row.status} — log a new one if the person asks again.`);
    if (b.assigneeId) {
      const a = (await query<{ status: string }>('SELECT status FROM platform_admins WHERE id = $1', [b.assigneeId])).rows[0];
      if (!a || a.status !== 'active') throw badRequest('Assign it to an active member of the team.');
    }
    if (b.notes !== undefined || b.assigneeId !== undefined || (b.status && !['completed', 'rejected'].includes(b.status))) {
      await query(
        `UPDATE privacy_requests SET notes = CASE WHEN $2 THEN $3 ELSE notes END, assignee_id = CASE WHEN $4 THEN $5::uuid ELSE assignee_id END,
                status = COALESCE($6, status) WHERE id = $1`,
        [row.id, b.notes !== undefined, b.notes ?? null, b.assigneeId !== undefined, b.assigneeId ?? null,
          b.status && !['completed', 'rejected'].includes(b.status) ? b.status : null]);
    }
    if (!done && (b.status === 'completed' || b.status === 'rejected')) await close(row.id, b.status, row);
    await writePlatformAudit(req, row.network_id, { action: 'privacy.update', entityType: 'privacy_request', entityId: row.id, after: { number: row.number, ...b } });
    sendOk(res, await loadPrivacy(req, row.id));
  }));

  // Erase now: what is held about the subject is cleared (personal fields only) and the request completes.
  r.post('/trust/privacy/:id/erase', requirePerm('trust', 'full'), asyncHandler(async (req, res) => {
    const row = await loadPrivacy(req, req.params.id!);
    if (row.kind !== 'erasure') throw badRequest(`Request #${row.number} asks for a copy (access), not erasure — export it instead.`);
    if (row.status === 'completed' || row.status === 'rejected') throw conflict(`Request #${row.number} is already ${row.status}.`);
    const result = await eraseSubject(row);
    await close(row.id, 'completed', row, result);
    await writePlatformAudit(req, row.network_id, {
      action: 'privacy.erase', entityType: 'privacy_request', entityId: row.id,
      after: { number: row.number, subject: maskSubject(row.subject_type, row.subject), ...result },
    });
    sendOk(res, { result, status: 'completed' });
  }));

  // Access: what is held about the subject, as CSV (send it to the person, then mark the request completed).
  r.get('/trust/privacy/:id/export.csv', requirePerm('trust', 'full'), asyncHandler(async (req, res) => {
    const row = await loadPrivacy(req, req.params.id!);
    if (row.status === 'completed' || row.status === 'rejected') throw conflict(`Request #${row.number} is ${row.status} — its subject is no longer kept.`);
    const rows = await exportSubject(row);
    await writePlatformAudit(req, row.network_id, { action: 'privacy.export', entityType: 'privacy_request', entityId: row.id, after: { number: row.number, rows: rows.length - 1 } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="privacy-request-${row.number}.csv"`);
    res.send(rows.map((cols) => cols.map(csvCell).join(',')).join('\r\n'));
  }));

  return r;
}
