/**
 * Customer health (Super Admin › Customer success) — a 0–100 score per network, the way customer-success
 * tools weigh adoption, financial and relationship signals, from five parts:
 *
 *   usage       30 %  traffic and conversions in the last 7 days
 *   trend       15 %  clicks in the last 7 complete days against the 7 before
 *   engagement  20 %  how recently anyone in the network signed in
 *   billing     20 %  its subscription and unpaid invoices
 *   onboarding  15 %  the setup milestones it reached (owner signed in, domain, offers, partners, first
 *                     click and conversion, a partner postback, a team, a plan)
 *
 * healthy ≥ 70 · needs attention 40–69 · at risk < 40. Recomputed by the workers every 6 hours and on demand
 * (Super Admin › Customer health › Recalculate). A network that falls to "at risk" from a better state gets a
 * check-in task for its account manager — once per fall. Usage comes from usage_records (the hourly meter).
 */
import { query, withTransaction } from '../db/pool.js';

export type HealthStatus = 'healthy' | 'attention' | 'at_risk';
export const WEIGHTS = { usage: 30, trend: 15, engagement: 20, billing: 20, onboarding: 15 } as const;
type Component = keyof typeof WEIGHTS;

export const MILESTONES = [
  { key: 'owner_signed_in', label: 'Owner signed in' },
  { key: 'tracking_domain', label: 'Tracking domain live' },
  { key: 'first_offer', label: 'First offer created' },
  { key: 'first_advertiser', label: 'First advertiser added' },
  { key: 'first_partner', label: 'First partner added' },
  { key: 'first_click', label: 'First click tracked' },
  { key: 'first_conversion', label: 'First conversion' },
  { key: 'partner_postback', label: 'Partner postback set up' },
  { key: 'team_invited', label: 'Team invited' },
  { key: 'plan', label: 'On a plan' },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]['key'];

/** clicks7d / clicksPrev7d: the last 7 complete days and the 7 before (the trend compares whole days);
 *  clicksToday, clicks30d and conversions7d count today so far too. */
export interface Signals {
  clicks7d: number; clicksPrev7d: number; clicksToday: number; clicks30d: number; conversions7d: number;
  lastLoginAt: string | null; activeUsers14d: number;
  subscriptionStatus: string | null; cancelAtPeriodEnd: boolean; overdueInvoices: number; suspendedForBilling: boolean;
  offers: number; partners: number;
}

export const statusOf = (score: number): HealthStatus => (score >= 70 ? 'healthy' : score >= 40 ? 'attention' : 'at_risk');

const DAY = 86_400_000;

/** Each part 0–100 from the signals (pure — unit tested). */
export function scoreParts(s: Signals, onboardingPct: number, now: number = Date.now()): Record<Component, number> {
  const recent = s.clicks7d + s.clicksToday;
  const usage = recent > 0 && s.conversions7d > 0 ? 100 : recent > 0 ? 60 : s.clicks30d > 0 ? 25 : 0;
  let trend: number;
  if (s.clicksPrev7d === 0) trend = recent > 0 ? 100 : 0;
  else {
    const r = s.clicks7d / s.clicksPrev7d;
    trend = r >= 1 ? 100 : r >= 0.8 ? 75 : r >= 0.5 ? 45 : 15;
  }
  const age = s.lastLoginAt ? (now - new Date(s.lastLoginAt).getTime()) / DAY : Infinity;
  const engagement = age <= 3 ? 100 : age <= 7 ? 80 : age <= 14 ? 55 : age <= 30 ? 25 : 0;
  const billing = s.suspendedForBilling ? 0
    : s.overdueInvoices > 0 || s.subscriptionStatus === 'past_due' ? 30
    : s.subscriptionStatus === 'canceled' ? 20
    : s.cancelAtPeriodEnd ? 40
    : s.subscriptionStatus === 'trialing' ? 80
    : s.subscriptionStatus === 'active' ? 100
    : 60; // no plan yet
  return { usage, trend, engagement, billing, onboarding: onboardingPct };
}

export function scoreOf(parts: Record<Component, number>): number {
  const total = (Object.keys(WEIGHTS) as Component[]).reduce((n, k) => n + parts[k] * WEIGHTS[k], 0);
  return Math.round(total / 100);
}

interface Row {
  id: string; name: string; status: string; suspended_reason: string | null; account_manager_id: string | null;
  c7: number; c_prev7: number; c_today: number; c30: number; v7: number; first_click: string | null; first_conversion: string | null;
  last_login: Date | null; first_login: Date | null; active_users: number;
  sub_status: string | null; cancel_at_period_end: boolean | null; sub_created: Date | null; overdue_invoices: number;
  first_offer: Date | null; offers: number; first_partner: Date | null; partners: number; first_advertiser: Date | null;
  first_domain: Date | null; users: number; second_user: Date | null; first_postback: Date | null; prev_status: HealthStatus | null;
}

