/**
 * Control Center › Accounts › History Log — a real, network-wide activity feed over the same
 * `audit_log` table every mutating admin route already writes to (writeAudit(), spec §4/§12).
 * Every other "History" surface in this app reads a per-entity slice of this same table (e.g.
 * Tiered Commissions' `/:id/history`); this is the un-filtered, network-wide version the
 * reference's own Control Center › Accounts › History Log shows — verified live down to its real
 * toolbar (date range, Service filter, search, Table Actions) and the green "NEW!" badge next to
 * newly-created entities.
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { query } from '../../../lib/db/pool.js';

interface Row {
  id: string; ref: string; created_at: string; action: string; entity_type: string | null;
  actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null;
  employee_name: string | null; employee_email: string | null;
}

const METHOD_BY_ACTION_SUFFIX: Record<string, string> = {
  create: 'POST', update: 'PATCH', delete: 'DELETE', send: 'POST', toggle: 'PATCH', regenerate: 'POST', clear: 'DELETE',
};

function humanize(word: string): string {
  return word.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function auditLogRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const from = typeof req.query['from'] === 'string' ? req.query['from'] : null;
    const to = typeof req.query['to'] === 'string' ? req.query['to'] : null;
    const params: unknown[] = [req.scope!.networkId];
    let where = 'al.network_id = $1';
    if (from) { params.push(from); where += ` AND al.created_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND al.created_at <= $${params.length}`; }

    const { rows } = await query<Row>(
      `SELECT al.id, al.ref, al.created_at, al.action, al.entity_type, al.actor_type, al.actor_id, al.ip, al.user_agent,
              u.name AS employee_name, u.email AS employee_email
         FROM audit_log al
         LEFT JOIN users u ON al.actor_type = 'user' AND u.auth_user_id::text = al.actor_id AND u.network_id = al.network_id
        WHERE ${where}
        ORDER BY al.created_at DESC LIMIT 200`,
      params,
    );
    sendOk(res, rows.map((row) => {
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
    }));
  }));

  return r;
}
