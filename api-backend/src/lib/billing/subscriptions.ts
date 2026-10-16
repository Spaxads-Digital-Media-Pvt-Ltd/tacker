/**
 * A network's subscription (Super Admin › Networks › Plan): one row per network (subscriptions).
 *
 * - Assign a plan to a network without a live subscription: a free trial when the plan has one (or the
 *   Super Admin gives one) — `trialing` until trial_ends_at, no invoice — else `active` for one billing
 *   period from now, invoiced at once (a free plan isn't invoiced).
 * - Change a live subscription's plan: it switches now; the next period is billed at the new price (no
 *   proration).
 * - Cancel at the period end (it then ends instead of renewing) or now; resume a pending cancel; extend
 *   a trial. Renewals, trial ends, overdue flags and suspensions are the billing run's (engine.ts).
 */
import { pool } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { billingSettings } from './settings.js';
import { centsToDecimal, issueInvoice, type PlatformInvoice } from './invoices.js';

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_interval: 'month' | 'year';
  trial_days: number;
  status: 'active' | 'archived';
}

export interface SubscriptionRow {
  id: string;
  network_id: string;
  plan_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trial_ends_at: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  renews_at: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
}

const LIVE = ['trialing', 'active', 'past_due'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** "Growth plan · 2026-10-16 – 2026-11-16" — what an invoice for one period says. */
export const periodDescription = (planName: string, start: Date, end: Date): string => `${planName} plan · ${ymd(start)} – ${ymd(end)}`;

/** SQL for `$start + one billing interval` (Postgres keeps month ends: 31 Jan + 1 month = 28/29 Feb). */
export const PLUS_INTERVAL = (start: string, interval: string) =>
  `(${start}::timestamptz + CASE ${interval} WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END)`;

export async function assignPlan(
  networkId: string, planId: string, opts: { trialDays?: number | null }, createdBy: string,
): Promise<{ before: SubscriptionRow | null; subscription: SubscriptionRow; invoice: PlatformInvoice | null; changed: boolean }> {
  const settings = await billingSettings();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = (await client.query<PlanRow>('SELECT * FROM subscription_plans WHERE id = $1', [planId])).rows[0];
    if (!plan) throw badRequest('That plan does not exist.');
    if (plan.status !== 'active') throw badRequest(`The plan "${plan.name}" is archived — unarchive it, or choose another.`);
    const net = (await client.query<{ status: string }>('SELECT status FROM networks WHERE id = $1 FOR UPDATE', [networkId])).rows[0];
    if (!net) throw notFound('Network not found');
    if (net.status === 'deleted') throw conflict('This network is deleted — restore it first.');
    const before = (await client.query<SubscriptionRow>('SELECT * FROM subscriptions WHERE network_id = $1 FOR UPDATE', [networkId])).rows[0] ?? null;

    if (before && LIVE.includes(before.status) && before.current_period_end) {
      // A plan change: now, and billed at the new price from the next period (no proration).
      const subscription = (await client.query<SubscriptionRow>(
        `UPDATE subscriptions SET plan_id = $2, cancel_at_period_end = false WHERE network_id = $1 RETURNING *`, [networkId, planId])).rows[0]!;
      await client.query('COMMIT');
      return { before, subscription, invoice: null, changed: true };
    }

    const now = new Date();
    const trialDays = opts.trialDays ?? plan.trial_days;
    const trial = trialDays > 0;
    const subscription = (await client.query<SubscriptionRow>(
      `INSERT INTO subscriptions (network_id, plan_id, status, trial_ends_at, current_period_start, current_period_end, renews_at,
                                  cancel_at_period_end, canceled_at)
       SELECT $1, $2, $3::text, e.trial_end, $4::timestamptz, e.period_end, e.period_end, false, NULL
         FROM (SELECT CASE WHEN $3::text = 'trialing' THEN $4::timestamptz + make_interval(days => $5) END AS trial_end,
                      CASE WHEN $3::text = 'trialing' THEN $4::timestamptz + make_interval(days => $5) ELSE ${PLUS_INTERVAL('$4', '$6')} END AS period_end) e
       ON CONFLICT (network_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, trial_ends_at = EXCLUDED.trial_ends_at,
         current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
         renews_at = EXCLUDED.renews_at, cancel_at_period_end = false, canceled_at = NULL
       RETURNING *`,
      [networkId, planId, trial ? 'trialing' : 'active', now, trialDays, plan.billing_interval])).rows[0]!;

    let invoice: PlatformInvoice | null = null;
    if (!trial && plan.price_cents > 0) {
      invoice = await issueInvoice(client, {
        networkId, subscriptionId: subscription.id, planId: plan.id,
        description: periodDescription(plan.name, subscription.current_period_start!, subscription.current_period_end!),
        currency: plan.currency, subtotal: centsToDecimal(plan.price_cents),
        periodStart: subscription.current_period_start, periodEnd: subscription.current_period_end, createdBy, issuedAt: now,
      }, settings);
    }
    await client.query('COMMIT');
    return { before, subscription, invoice, changed: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function liveSubscription(networkId: string): Promise<SubscriptionRow> {
  const { rows } = await pool.query<SubscriptionRow>('SELECT * FROM subscriptions WHERE network_id = $1', [networkId]);
  const s = rows[0];
  if (!s) throw notFound('This network has no subscription.');
  if (!LIVE.includes(s.status)) throw conflict('This subscription is canceled — assign a plan to start a new one.');
  return s;
}

/** Cancel: at the period end (it ends instead of renewing), or now. Open invoices stay (void them if waived). */
export async function cancelSubscription(networkId: string, atPeriodEnd: boolean): Promise<{ before: SubscriptionRow; after: SubscriptionRow }> {
  const before = await liveSubscription(networkId);
  const { rows } = await pool.query<SubscriptionRow>(
    atPeriodEnd
      ? `UPDATE subscriptions SET cancel_at_period_end = true WHERE network_id = $1 RETURNING *`
      : `UPDATE subscriptions SET status = 'canceled', canceled_at = now(), cancel_at_period_end = false WHERE network_id = $1 RETURNING *`,
    [networkId]);
  return { before, after: rows[0]! };
}

/** Undo a pending cancel-at-period-end. */
export async function resumeSubscription(networkId: string): Promise<{ before: SubscriptionRow; after: SubscriptionRow }> {
  const before = await liveSubscription(networkId);
  if (!before.cancel_at_period_end) throw conflict('This subscription is not set to cancel.');
  const { rows } = await pool.query<SubscriptionRow>(
    `UPDATE subscriptions SET cancel_at_period_end = false WHERE network_id = $1 RETURNING *`, [networkId]);
  return { before, after: rows[0]! };
}

/** More trial days: the trial (and the period it is) ends later. */
export async function extendTrial(networkId: string, days: number): Promise<{ before: SubscriptionRow; after: SubscriptionRow }> {
  const before = await liveSubscription(networkId);
  if (before.status !== 'trialing' || !before.trial_ends_at) throw conflict('This subscription is not in a trial.');
  const { rows } = await pool.query<SubscriptionRow>(
    `UPDATE subscriptions SET trial_ends_at = trial_ends_at + make_interval(days => $2),
            current_period_end = trial_ends_at + make_interval(days => $2), renews_at = trial_ends_at + make_interval(days => $2)
      WHERE network_id = $1 RETURNING *`, [networkId, days]);
  return { before, after: rows[0]! };
}
