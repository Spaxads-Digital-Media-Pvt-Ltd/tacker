/**
 * Audit-log writer (spec §4, §12) — every mutating admin action is recorded with actor, action,
 * and before/after. Derives actor + network from the request identity so callers can't spoof it.
 */
import type { Request } from 'express';
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

export async function writeAudit(req: Request, entry: AuditEntry): Promise<void> {
  const id = req.identity;
  if (!id) return; // unauthenticated mutations shouldn't reach here, but never throw from audit.

  let networkId: string | undefined;
  let actorType = 'system';
  let actorId: string | undefined;

  if (id.surface === 'dashboard') {
    networkId = id.networkId;
    actorType = 'user';
    actorId = id.userId;
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
    });
  } catch (err) {
    // Auditing must never break the request it records; log and move on.
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
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
