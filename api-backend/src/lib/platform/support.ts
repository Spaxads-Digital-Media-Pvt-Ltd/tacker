/**
 * Super Admin › Support — the help desk's rules, shared by the tenant's "Contact support" and the platform's
 * queue: support settings (platform_settings 'support' over the defaults — first-response targets per
 * priority, days until a resolved ticket closes itself, auto-assignment), creating a ticket (its first
 * message, its first-response deadline, its assignee: the active Support member with the fewest open
 * tickets), and closing resolved tickets after the wait.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const CATEGORIES = ['technical', 'tracking', 'billing', 'account', 'feature_request', 'bug', 'other'] as const;
export const STATUSES = ['open', 'pending', 'on_hold', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof STATUSES)[number];
/** Still needs work (counts for assignment load and the queue). */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['open', 'pending', 'on_hold'];

export interface SupportSettings {
  /** Hours to a first reply, per priority (the SLA). */
  firstResponseHours: Record<Priority, number>;
  /** A resolved ticket closes itself after this many days without a customer reply. */
  autoCloseDays: number;
  /** New tickets go to the Support member with the fewest open ones. */
  autoAssign: boolean;
}

export const DEFAULT_SUPPORT: SupportSettings = {
  firstResponseHours: { urgent: 1, high: 4, normal: 8, low: 24 },
  autoCloseDays: 7,
  autoAssign: true,
};

export async function supportSettings(): Promise<SupportSettings> {
  const v = (await query<{ value: Partial<SupportSettings> }>(`SELECT value FROM platform_settings WHERE key = 'support'`)).rows[0]?.value ?? {};
  return { ...DEFAULT_SUPPORT, ...v, firstResponseHours: { ...DEFAULT_SUPPORT.firstResponseHours, ...(v.firstResponseHours ?? {}) } };
}

export async function saveSupportSettings(value: SupportSettings, platformAdminId: string | null): Promise<SupportSettings> {
  await query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('support', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(value), platformAdminId]);
  return supportSettings();
}

type Db = Pick<PoolClient, 'query'>;

/** The active Support member with the fewest active tickets (ties: the longest-standing), or null. */
export async function nextSupportAgent(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT pa.id FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
      WHERE r.key = 'support' AND pa.status = 'active'
      ORDER BY (SELECT COUNT(*) FROM support_tickets t WHERE t.assignee_id = pa.id AND t.status IN ('open', 'pending', 'on_hold')), pa.created_at
      LIMIT 1`);
  return rows[0]?.id ?? null;
}

export interface NewTicket {
  networkId: string;
  subject: string;
  category: (typeof CATEGORIES)[number];
  priority: Priority;
  body: string;
  /** The network staff member asking (tenant side) … */
  requester?: { userId: string | null; email: string | null; name: string | null } | null;
  /** … or a platform member opening it for them (e.g. after a call). */
  createdByAdminId?: string | null;
  createdByAdminName?: string | null;
  assigneeId?: string | null;
}

export async function createTicket(t: NewTicket): Promise<{ id: string; number: string }> {
  const settings = await supportSettings();
  return withTransaction(async (c) => {
    const assignee = t.assigneeId !== undefined ? t.assigneeId : settings.autoAssign ? await nextSupportAgent(c) : null;
    const ticket = (await c.query<{ id: string; number: string }>(
      // Opened by a platform member (they already engaged): it counts as answered.
      `INSERT INTO support_tickets (network_id, subject, category, priority, requester_user_id, requester_email, requester_name, assignee_id,
                                    first_response_due_at, last_customer_at, created_by_admin_id, first_response_at, last_staff_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9::int), CASE WHEN $10::uuid IS NULL THEN now() END, $10,
               CASE WHEN $10::uuid IS NOT NULL THEN now() END, CASE WHEN $10::uuid IS NOT NULL THEN now() END)
       RETURNING id, number::text`,
      [t.networkId, t.subject, t.category, t.priority, t.requester?.userId ?? null, t.requester?.email ?? null, t.requester?.name ?? null, assignee,
        settings.firstResponseHours[t.priority], t.createdByAdminId ?? null])).rows[0]!;
    await c.query(
      `INSERT INTO support_messages (ticket_id, author_kind, author_user_id, author_admin_id, author_name, body) VALUES ($1, $2, $3, $4, $5, $6)`,
      [ticket.id, t.createdByAdminId ? 'staff' : 'customer', t.requester?.userId ?? null, t.createdByAdminId ?? null,
        t.createdByAdminId ? t.createdByAdminName ?? null : t.requester?.name ?? t.requester?.email ?? null, t.body]);
    return ticket;
  });
}

/** Resolved tickets with no customer reply for `autoCloseDays` → closed (with a note on the ticket). */
export async function closeResolvedTickets(now: Date = new Date()): Promise<number> {
  const { autoCloseDays } = await supportSettings();
  return withTransaction(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `UPDATE support_tickets SET status = 'closed', closed_at = $2
        WHERE status = 'resolved' AND resolved_at < $2::timestamptz - make_interval(days => $1::int) RETURNING id`, [autoCloseDays, now]);
    if (rows.length) {
      await c.query(
        `INSERT INTO support_messages (ticket_id, author_kind, author_name, body)
         SELECT id, 'system', 'System', $2 FROM unnest($1::uuid[]) AS id`,
        [rows.map((r) => r.id), `Closed automatically ${autoCloseDays} days after it was resolved.`]);
    }
    return rows.length;
  });
}
