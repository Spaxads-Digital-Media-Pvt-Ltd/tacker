/**
 * Super Admin › Comms — the help center, the changelog, the public status page and email broadcasts.
 *
 * Status: each component has a state; the page's overall state is the worst component state, or an
 * open incident's impact when that's worse. A broadcast emails the network teams it targets — team
 * members (users rows, active) of networks in the chosen statuses and plans, with the chosen roles —
 * once, through the platform email queue (lib/email/outbox.ts enqueuePlatformEmails).
 */
import { z } from 'zod';
import { query } from '../db/pool.js';
import { enqueuePlatformEmails } from '../email/outbox.js';
import { escapeHtml } from '../email/transactional.js';

export const COMPONENT_STATES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as const;
export const INCIDENT_IMPACTS = ['none', 'minor', 'major', 'critical', 'maintenance'] as const;
export const INCIDENT_STATES = ['scheduled', 'investigating', 'identified', 'monitoring', 'resolved'] as const;
export const ARTICLE_AUDIENCES = ['all', 'staff', 'partner', 'advertiser'] as const;
export const BROADCAST_ROLES = ['admin', 'manager', 'finance', 'read_only'] as const;

/** Worse state = higher rank. */
const STATE_RANK: Record<string, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
const IMPACT_STATE: Record<string, string> = { none: 'operational', maintenance: 'maintenance', minor: 'degraded', major: 'partial_outage', critical: 'major_outage' };

export function overallStatus(components: { status: string }[], openIncidents: { impact: string }[]): string {
  const states = [...components.map((c) => c.status), ...openIncidents.map((i) => IMPACT_STATE[i.impact] ?? 'operational')];
  return states.reduce((worst, s) => ((STATE_RANK[s] ?? 0) > (STATE_RANK[worst] ?? 0) ? s : worst), 'operational');
}

export interface IncidentView {
  id: string; title: string; impact: string; status: string; component_ids: string[]; starts_at: string; resolved_at: string | null;
  updates: { id: string; status: string; body: string; created_at: string }[];
}

/** The public status page: components, open + scheduled incidents, and the last 14 days' resolved ones. */
export async function statusPage(): Promise<{ status: string; components: { id: string; name: string; description: string | null; status: string }[]; incidents: IncidentView[]; history: IncidentView[] }> {
  const comps = (await query<{ id: string; name: string; description: string | null; status: string }>(
    'SELECT id, name, description, status FROM status_components ORDER BY position, name')).rows;
  const incidents = (await query<Omit<IncidentView, 'updates'>>(
    `SELECT id, title, impact, status, component_ids, starts_at, resolved_at FROM status_incidents
      WHERE status <> 'resolved' OR resolved_at >= now() - interval '14 days'
      ORDER BY (status = 'resolved'), starts_at DESC LIMIT 100`)).rows;
  const ids = incidents.map((i) => i.id);
  const updates = ids.length ? (await query<{ id: string; incident_id: string; status: string; body: string; created_at: string }>(
    'SELECT id, incident_id, status, body, created_at FROM status_incident_updates WHERE incident_id = ANY($1::uuid[]) ORDER BY created_at DESC', [ids])).rows : [];
  const withUpdates = incidents.map((i) => ({ ...i, updates: updates.filter((u) => u.incident_id === i.id).map(({ incident_id: _x, ...u }) => u) }));
  const open = withUpdates.filter((i) => i.status !== 'resolved');
  // A scheduled maintenance only counts once it has started.
  const active = open.filter((i) => i.status !== 'scheduled' || new Date(i.starts_at) <= new Date());
  return { status: overallStatus(comps, active), components: comps, incidents: open, history: withUpdates.filter((i) => i.status === 'resolved') };
}

export const audienceSchema = z.object({
  roles: z.array(z.enum(BROADCAST_ROLES)).max(4).default([]),
  planIds: z.array(z.string().uuid()).max(50).default([]),
  networkStatuses: z.array(z.enum(['active', 'suspended'])).max(2).default(['active']),
}).strict();
export type BroadcastAudience = z.infer<typeof audienceSchema>;

/** The addresses a broadcast reaches (active team members of the matching networks), de-duplicated. */
export async function broadcastRecipients(a: BroadcastAudience): Promise<string[]> {
  const params: unknown[] = [];
  const where = [`u.status = 'active'`, `u.email IS NOT NULL`, `n.status <> 'deleted'`];
  if (a.roles.length) { params.push(a.roles); where.push(`u.role = ANY($${params.length}::text[])`); }
  if (a.networkStatuses.length) { params.push(a.networkStatuses); where.push(`n.status = ANY($${params.length}::text[])`); }
  if (a.planIds.length) { params.push(a.planIds); where.push(`EXISTS (SELECT 1 FROM subscriptions s WHERE s.network_id = n.id AND s.plan_id = ANY($${params.length}::uuid[]))`); }
  const { rows } = await query<{ email: string }>(
    `SELECT DISTINCT lower(u.email) AS email FROM users u JOIN networks n ON n.id = u.network_id WHERE ${where.join(' AND ')} ORDER BY 1`, params);
  return rows.map((r) => r.email);
}

/** Plain text → simple HTML paragraphs (escaped). */
export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

/**
 * Send a draft broadcast once: claimed (draft → sending) so a double click or two staff never send it
 * twice, emailed to every recipient, then marked sent with the count.
 */
export async function sendBroadcast(id: string): Promise<{ recipients: number; error?: string } | null> {
  const { rows } = await query<{ subject: string; body: string; audience: BroadcastAudience }>(
    `UPDATE platform_broadcasts SET status = 'sending' WHERE id = $1 AND status = 'draft' RETURNING subject, body, audience`, [id]);
  const b = rows[0];
  if (!b) return null;
  const to = await broadcastRecipients(audienceSchema.parse(b.audience ?? {}));
  const sent = to.length ? await enqueuePlatformEmails('platform_broadcast', to, { subject: b.subject, html: textToHtml(b.body) }) : { ids: [] as string[] };
  await query(`UPDATE platform_broadcasts SET status = 'sent', recipients = $2, sent_at = now() WHERE id = $1`, [id, to.length]);
  return { recipients: to.length, ...(sent.error ? { error: sent.error } : {}) };
}
