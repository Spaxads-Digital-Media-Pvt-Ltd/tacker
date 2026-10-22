/**
 * The billing run (workers, every 15 minutes; also Super Admin › Billing › "Run billing now"):
 *
 * 1. A trial that has ended becomes `active`: its first paid period starts at the trial end — invoiced.
 * 2. A period that has ended renews into the next one — invoiced — or, set to cancel at the period end,
 *    the subscription ends (`canceled`). Missed periods are caught up one by one (each invoiced).
 * 3. An open invoice past its due date flags its network's subscription `past_due`.
 * 4. An open invoice past its suspension date suspends its network (suspended_reason 'billing') — once
 *    per deadline (suspension_applied_at), so a Super Admin who reactivates the network by hand isn't
 *    overruled; pushing the deadline (or paying) re-arms / lifts it. Skipped when autoSuspend is off.
 *
 * Each subscription advances in its own transaction under a row lock (SKIP LOCKED), and an invoice is
 * unique per subscription period, so concurrent runs never bill twice — no session-level locks (the app
 * stays safe on a transaction pooler). Soft-deleted networks aren't billed. Every change is audited as
 * the system.
 */
import { pool, query } from '../db/pool.js';
import { writeSystemAudit } from '../audit.js';
import { networkStateChanged } from '../networks/state.js';
import { billingSettings, type BillingSettings } from './settings.js';
import { issueInvoice } from './invoices.js';
import { subscriptionLines, useDiscount } from './charges.js';
import { effectivePlan, networkOverrides } from './overrides.js';
import { notifyInvoiceIssued, notifyInvoiceOverdue, notifyNetworkSuspended } from '../platform/notify.js';
import { PLUS_INTERVAL, periodDescription, type PlanRow, type SubscriptionRow } from './subscriptions.js';

export interface BillingRunResult {
  trialsEnded: number;
  renewed: number;
  canceled: number;
  invoicesIssued: number;
  pastDue: number;
  suspended: number;
}

/** Most periods one subscription is caught up by in one run (a run every 15 minutes finishes the rest). */
const MAX_CATCH_UP = 24;

type Step = { kind: 'trial_ended' | 'renewed' | 'canceled'; invoiced: boolean; invoiceId?: string | null };

