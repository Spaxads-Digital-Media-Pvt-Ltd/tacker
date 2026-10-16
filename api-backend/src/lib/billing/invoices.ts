/**
 * Platform invoices — the platform billing its tenant networks (Super Admin › Billing).
 *
 * An invoice is numbered from a sequence (`<prefix>-<year>-<00042>`), taxed at the platform rate, due
 * `dueDays` after it's issued and — unpaid — suspends the network `graceDays` after that (`suspend_at`,
 * which a Super Admin can push later). Amounts are computed in SQL numeric, never in floats.
 *
 * No payment gateway yet: a Super Admin records the payment ("Mark as paid") — `markInvoicePaid` is the
 * one place a gateway's webhook will call later. Paying, voiding or pushing a deadline then settles the
 * network (settleNetworkBilling): its subscription is active again once nothing is overdue, and a network
 * suspended FOR BILLING comes back once nothing is past its suspension date (a manual suspension stays).
 */
import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { networkStateChanged } from '../networks/state.js';
import type { BillingSettings } from './settings.js';
import type { InvoiceLine } from './charges.js';

type Db = Pick<PoolClient, 'query'>;

export interface PlatformInvoice {
  id: string;
  number: string;
  network_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  description: string;
  currency: string;
  subtotal: string;
  tax_rate: string;
  tax: string;
  total: string;
  period_start: Date | null;
  period_end: Date | null;
  status: 'open' | 'paid' | 'void';
  issued_at: Date;
  due_at: Date;
  suspend_at: Date;
  suspension_applied_at: Date | null;
  paid_at: Date | null;
  paid_amount: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  bill_to: { name: string; slug: string; email: string | null };
  notes: string | null;
  created_by: string | null;
  /** Open and past its due date. */
  overdue: boolean;
}

/** `i.*` plus `overdue` — every invoice answer carries both. */
export const INVOICE_SELECT = `i.*, (i.status = 'open' AND i.due_at <= now()) AS overdue`;

export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other'] as const;

