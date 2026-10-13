/**
 * Audit-log writer (spec §4, §12) — every mutating admin action is recorded with actor, action,
 * and before/after. Derives actor + network from the request identity so callers can't spoof it.
 */
import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { ScopedDb } from './db/scoped-db.js';
import { query } from './db/pool.js';
import { logger } from './logger.js';

export interface AuditEntry {
  action: string; // e.g. 'advertiser.create'
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Requests that already wrote their own audit row (so the impersonation catch-all skips them). */
const audited = new WeakSet<Request>();

export async function writeAudit(req: Request, entry: AuditEntry): Promise<void> {
  const id = req.identity;
  if (!id) return; // unauthenticated mutations shouldn't reach here, but never throw from audit.
  audited.add(req);

  let networkId: string | undefined;
  let actorType = 'system';
  let actorId: string | undefined;
  // An admin impersonating a portal account (F-10): the row also names that admin.
  let impersonatedBy: string | null = null;

  if (id.surface === 'dashboard') {
    networkId = id.networkId;
    actorType = 'user';
    actorId = id.userId;
    if (id.kind !== 'admin') impersonatedBy = id.impersonatedBy ?? null;
  } else if (id.surface === 'public-api') {
    networkId = id.networkId;
    actorType = 'api_key';
    actorId = id.keyId;
  } else if (id.surface === 'platform-admin') {
    actorType = 'platform_admin';
    actorId = id.platformAdminId;
  }

  if (!networkId) return; // platform-admin actions are audited in their own path (Phase 1A).

  try {
    await ScopedDb.forNetwork(networkId).insert('audit_log', {
      actor_type: actorType,
      actor_id: actorId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      before: entry.before === undefined ? null : JSON.stringify(entry.before),
      after: entry.after === undefined ? null : JSON.stringify(entry.after),
      ip: req.ip ?? null,
      user_agent: req.get('user-agent') ?? null,
      ...(impersonatedBy ? { impersonated_by: impersonatedBy } : {}),
    });
  } catch (err) {
    // Auditing must never break the request it records; log and move on.
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}

/**
 * Every successful write made while an admin impersonates a portal account is audited to that admin
 * (F-10) — including routes that don't write an audit row of their own: those get a generic
 * `impersonation.write` row (method, path, status). Mount after authentication.
 */
export function auditImpersonatedWrites(req: Request, res: Response, next: NextFunction): void {
  const id = req.identity;
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (write && id && id.surface === 'dashboard' && id.kind !== 'admin' && id.impersonatedBy) {
    res.on('finish', () => {
      if (res.statusCode >= 400 || audited.has(req)) return;
      void writeAudit(req, {
        action: 'impersonation.write',
        after: { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode },
      });
    });
  }
  next();
}

/**
 * An action the platform took on its own (actor_type 'system' — the audit log shows it as
 * "Scheduled Action"), e.g. a scheduled action executed by the worker (F-17a). Pass the transaction's
 * client to write it atomically with the change it records; it throws then (so the change rolls back).
 */
export async function writeSystemAudit(
  networkId: string,
  entry: AuditEntry,
  db: Pick<PoolClient, 'query'> = { query: query as PoolClient['query'] },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (network_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
     VALUES ($1, 'system', NULL, $2, $3, $4, $5, $6)`,
    [
      networkId, entry.action, entry.entityType ?? null, entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
    ],
  );
}

/**
 * Platform-admin audit (spec §3C — all platform-admin actions are audit-logged). Uses a raw
 * insert because platform admins have no ScopedDb tenant context; network_id is explicit (nullable
 * for platform-global actions like plan management).
 */
export async function writePlatformAudit(
  req: Request,
  networkId: string | null,
  entry: AuditEntry,
): Promise<void> {
  const id = req.identity;
  const actorId = id && id.surface === 'platform-admin' ? id.platformAdminId : null;
  try {
    await query(
      `INSERT INTO audit_log (network_id, actor_type, actor_id, action, entity_type, entity_id, before, after, ip)
       VALUES ($1, 'platform_admin', $2, $3, $4, $5, $6, $7, $8)`,
      [
        networkId,
        actorId,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        req.ip ?? null,
      ],
    );
  } catch (err) {
    logger.error({ err, action: entry.action }, 'platform audit write failed');
  }
}
