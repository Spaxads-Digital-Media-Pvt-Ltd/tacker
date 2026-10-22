/**
 * Super Admin › Sales › quotes — a priced proposal for a lead.
 *
 * Totals are worked out here in integer cents (BigInt, half-up): each line = quantity × unit price;
 * subtotal = Σ lines; discount = subtotal × discount %; tax = (subtotal − discount) × tax %; total =
 * subtotal − discount + tax. Amounts are text in and out, never floats.
 *
 * A quote is a draft until it's sent (emailed with a private link, /quote/<token>); the prospect accepts
 * (typing their name) or declines (optionally saying why) on that page, once, while it's valid
 * (valid_until, a UTC date — after it the quote reads "expired"). Staff may also mark it either way (agreed
 * on a call). Sending, accepting and declining land on the lead's timeline; a response tells the lead's owner.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { logLeadActivity } from './sales.js';

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const;
export const BILLING_INTERVALS = ['month', 'year', 'once'] as const;

const amount = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be an amount like 499 or 499.50');
const percent = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'must be a percentage like 10 or 12.5')
  .refine((v) => Number(v) <= 100, 'must be at most 100');

export const quoteLineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  unitPrice: amount,
}).strict();

export const quoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code, like USD'),
  lines: z.array(quoteLineSchema).min(1, 'add at least one line').max(50),
  discountPct: percent.default('0'),
  taxRate: percent.default('0'),
  billingInterval: z.enum(BILLING_INTERVALS).default('month'),
  validUntil: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, like 2026-11-30').refine((v) => !Number.isNaN(Date.parse(v)), 'must be a real date'),
  notes: z.string().trim().max(5000).transform((v) => v || null).nullable().optional(),
  terms: z.string().trim().max(5000).transform((v) => v || null).nullable().optional(),
}).strict();
export type QuoteInput = z.infer<typeof quoteSchema>;

const cents = (text: string): bigint => {
  const [whole, frac = ''] = text.trim().split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
};
/** "12.5" % → 1250 basis points. */
const basisPoints = (pct: string): bigint => cents(pct);
/** a × bp / 10000, rounded half-up (non-negative). */
const ofBp = (a: bigint, bp: bigint): bigint => (a * bp + 5000n) / 10000n;
export const centsText = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

export interface QuoteLine { description: string; quantity: number; unitPrice: string; amount: string }
export interface QuoteTotals { lines: QuoteLine[]; subtotal: string; discount: string; tax: string; total: string }

export function quoteTotals(q: Pick<QuoteInput, 'lines' | 'discountPct' | 'taxRate'>): QuoteTotals {
  const lines = q.lines.map((l) => {
    const unit = cents(l.unitPrice);
    return { description: l.description, quantity: l.quantity, unitPrice: centsText(unit), amount: centsText(unit * BigInt(l.quantity)) };
  });
  const subtotal = q.lines.reduce((s, l) => s + cents(l.unitPrice) * BigInt(l.quantity), 0n);
  const discount = ofBp(subtotal, basisPoints(q.discountPct));
  const tax = ofBp(subtotal - discount, basisPoints(q.taxRate));
  return { lines, subtotal: centsText(subtotal), discount: centsText(discount), tax: centsText(tax), total: centsText(subtotal - discount + tax) };
}

export const newQuoteToken = (): string => randomBytes(24).toString('base64url');

export interface QuoteRow {
  id: string; number: string; lead_id: string; title: string; currency: string; lines: QuoteLine[];
  subtotal: string; discount_pct: string; discount: string; tax_rate: string; tax: string; total: string;
  billing_interval: string; notes: string | null; terms: string | null; valid_until: string; status: string; public_token: string;
  sent_at: string | null; sent_to: string | null; viewed_at: string | null; responded_at: string | null; responder_name: string | null;
  decline_reason: string | null; created_by: string | null; created_at: string; updated_at: string; expired: boolean;
}

