/**
 * Alerts (spec §10) — surface anomalies for humans + the AI ops layer (Phase 7). Deduped: at most
 * one OPEN alert per (network, type, entity) so a repeating scan updates rather than spams.
 */
import { query } from '../db/pool.js';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertInput {
  type: string;
  severity?: AlertSeverity;
  entityType?: string;
  entityId?: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** Raise an alert. Returns true if a new alert was created, false if one was already open (deduped). */
export async function raiseAlert(networkId: string, a: AlertInput): Promise<boolean> {
  const res = await query(
    `INSERT INTO alerts (network_id, type, severity, entity_type, entity_id, title, description, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (network_id, type, (COALESCE(entity_id, ''))) WHERE status = 'open' DO NOTHING`,
    [
      networkId, a.type, a.severity ?? 'medium', a.entityType ?? null, a.entityId ?? null,
      a.title, a.description ?? null, JSON.stringify(a.metadata ?? {}),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}
