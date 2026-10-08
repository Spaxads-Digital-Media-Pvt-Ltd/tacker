/**
 * Control Center › Accounts › History Log — a real, network-wide activity feed over the same
 * `audit_log` table every mutating admin route already writes to (writeAudit(), spec §4/§12).
 * Every other "History" surface in this app reads a per-entity slice of this same table (e.g.
 * Tiered Commissions' `/:id/history`); this is the un-filtered, network-wide version the
 * reference's own Control Center › Accounts › History Log shows — verified live down to its real
 * toolbar (date range, Service filter, search, Table Actions) and the green "NEW!" badge next to
 * newly-created entities.
 *
 * Every filter (Service / Portal / Method / search) runs in SQL and the list is paged with
 * limit/offset + a total, so counts, paging and export are exact over the whole filtered set
 * (previously a hard LIMIT 200 made the client-side filters/counts silently wrong).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { query } from '../../../lib/db/pool.js';
import { containsPattern } from '../../../lib/db/like.js';
import { validateQuery } from '../../../lib/http/validate.js';
import { queryDate } from '../../../lib/http/query-params.js';

export const AUDIT_LOG_MAX_PAGE = 500;

/** Portal label → actor_type predicate (mirrors the `portal` mapping in toDTO below). */
const PORTALS = ['Dashboard', 'API', 'Platform Admin', 'System'] as const;
/** actor_type is CHECK-constrained to exactly these four values. */
const ACTOR_BY_PORTAL: Record<(typeof PORTALS)[number], string> = {
  Dashboard: 'user', API: 'api_key', 'Platform Admin': 'platform_admin', System: 'system',
};
/** Method label → action suffixes (mirrors METHOD_BY_ACTION_SUFFIX); 'Scheduled Action' = system actor. */
const METHODS = ['POST', 'PATCH', 'DELETE', 'Scheduled Action'] as const;

const METHOD_BY_ACTION_SUFFIX: Record<string, string> = {
  create: 'POST', update: 'PATCH', delete: 'DELETE', send: 'POST', toggle: 'PATCH', regenerate: 'POST', clear: 'DELETE',
};
const SUFFIXES_BY_METHOD: Record<string, string[]> = Object.entries(METHOD_BY_ACTION_SUFFIX).reduce(
  (acc, [suffix, method]) => { (acc[method] ??= []).push(suffix); return acc; },
  {} as Record<string, string[]>,
);

export const auditLogQuery = z.object({
  from: queryDate.optional(),
  to: queryDate.optional(),
  /** Raw service key (entity_type, or the action's first segment) — see GET /services. */
  service: z.string().trim().min(1).max(100).optional(),
  portal: z.enum(PORTALS).optional(),
  method: z.enum(METHODS).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_PAGE).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
}).refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), { message: '"from" must be on or before "to"', path: ['from'] });

export type AuditLogQuery = z.infer<typeof auditLogQuery>;

interface Row {
  id: string; ref: string; created_at: string; action: string; entity_type: string | null;
  actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null;
  employee_name: string | null; employee_email: string | null;
}

/** SQL expression for the "service" key a row is grouped/filtered by. */
const SERVICE_KEY_SQL = `COALESCE(al.entity_type, split_part(al.action, '.', 1))`;
/** Last dot-segment of the action (JS: action.split('.').pop()). */
const ACTION_SUFFIX_SQL = `regexp_replace(al.action, '^.*\\.', '')`;
const USERS_JOIN = `LEFT JOIN users u ON al.actor_type = 'user' AND u.auth_user_id::text = al.actor_id AND u.network_id = al.network_id`;