/** Columns for a QuoteRow from alias `q` — money as text, the date as YYYY-MM-DD, `expired` worked out in UTC. */
export const QUOTE_COLS = `q.id, q.number::text AS number, q.lead_id, q.title, q.currency, q.lines, q.subtotal::text AS subtotal,
  q.discount_pct::text AS discount_pct, q.discount::text AS discount, q.tax_rate::text AS tax_rate, q.tax::text AS tax, q.total::text AS total,
  q.billing_interval, q.notes, q.terms, to_char(q.valid_until, 'YYYY-MM-DD') AS valid_until, q.status, q.public_token, q.sent_at, q.sent_to,
  q.viewed_at, q.responded_at, q.responder_name, q.decline_reason, q.created_by, q.created_at, q.updated_at,
  (q.status = 'sent' AND q.valid_until < (now() AT TIME ZONE 'UTC')::date) AS expired`;

/** What the prospect sees on /quote/<token> — no internal ids, no token. Marks it viewed (first time, once sent). */
export async function publicQuote(token: string): Promise<Record<string, unknown> | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { rows } = await query<QuoteRow & { company: string; contact_name: string | null; owner_name: string | null; owner_email: string | null }>(
    `SELECT ${QUOTE_COLS}, l.company, l.contact_name, COALESCE(o.name, o.email) AS owner_name, o.email AS owner_email
       FROM sales_quotes q JOIN sales_leads l ON l.id = q.lead_id LEFT JOIN platform_admins o ON o.id = l.owner_id
      WHERE q.public_token = $1 AND q.status <> 'draft'`, [token]);
  const q = rows[0];
  if (!q) return null;
  if (!q.viewed_at) await query('UPDATE sales_quotes SET viewed_at = now() WHERE id = $1 AND viewed_at IS NULL', [q.id]);
  return {
    number: q.number, title: q.title, company: q.company, contactName: q.contact_name, currency: q.currency, lines: q.lines,
    subtotal: q.subtotal, discountPct: q.discount_pct, discount: q.discount, taxRate: q.tax_rate, tax: q.tax, total: q.total,
    billingInterval: q.billing_interval, notes: q.notes, terms: q.terms, validUntil: q.valid_until,
    status: q.expired ? 'expired' : q.status, sentAt: q.sent_at, respondedAt: q.responded_at, responderName: q.responder_name,
    preparedBy: q.owner_name ? { name: q.owner_name, email: q.owner_email } : null,
  };
}

/**
 * Accept or decline: only a sent quote that is still valid, once (claimed atomically). Returns the quote's id
 * and lead, or a reason it can't be answered.
 */
export async function respondToQuote(
  where: { token: string } | { id: string },
  r: { decision: 'accepted' | 'declined'; name: string | null; reason?: string | null; actorId?: string | null },
): Promise<{ ok: true; id: string; leadId: string; number: string } | { ok: false; reason: 'not_found' | 'already_answered' | 'expired' | 'not_sent' }> {
  const [col, val] = 'token' in where ? ['public_token', where.token] : ['id', where.id];
  const { rows } = await query<{ id: string; lead_id: string; number: string }>(
    `UPDATE sales_quotes SET status = $2, responded_at = now(), responder_name = $3, decline_reason = $4
      WHERE ${col} = $1 AND status = 'sent' AND valid_until >= (now() AT TIME ZONE 'UTC')::date
      RETURNING id, lead_id, number::text AS number`, [val, r.decision, r.name, r.decision === 'declined' ? r.reason ?? null : null]);
  const q = rows[0];
  if (!q) {
    const cur = (await query<{ status: string; expired: boolean }>(
      `SELECT status, valid_until < (now() AT TIME ZONE 'UTC')::date AS expired FROM sales_quotes WHERE ${col} = $1`, [val])).rows[0];
    if (!cur) return { ok: false, reason: 'not_found' };
    if (cur.status === 'draft') return { ok: false, reason: 'not_sent' };
    return { ok: false, reason: cur.status === 'sent' && cur.expired ? 'expired' : 'already_answered' };
  }
  await logLeadActivity(pool, q.lead_id, 'quote', r.decision === 'declined' && r.reason ? r.reason : null,
    { number: q.number, event: r.decision, by: r.name }, r.actorId ?? null);
  return { ok: true, id: q.id, leadId: q.lead_id, number: q.number };
}