/** Advance one subscription by one step, if it is still due — in its own transaction. */
async function advance(subscriptionId: string, now: Date, settings: BillingSettings): Promise<Step | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<SubscriptionRow & { plan: PlanRow; network_status: string }>(
      `SELECT s.*, row_to_json(p) AS plan, n.status AS network_status
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id JOIN networks n ON n.id = s.network_id
        WHERE s.id = $1 FOR UPDATE OF s SKIP LOCKED`, [subscriptionId])).rows[0];
    if (!row || row.network_status === 'deleted') { await client.query('ROLLBACK'); return null; }
    // The plan as this network pays for it (a custom price, billing exempt, limit overrides).
    const plan = effectivePlan(row.plan, await networkOverrides(row.network_id, client));
    const trialOver = row.status === 'trialing' && row.trial_ends_at !== null && new Date(row.trial_ends_at) <= now;
    const periodOver = (row.status === 'active' || row.status === 'past_due') && row.current_period_end !== null && new Date(row.current_period_end) <= now;
    if (!trialOver && !periodOver) { await client.query('ROLLBACK'); return null; }

    let step: Step;
    if (periodOver && row.cancel_at_period_end) {
      await client.query(
        `UPDATE subscriptions SET status = 'canceled', canceled_at = current_period_end, cancel_at_period_end = false WHERE id = $1`, [row.id]);
      step = { kind: 'canceled', invoiced: false };
    } else {
      // The next period: from the trial end, or from the end of the one that just ended.
      const from = trialOver ? 'trial_ends_at' : 'current_period_end';
      const next = (await client.query<SubscriptionRow>(
        `UPDATE subscriptions SET status = CASE WHEN status = 'trialing' THEN 'active' ELSE status END,
                current_period_start = ${from}, current_period_end = ${PLUS_INTERVAL(from, '$2::text')}, renews_at = ${PLUS_INTERVAL(from, '$2::text')}
          WHERE id = $1 RETURNING *`, [row.id, plan.billing_interval])).rows[0]!;
      let invoiced = false;
      let invoiceId: string | null = null;
      if (plan.billable) {
        // The next period in advance; overage for the period that just ended (not after a trial).
        const period = { start: new Date(next.current_period_start!), end: new Date(next.current_period_end!) };
        const usagePeriod = trialOver || !row.current_period_start || !row.current_period_end
          ? null : { start: new Date(row.current_period_start), end: new Date(row.current_period_end) };
        const { lines, subtotal, discount } = await subscriptionLines(client, row.network_id, plan, period, usagePeriod);
        const invoice = await issueInvoice(client, {
          networkId: row.network_id, subscriptionId: row.id, planId: plan.id,
          description: periodDescription(plan.name, period.start, period.end),
          currency: plan.currency, subtotal, lines,
          periodStart: next.current_period_start, periodEnd: next.current_period_end, createdBy: 'system', issuedAt: now,
        }, settings);
        invoiced = invoice !== null;
        invoiceId = invoice?.id ?? null;
        if (invoice && discount) await useDiscount(client, discount);
      }
      step = { kind: trialOver ? 'trial_ended' : 'renewed', invoiced, invoiceId };
    }
    await writeSystemAudit(row.network_id, {
      action: `subscription.${step.kind}`, entityType: 'subscription', entityId: row.id,
      after: { plan: plan.code, invoiced: step.invoiced },
    }, client);
    await client.query('COMMIT');
    return step;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function runBilling(now: Date = new Date()): Promise<BillingRunResult> {
  const settings = await billingSettings();
  const r: BillingRunResult = { trialsEnded: 0, renewed: 0, canceled: 0, invoicesIssued: 0, pastDue: 0, suspended: 0 };

  // 1 + 2) Ended trials and periods, period by period.
  for (let round = 0; round < MAX_CATCH_UP; round++) {
    const due = (await query<{ id: string }>(
      `SELECT s.id FROM subscriptions s JOIN networks n ON n.id = s.network_id
        WHERE n.status <> 'deleted'
          AND ((s.status = 'trialing' AND s.trial_ends_at <= $1)
            OR (s.status IN ('active', 'past_due') AND s.current_period_end <= $1))
        ORDER BY s.id LIMIT 500`, [now])).rows;
    if (!due.length) break;
    let progressed = 0;
    for (const { id } of due) {
      const step = await advance(id, now, settings);
      if (!step) continue;
      progressed++;
      if (step.kind === 'trial_ended') r.trialsEnded++;
      else if (step.kind === 'renewed') r.renewed++;
      else r.canceled++;
      if (step.invoiced) r.invoicesIssued++;
      if (step.invoiceId) await notifyInvoiceIssued(step.invoiceId); // after its commit
    }
    if (!progressed) break; // the rest are another run's (locked) — it finishes them
  }

  // 3) Overdue → past_due.
  const pastDue = await query<{ network_id: string }>(
    `UPDATE subscriptions s SET status = 'past_due'
      WHERE s.status = 'active'
        AND EXISTS (SELECT 1 FROM platform_invoices i WHERE i.network_id = s.network_id AND i.status = 'open' AND i.due_at <= $1)
      RETURNING s.network_id`, [now]);
  for (const { network_id } of pastDue.rows) {
    await writeSystemAudit(network_id, { action: 'subscription.past_due', entityType: 'network', entityId: network_id });
    await notifyInvoiceOverdue(network_id);
  }
  r.pastDue = pastDue.rowCount ?? 0;

  // 4) Past the suspension date → suspended for billing (once per deadline).
  if (settings.autoSuspend) {
    const suspended = await query<{ id: string; numbers: string[] }>(
      `WITH due AS (
         UPDATE platform_invoices SET suspension_applied_at = $1
          WHERE status = 'open' AND suspend_at <= $1 AND suspension_applied_at IS NULL
          RETURNING network_id, number)
       UPDATE networks n SET status = 'suspended', suspended_reason = 'billing'
         FROM (SELECT network_id, array_agg(number ORDER BY number) AS numbers FROM due GROUP BY network_id) d
        WHERE n.id = d.network_id AND n.status = 'active'
        RETURNING n.id, d.numbers`, [now]);
    for (const { id, numbers } of suspended.rows) {
      await networkStateChanged(id);
      await writeSystemAudit(id, { action: 'network.suspended_billing', entityType: 'network', entityId: id, after: { invoices: numbers } });
      await notifyNetworkSuspended(id, numbers);
    }
    r.suspended = suspended.rowCount ?? 0;
  }
  return r;
}