/** Whole cents → decimal text ("9900" → "99.00"), without floats. */
export function centsToDecimal(cents: number): string {
  const c = Math.trunc(cents);
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

export interface IssueInvoice {
  networkId: string;
  subscriptionId?: string | null;
  planId?: string | null;
  description: string;
  currency: string;
  /** Decimal text, ≥ 0. */
  subtotal: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  /** A platform admin's id, or 'system' (the billing run). */
  createdBy: string;
  notes?: string | null;
  issuedAt?: Date;
  dueDays?: number;
  /** Its lines (plan, overage, discount…; `subtotal` must be their sum). Without: one line — the description. */
  lines?: InvoiceLine[];
}

/**
 * Issue one invoice. Idempotent per subscription period: null when that period already has a live one
 * (checked before a number is taken, so numbering has no gaps from it; the unique index backs it up).
 */
export async function issueInvoice(db: Db, inv: IssueInvoice, settings: BillingSettings): Promise<PlatformInvoice | null> {
  if (inv.subscriptionId && inv.periodStart) {
    const exists = await db.query(
      `SELECT 1 FROM platform_invoices WHERE subscription_id = $1 AND period_start = $2 AND status <> 'void' LIMIT 1`,
      [inv.subscriptionId, inv.periodStart]);
    if (exists.rows.length) return null;
  }
  const issuedAt = inv.issuedAt ?? new Date();
  const billTo = (await db.query<{ name: string; slug: string; email: string | null }>(
    `SELECT n.name, n.slug,
            (SELECT u.email FROM users u WHERE u.network_id = n.id AND u.role = 'admin' ORDER BY u.created_at LIMIT 1) AS email
       FROM networks n WHERE n.id = $1`, [inv.networkId])).rows[0];
  if (!billTo) throw notFound('Network not found');
  const seq = (await db.query<{ n: string }>(`SELECT nextval('platform_invoice_number_seq')::text AS n`)).rows[0]!.n;
  const number = `${settings.invoicePrefix}-${issuedAt.getUTCFullYear()}-${seq.padStart(5, '0')}`;
  const { rows } = await db.query<PlatformInvoice>(
    `INSERT INTO platform_invoices (number, network_id, subscription_id, plan_id, description, currency, subtotal, tax_rate, tax, total,
                                    period_start, period_end, issued_at, due_at, suspend_at, bill_to, notes, created_by)
     SELECT $1, $2, $3, $4, $5, $6, a.sub, a.rate, a.tax, a.sub + a.tax,
            $9::timestamptz, $10::timestamptz, $11::timestamptz, $11::timestamptz + make_interval(days => $12::int),
            $11::timestamptz + make_interval(days => $12::int + $13::int), $14::jsonb, $15, $16
       FROM (SELECT $7::numeric(14,2) AS sub, $8::numeric(5,2) AS rate, round($7::numeric * $8::numeric / 100, 2) AS tax) a
     ON CONFLICT (subscription_id, period_start) WHERE subscription_id IS NOT NULL AND period_start IS NOT NULL AND status <> 'void'
     DO NOTHING
     RETURNING *, (status = 'open' AND due_at <= now()) AS overdue`,
    [number, inv.networkId, inv.subscriptionId ?? null, inv.planId ?? null, inv.description, inv.currency.toUpperCase(),
     inv.subtotal, settings.taxRate, inv.periodStart ?? null, inv.periodEnd ?? null, issuedAt,
     inv.dueDays ?? settings.dueDays, settings.graceDays, JSON.stringify(billTo), inv.notes ?? null, inv.createdBy]);
  const invoice = rows[0];
  if (!invoice) return null;
  const lines: InvoiceLine[] = inv.lines?.length ? inv.lines : [{
    kind: inv.subscriptionId ? 'plan' : 'one_off', description: inv.description, quantity: '1', unitAmount: inv.subtotal, amount: inv.subtotal,
  }];
  await db.query(
    `INSERT INTO platform_invoice_lines (invoice_id, position, kind, description, quantity, unit_amount, amount, meta)
     SELECT $1, t.pos, t.kind, t.description, t.quantity, t.unit_amount, t.amount, t.meta
       FROM unnest($2::int[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::jsonb[])
            AS t(pos, kind, description, quantity, unit_amount, amount, meta)`,
    [invoice.id, lines.map((_, i) => i + 1), lines.map((l) => l.kind), lines.map((l) => l.description), lines.map((l) => l.quantity),
      lines.map((l) => l.unitAmount), lines.map((l) => l.amount), lines.map((l) => JSON.stringify(l.meta ?? {}))]);
  // Nothing to pay (fully discounted): settled at once, kept as the record.
  if (Number(invoice.total) === 0) {
    return (await db.query<PlatformInvoice>(
      `UPDATE platform_invoices SET status = 'paid', paid_at = issued_at, paid_amount = 0, payment_method = 'other', payment_reference = 'Nothing to pay'
        WHERE id = $1 RETURNING *, false AS overdue`, [invoice.id])).rows[0]!;
  }
  return invoice;
}

/** An invoice's lines, in order (amounts as text). */
export async function invoiceLines(id: string): Promise<{ kind: string; description: string; quantity: string; unit_amount: string; amount: string }[]> {
  return (await query<{ kind: string; description: string; quantity: string; unit_amount: string; amount: string }>(
    `SELECT kind, description, trim_scale(quantity)::text AS quantity, trim_scale(unit_amount)::text AS unit_amount, amount::text
       FROM platform_invoice_lines WHERE invoice_id = $1 ORDER BY position`, [id])).rows;
}

async function openInvoice(id: string): Promise<PlatformInvoice> {
  const inv = (await query<PlatformInvoice>(`SELECT ${INVOICE_SELECT} FROM platform_invoices i WHERE i.id = $1`, [id])).rows[0];
  if (!inv) throw notFound('Invoice not found');
  if (inv.status !== 'open') throw conflict(`Invoice ${inv.number} is already ${inv.status}.`);
  return inv;
}

export interface Payment {
  method: (typeof PAYMENT_METHODS)[number] | string;
  reference?: string | null;
  /** ISO date-time; default now. */
  paidAt?: string | null;
  /** Decimal text; default the invoice total. */
  amount?: string | null;
}

/** Record an invoice's payment (by hand today; a payment gateway's webhook later). */
export async function markInvoicePaid(id: string, p: Payment): Promise<{ before: PlatformInvoice; after: PlatformInvoice; settled: Settled }> {
  const before = await openInvoice(id);
  const { rows } = await query<PlatformInvoice>(
    `UPDATE platform_invoices SET status = 'paid', paid_at = COALESCE($2::timestamptz, now()), paid_amount = COALESCE($3::numeric, total),
            payment_method = $4, payment_reference = $5
      WHERE id = $1 AND status = 'open'
      RETURNING *, false AS overdue`,
    [id, p.paidAt ?? null, p.amount ?? null, p.method, p.reference ?? null]);
  if (!rows[0]) throw conflict(`Invoice ${before.number} was settled meanwhile.`);
  return { before, after: rows[0], settled: await settleNetworkBilling(before.network_id) };
}

/** Push an open invoice's suspension date later ("more time"); a billing suspension it caused is lifted. */
export async function extendInvoiceDeadline(id: string, suspendAt: Date): Promise<{ before: PlatformInvoice; after: PlatformInvoice; settled: Settled }> {
  const before = await openInvoice(id);
  if (suspendAt.getTime() <= Date.now()) throw badRequest('The new deadline must be in the future.');
  if (suspendAt.getTime() <= new Date(before.suspend_at).getTime()) {
    throw badRequest(`The new deadline must be later than the current one (${new Date(before.suspend_at).toISOString().slice(0, 10)}).`);
  }
  const { rows } = await query<PlatformInvoice>(
    `UPDATE platform_invoices SET suspend_at = $2, suspension_applied_at = NULL WHERE id = $1 AND status = 'open'
      RETURNING *, (status = 'open' AND due_at <= now()) AS overdue`, [id, suspendAt]);
  if (!rows[0]) throw conflict(`Invoice ${before.number} was settled meanwhile.`);
  return { before, after: rows[0], settled: await settleNetworkBilling(before.network_id) };
}

/** Void an open invoice (issued by mistake, waived) — it no longer counts against the network. */
export async function voidInvoice(id: string, reason: string): Promise<{ before: PlatformInvoice; after: PlatformInvoice; settled: Settled }> {
  const before = await openInvoice(id);
  const { rows } = await query<PlatformInvoice>(
    `UPDATE platform_invoices SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1 AND status = 'open'
      RETURNING *, false AS overdue`, [id, reason]);
  if (!rows[0]) throw conflict(`Invoice ${before.number} was settled meanwhile.`);
  return { before, after: rows[0], settled: await settleNetworkBilling(before.network_id) };
}

export interface Settled { subscriptionActive: boolean; networkReactivated: boolean }

/**
 * After a payment, void or pushed deadline: nothing overdue any more → a past_due subscription is active
 * again; nothing past its suspension date any more → a network suspended FOR BILLING is reactivated
 * (tracking resumes at once). A manual suspension is never lifted here.
 */
export async function settleNetworkBilling(networkId: string): Promise<Settled> {
  const overdue = (await query(
    `SELECT 1 FROM platform_invoices WHERE network_id = $1 AND status = 'open' AND due_at <= now() LIMIT 1`, [networkId])).rows.length > 0;
  const subscriptionActive = !overdue
    && ((await query(`UPDATE subscriptions SET status = 'active' WHERE network_id = $1 AND status = 'past_due'`, [networkId])).rowCount ?? 0) > 0;
  const blocking = (await query(
    `SELECT 1 FROM platform_invoices WHERE network_id = $1 AND status = 'open' AND suspend_at <= now() LIMIT 1`, [networkId])).rows.length > 0;
  let networkReactivated = false;
  if (!blocking) {
    networkReactivated = ((await query(
      `UPDATE networks SET status = 'active', suspended_reason = NULL
        WHERE id = $1 AND status = 'suspended' AND suspended_reason = 'billing'`, [networkId])).rowCount ?? 0) > 0;
    if (networkReactivated) await networkStateChanged(networkId);
  }
  return { subscriptionActive, networkReactivated };
}