function humanize(word: string): string {
  return word.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** WHERE clause + bound params for the filters. Every value is a bind parameter; network_id is $1. */
export function buildAuditLogWhere(networkId: string, f: Omit<AuditLogQuery, 'limit' | 'offset'>): { where: string; params: unknown[] } {
  const params: unknown[] = [networkId];
  const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const clauses = ['al.network_id = $1'];
  if (f.from) clauses.push(`al.created_at >= ${bind(f.from)}`);
  if (f.to) clauses.push(`al.created_at <= ${bind(f.to)}`);
  if (f.service) clauses.push(`${SERVICE_KEY_SQL} = ${bind(f.service)}`);
  if (f.portal) clauses.push(`al.actor_type = ${bind(ACTOR_BY_PORTAL[f.portal])}`);
  if (f.method) {
    if (f.method === 'Scheduled Action') clauses.push(`al.actor_type = ${bind('system')}`);
    else clauses.push(`al.actor_type <> ${bind('system')} AND ${ACTION_SUFFIX_SQL} = ANY(${bind(SUFFIXES_BY_METHOD[f.method] ?? [])}::text[])`);
  }
  if (f.q) {
    const p = bind(containsPattern(f.q));
    // Same fields the old client-side search covered: employee, service/changes label, user IP.
    clauses.push(`(
      COALESCE(u.name, '') ILIKE ${p} ESCAPE '\\'
      OR COALESCE(u.email, '') ILIKE ${p} ESCAPE '\\'
      OR COALESCE(al.actor_id, '') ILIKE ${p} ESCAPE '\\'
      OR replace(${SERVICE_KEY_SQL}, '_', ' ') ILIKE ${p} ESCAPE '\\'
      OR COALESCE(host(al.ip), '') ILIKE ${p} ESCAPE '\\'
    )`);
  }
  return { where: clauses.join(' AND '), params };
}

function toDTO(row: Row) {
  const suffix = row.action.split('.').pop() ?? '';
  const entityLabel = humanize(row.entity_type ?? row.action.split('.')[0] ?? 'Record');
  return {
    id: row.id, ref: Number(row.ref), operationTime: row.created_at,
    service: entityLabel,
    changes: `- ${entityLabel}`,
    isNew: suffix === 'create',
    employee: row.employee_name ?? row.employee_email ?? row.actor_id ?? '—',
    method: row.actor_type === 'system' ? 'Scheduled Action' : (METHOD_BY_ACTION_SUFFIX[suffix] ?? '—'),
    portal: row.actor_type === 'user' ? 'Dashboard' : row.actor_type === 'api_key' ? 'API' : row.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: row.ip, userAgent: row.user_agent,
  };
}

/** One filtered page + the filtered total. */
export async function listAuditLog(networkId: string, q: AuditLogQuery) {
  const { limit, offset, ...filters } = q;
  const { where, params } = buildAuditLogWhere(networkId, filters);
  const countRes = await query<{ total: string }>(
    `SELECT count(*)::text AS total FROM audit_log al ${USERS_JOIN} WHERE ${where}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  const pageParams = [...params, limit, offset];
  const { rows } = await query<Row>(
    `SELECT al.id, al.ref, al.created_at, al.action, al.entity_type, al.actor_type, al.actor_id, al.ip, al.user_agent,
            u.name AS employee_name, u.email AS employee_email
       FROM audit_log al
       ${USERS_JOIN}
      WHERE ${where}
      ORDER BY al.created_at DESC, al.ref DESC
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
  );
  return { rows: rows.map(toDTO), limit, offset, total };
}

export function auditLogRoutes(): Router {
  const r = Router();

  r.get('/', validateQuery(auditLogQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as AuditLogQuery;
    const { rows, limit, offset, total } = await listAuditLog(req.scope!.networkId, q);
    sendOk(res, rows, { limit, offset, total });
  }));

  /** Distinct service keys present in this network's log (for the Service filter). */
  r.get('/services', asyncHandler(async (req, res) => {
    const { rows } = await query<{ key: string }>(
      `SELECT DISTINCT ${SERVICE_KEY_SQL} AS key FROM audit_log al WHERE al.network_id = $1 ORDER BY 1 LIMIT 500`,
      [req.scope!.networkId],
    );
    sendOk(res, rows.filter((row) => row.key).map((row) => ({ key: row.key, label: humanize(row.key) })));
  }));

  return r;
}
