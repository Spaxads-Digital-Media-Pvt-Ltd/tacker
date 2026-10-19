/**
 * Invoice rules shared by partner and advertiser invoices.
 *
 * O8 — invoices are financial records: a PAID invoice is final (never deleted or voided — the DB
 * enforces it too, migration 076), and an UNPAID one is VOIDED, not deleted: it keeps its number,
 * amounts and history, records who voided it, when and why, and frees its period for a corrected
 * invoice. 'deleted' only exists on rows soft-deleted before this.
 *
 * O4 — one invoice per currency: an invoice bills the account's activity in ONE currency. Asked for
 * → that currency; otherwise the only currency with activity in the period; none → the account's
 * default; several → 422 listing them (create one per currency). Nothing is ever converted.
 */
import { z } from 'zod';
import { query } from '../db/pool.js';
import { AppError, conflict, validationFailed } from '../http/errors.js';
import { CURRENCY_RE } from '../money.js';

/** SQL predicate for invoices that still count — in totals, and as holding their period. */
export const liveInvoice = (alias = ''): string => `${alias ? `${alias}.` : ''}status NOT IN ('deleted', 'void')`;

export const voidSchema = z.object({
  reason: z.string().trim().min(3, 'Say why the invoice is voided (at least 3 characters).').max(500),
});

export const invoiceCurrency = z.string().regex(CURRENCY_RE, 'currency must be a 3-letter upper-case code (e.g. USD)');

/** DELETE is always refused (O8): a paid invoice is final; an unpaid one is voided instead. */
export function deleteRefusal(status: string): AppError {
  if (status === 'paid') return conflict("A paid invoice is a financial record — it can't be deleted or voided.");
  if (status === 'void' || status === 'deleted') return conflict('This invoice is already void.');
  return new AppError('conflict', 'Invoices are not deleted — void it instead: it keeps its number and history, and its period is free for a corrected invoice.', { reason: 'use_void' });
}

/** Only unpaid invoices can be voided, edited or paid; null = allowed. */
export function notUnpaidRefusal(status: string, action: 'void' | 'edit' | 'pay'): AppError | null {
  if (status === 'unpaid') return null;
  if (status === 'paid') {
    return conflict(action === 'void'
      ? "A paid invoice is a financial record — it can't be voided. Record a correction as an adjustment instead."
      : action === 'pay' ? 'This invoice is already paid.' : "A paid invoice can't be changed.");
  }
  return conflict(action === 'pay' ? "A void invoice can't be paid." : action === 'edit' ? "A void invoice can't be changed." : 'This invoice is already void.');
}

/**
 * What an invoice would bill, per currency, for an account over a period (whole days, inclusive):
 * partners — what they earned (credits − debits, excluding payout settlements); advertisers — what
 * they were billed (debits − credits, excluding receipts). Rounded to cents like invoice amounts.
 */
export async function activityByCurrency(
  networkId: string, accountType: 'publisher' | 'advertiser', accountId: string, periodStart: string, periodEnd: string,
): Promise<{ currency: string; amount: string }[]> {
  const [owed, settlement] = accountType === 'publisher' ? ['credit', 'payout'] : ['debit', 'receipt'];
  const { rows } = await query<{ currency: string; amount: string }>(
    `SELECT currency, ROUND(SUM(CASE WHEN direction = $6 THEN amount ELSE -amount END), 2)::text AS amount
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = $2 AND account_id = $3 AND status = 'approved'
        AND entry_type <> $7
        AND created_at >= $4::date AND created_at < ($5::date + interval '1 day')
      GROUP BY currency
     HAVING SUM(CASE WHEN direction = $6 THEN amount ELSE -amount END) <> 0
      ORDER BY currency`,
    [networkId, accountType, accountId, periodStart, periodEnd, owed, settlement],
  );
  return rows.filter((r) => CURRENCY_RE.test(r.currency));
}

/** The invoice's currency (see the header). `label` names the account in the 422. */
export function resolveInvoiceCurrency(
  requested: string | undefined, activity: { currency: string }[], fallback: string, label: string,
): string {
  if (requested) return requested;
  const present = activity.map((a) => a.currency);
  if (present.length === 1) return present[0]!;
  if (present.length === 0) return fallback;
  throw validationFailed(
    `This ${label} has activity in several currencies in this period (${present.join(', ')}). Create one invoice per currency — choose the currency.`,
    { currencies: present },
  );
}