const iso = (d: Date | string | null): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Recompute (and store) the health of every non-deleted network, or of `ids`. */
export async function computeHealth(ids: string[] | null = null, now: Date = new Date()): Promise<{ computed: number; atRisk: number; tasksCreated: number }> {
  const { rows } = await query<Row>(
    `SELECT n.id, n.name, n.status, n.suspended_reason, n.account_manager_id,
            COALESCE(u.c7, 0)::float8 AS c7, COALESCE(u.c_prev7, 0)::float8 AS c_prev7, COALESCE(u.c_today, 0)::float8 AS c_today,
            COALESCE(u.c30, 0)::float8 AS c30, COALESCE(u.v7, 0)::float8 AS v7,
            u.first_click::text AS first_click, u.first_conversion::text AS first_conversion,
            ll.last_login, fl.first_login, COALESCE(au.active_users, 0) AS active_users,
            s.status AS sub_status, s.cancel_at_period_end, s.created_at AS sub_created,
            (SELECT COUNT(*) FROM platform_invoices i WHERE i.network_id = n.id AND i.status = 'open' AND i.due_at < $2)::int AS overdue_invoices,
            o.first_offer, COALESCE(o.offers, 0) AS offers, p.first_partner, COALESCE(p.partners, 0) AS partners, a.first_advertiser,
            td.first_domain, COALESCE(us.users, 0) AS users, us.second_user, pb.first_postback, na.health_status AS prev_status
       FROM networks n
       LEFT JOIN LATERAL (
         SELECT SUM(value) FILTER (WHERE metric = 'clicks' AND period_date BETWEEN ($2::timestamptz)::date - 7 AND ($2::timestamptz)::date - 1) AS c7,
                SUM(value) FILTER (WHERE metric = 'clicks' AND period_date BETWEEN ($2::timestamptz)::date - 14 AND ($2::timestamptz)::date - 8) AS c_prev7,
                SUM(value) FILTER (WHERE metric = 'clicks' AND period_date = ($2::timestamptz)::date) AS c_today,
                SUM(value) FILTER (WHERE metric = 'clicks' AND period_date > ($2::timestamptz)::date - 30) AS c30,
                SUM(value) FILTER (WHERE metric = 'conversions' AND period_date > ($2::timestamptz)::date - 7) AS v7,
                MIN(period_date) FILTER (WHERE metric = 'clicks' AND value > 0) AS first_click,
                MIN(period_date) FILTER (WHERE metric = 'conversions' AND value > 0) AS first_conversion
           FROM usage_records WHERE network_id = n.id) u ON true
       LEFT JOIN LATERAL (SELECT created_at AS last_login FROM login_events WHERE network_id = n.id ORDER BY created_at DESC LIMIT 1) ll ON true
       LEFT JOIN LATERAL (SELECT created_at AS first_login FROM login_events WHERE network_id = n.id ORDER BY created_at ASC LIMIT 1) fl ON true
       LEFT JOIN LATERAL (SELECT COUNT(DISTINCT COALESCE(user_id::text, employee_email))::int AS active_users FROM login_events
                           WHERE network_id = n.id AND created_at >= $2::timestamptz - interval '14 days') au ON true
       LEFT JOIN subscriptions s ON s.network_id = n.id
       LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_offer, COUNT(*)::int AS offers FROM offers WHERE network_id = n.id) o ON true
       LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_partner, COUNT(*)::int AS partners FROM publishers WHERE network_id = n.id) p ON true
       LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_advertiser FROM advertisers WHERE network_id = n.id) a ON true
       LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_domain FROM tracking_domains WHERE network_id = n.id AND status = 'active') td ON true
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS users,
                                 (SELECT created_at FROM users x WHERE x.network_id = n.id ORDER BY created_at OFFSET 1 LIMIT 1) AS second_user
                            FROM users WHERE network_id = n.id) us ON true
       LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_postback FROM publisher_postbacks WHERE network_id = n.id) pb ON true
       LEFT JOIN network_accounts na ON na.network_id = n.id
      WHERE n.status <> 'deleted' AND ($1::uuid[] IS NULL OR n.id = ANY($1::uuid[]))`,
    [ids, now]);

  const out = rows.map((r) => {
    const milestones: Record<MilestoneKey, string | null | false> = {
      owner_signed_in: iso(r.first_login) ?? false,
      tracking_domain: iso(r.first_domain) ?? false,
      first_offer: iso(r.first_offer) ?? false,
      first_advertiser: iso(r.first_advertiser) ?? false,
      first_partner: iso(r.first_partner) ?? false,
      first_click: r.first_click ? iso(r.first_click) : false,
      first_conversion: r.first_conversion ? iso(r.first_conversion) : false,
      partner_postback: iso(r.first_postback) ?? false,
      team_invited: r.users >= 2 ? iso(r.second_user) : false,
      plan: r.sub_status && r.sub_status !== 'canceled' ? iso(r.sub_created) : false,
    };
    const onboarding = MILESTONES.map((m) => ({ key: m.key, label: m.label, done: milestones[m.key] !== false, at: milestones[m.key] || null }));
    const onboardingPct = Math.round((onboarding.filter((m) => m.done).length / MILESTONES.length) * 100);
    const signals: Signals = {
      clicks7d: Number(r.c7), clicksPrev7d: Number(r.c_prev7), clicksToday: Number(r.c_today), clicks30d: Number(r.c30), conversions7d: Number(r.v7),
      lastLoginAt: iso(r.last_login), activeUsers14d: r.active_users,
      subscriptionStatus: r.sub_status, cancelAtPeriodEnd: !!r.cancel_at_period_end, overdueInvoices: r.overdue_invoices,
      suspendedForBilling: r.status === 'suspended' && r.suspended_reason === 'billing', offers: r.offers, partners: r.partners,
    };
    const parts = scoreParts(signals, onboardingPct, now.getTime());
    const score = scoreOf(parts);
    return { r, signals, parts, score, status: statusOf(score), onboarding, onboardingPct };
  });

  let tasksCreated = 0;
  // One transaction per batch keeps a long recomputation from holding a connection for long.
  for (let i = 0; i < out.length; i += 200) {
    const batch = out.slice(i, i + 200);
    await withTransaction(async (c) => {
      await c.query(
        `INSERT INTO network_accounts (network_id, health_score, health_status, health_components, health_signals, onboarding, onboarding_pct, health_computed_at)
         SELECT * FROM unnest($1::uuid[], $2::int[], $3::text[], $4::jsonb[], $5::jsonb[], $6::jsonb[], $7::int[], $8::timestamptz[])
         ON CONFLICT (network_id) DO UPDATE SET health_score = EXCLUDED.health_score, health_status = EXCLUDED.health_status,
           health_components = EXCLUDED.health_components, health_signals = EXCLUDED.health_signals, onboarding = EXCLUDED.onboarding,
           onboarding_pct = EXCLUDED.onboarding_pct, health_computed_at = EXCLUDED.health_computed_at`,
        [batch.map((x) => x.r.id), batch.map((x) => x.score), batch.map((x) => x.status), batch.map((x) => JSON.stringify(x.parts)),
          batch.map((x) => JSON.stringify(x.signals)), batch.map((x) => JSON.stringify(x.onboarding)), batch.map((x) => x.onboardingPct), batch.map(() => now)]);
      await c.query(
        `INSERT INTO network_health_history (network_id, day, score, status)
         SELECT id, ($4::timestamptz)::date, score, status FROM unnest($1::uuid[], $2::int[], $3::text[]) AS t(id, score, status)
         ON CONFLICT (network_id, day) DO UPDATE SET score = EXCLUDED.score, status = EXCLUDED.status`,
        [batch.map((x) => x.r.id), batch.map((x) => x.score), batch.map((x) => x.status), now]);
      // Fell to "at risk": a check-in for the account manager (not on a network's first computation).
      for (const x of batch) {
        if (x.status !== 'at_risk' || !x.r.prev_status || x.r.prev_status === 'at_risk' || !x.r.account_manager_id) continue;
        await c.query(
          `INSERT INTO platform_tasks (title, notes, kind, priority, due_at, assignee_id, network_id)
           VALUES ($1, $2, 'success', 'high', $3::timestamptz + interval '1 day', $4, $5)`,
          [`Check in: ${x.r.name} — health fell to ${x.score}`,
            `Usage ${x.parts.usage}, trend ${x.parts.trend}, sign-ins ${x.parts.engagement}, billing ${x.parts.billing}, onboarding ${x.parts.onboarding}.`,
            now, x.r.account_manager_id, x.r.id]);
        tasksCreated++;
      }
    });
  }
  return { computed: out.length, atRisk: out.filter((x) => x.status === 'at_risk').length, tasksCreated };
}

/** Keep the history bounded (a year). */
export async function pruneHealthHistory(days = 400): Promise<number> {
  return (await query(`DELETE FROM network_health_history WHERE day < CURRENT_DATE - $1::int`, [days])).rowCount;
}
