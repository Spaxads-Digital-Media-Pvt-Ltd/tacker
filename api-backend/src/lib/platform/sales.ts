/**
 * Super Admin › Sales — the pipeline's vocabulary and what the platform routes and the public "Request a
 * demo" form share: stages (with the win probability the forecast weighs open deals by), sources, lead
 * routing (a new inbound lead goes to the active Sales member with the fewest open leads — ties to the
 * longest-standing member) and the lead timeline.
 */
import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';

export const STAGES = ['new', 'contacted', 'qualified', 'demo', 'trial', 'negotiation', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];
export const OPEN_STAGES = ['new', 'contacted', 'qualified', 'demo', 'trial', 'negotiation'] as const;
/** The chance an open deal at this stage closes — the weighted forecast (a common CRM default). */
export const STAGE_PROBABILITY: Record<(typeof OPEN_STAGES)[number], number> = {
  new: 0.1, contacted: 0.2, qualified: 0.4, demo: 0.5, trial: 0.6, negotiation: 0.8,
};
export const SOURCES = ['website', 'referral', 'event', 'outbound', 'partner', 'inbound', 'manual', 'other'] as const;
/** What a person logs on a lead's timeline (the rest — stage, owner, created, converted, inbound, task done — the system writes). */
export const LOGGED_ACTIVITIES = ['note', 'call', 'email', 'meeting'] as const;
export type ActivityKind = (typeof LOGGED_ACTIVITIES)[number] | 'stage' | 'owner' | 'created' | 'converted' | 'inbound' | 'task';

type Db = Pick<PoolClient, 'query'>;

/** SQL CASE giving a lead's win probability by its stage (won 1, lost 0). */
export const probabilitySql = (alias: string): string =>
  `(CASE ${alias}.stage ${Object.entries(STAGE_PROBABILITY).map(([s, p]) => `WHEN '${s}' THEN ${p}`).join(' ')} WHEN 'won' THEN 1 ELSE 0 END)`;

/** The active Sales member with the fewest open leads, or null when the team has no active Sales member. */
export async function nextSalesOwner(db: Db = pool): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT pa.id FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
      WHERE r.key = 'sales' AND pa.status = 'active'
      ORDER BY (SELECT COUNT(*) FROM sales_leads l WHERE l.owner_id = pa.id AND l.stage NOT IN ('won', 'lost')), pa.created_at
      LIMIT 1`);
  return rows[0]?.id ?? null;
}

export async function logLeadActivity(
  db: Db, leadId: string, kind: ActivityKind, body: string | null, meta: Record<string, unknown> = {}, actorId: string | null = null,
): Promise<void> {
  // clock_timestamp(): entries written in one transaction (a stage and an owner change) keep their order.
  await db.query(
    `INSERT INTO sales_activities (lead_id, kind, body, meta, actor_id, created_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
    [leadId, kind, body, JSON.stringify(meta), actorId]);
}

export interface InboundLead {
  company: string; contactName: string; email: string; phone?: string | null; website?: string | null;
  country?: string | null; monthlyClicks?: number | null; message?: string | null;
}

/**
 * A demo request from the public form: a new lead (source website) routed to a Sales member with a
 * follow-up task due in a day — or, when the email already has an open lead, a note on that one.
 */
export async function createInboundLead(b: InboundLead): Promise<{ leadId: string; duplicate: boolean }> {
  return withTransaction(async (client) => {
    const open = (await client.query<{ id: string }>(
      `SELECT id FROM sales_leads WHERE lower(email) = lower($1) AND stage NOT IN ('won', 'lost') ORDER BY created_at DESC LIMIT 1`, [b.email])).rows[0];
    if (open) {
      await logLeadActivity(client, open.id, 'inbound', b.message ?? null, { via: 'website', again: true, company: b.company, contactName: b.contactName });
      return { leadId: open.id, duplicate: true };
    }
    const owner = await nextSalesOwner(client);
    const lead = (await client.query<{ id: string }>(
      `INSERT INTO sales_leads (company, contact_name, email, phone, website, country, monthly_clicks, message, source, stage, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'website', 'new', $9) RETURNING id`,
      [b.company, b.contactName, b.email.toLowerCase(), b.phone ?? null, b.website ?? null, b.country ?? null, b.monthlyClicks ?? null, b.message ?? null, owner])).rows[0]!;
    await logLeadActivity(client, lead.id, 'inbound', b.message ?? null, { via: 'website' });
    if (owner) {
      await client.query(
        `INSERT INTO platform_tasks (title, kind, priority, due_at, assignee_id, lead_id) VALUES ($1, 'sales', 'high', now() + interval '1 day', $2, $3)`,
        [`Follow up: ${b.company} requested a demo`, owner, lead.id]);
    }
    return { leadId: lead.id, duplicate: false };
  });
}
