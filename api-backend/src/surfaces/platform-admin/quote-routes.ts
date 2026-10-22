/**
 * Super Admin › Sales › quotes (lib/platform/quotes.ts). sales:read sees, sales:full changes; a role scoped
 * 'assigned' sees the quotes of the leads it owns.
 *
 * - GET /sales/quotes?status=&leadId= — every quote (newest first), with its lead.
 * - POST /sales/leads/:id/quotes — a new draft. GET / PATCH / DELETE /sales/quotes/:id — only a draft can be
 *   changed or deleted (a sent one is on the record: duplicate it instead, POST /sales/quotes/:id/duplicate).
 * - POST /sales/quotes/:id/send { to?, message? } — emails the private link (the platform's SMTP), marks it
 *   sent; re-sending a sent one is fine while it's valid.
 * - POST /sales/quotes/:id/mark { decision, name?, reason? } — accepted / declined on the prospect's behalf.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/http/errors.js';
import { pool, query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { appUrl } from '../../lib/app-url.js';
import { escapeHtml as e } from '../../lib/email/transactional.js';
import { enqueuePlatformEmails } from '../../lib/email/outbox.js';
import { platformSmtpConfigError } from '../../lib/mailer.js';
import { layout } from '../../lib/platform/notify.js';
import { logLeadActivity } from '../../lib/platform/sales.js';
import { QUOTE_COLS, QUOTE_STATUSES, newQuoteToken, quoteSchema, quoteTotals, respondToQuote, type QuoteInput, type QuoteRow } from '../../lib/platform/quotes.js';
import { requirePerm, leadScope } from './auth.js';
import { loadLead } from './sales-routes.js';
import { UUID_RE, meId, optEmail } from './fields.js';

const INTERVAL_LABEL: Record<string, string> = { month: 'per month', year: 'per year', once: 'one-off' };

const view = (q: QuoteRow & { company?: string; owner_name?: string | null }) => ({
  ...q, status: q.expired ? 'expired' : q.status, link: q.status === 'draft' ? null : appUrl(`/quote/${q.public_token}`),
});

async function loadQuote(req: Request, id: string): Promise<QuoteRow & { company: string; lead_email: string | null; contact_name: string | null }> {
  if (!UUID_RE.test(id)) throw notFound('Quote not found');
  const sc = leadScope(req, 'l', 2);
  const row = (await query<QuoteRow & { company: string; lead_email: string | null; contact_name: string | null }>(
    `SELECT ${QUOTE_COLS}, l.company, l.email AS lead_email, l.contact_name FROM sales_quotes q JOIN sales_leads l ON l.id = q.lead_id
      WHERE q.id = $1 AND ${sc.sql}`, [id, ...sc.params])).rows[0];
  if (!row) throw notFound('Quote not found');
  return row;
}

function priced(b: QuoteInput) {
  const t = quoteTotals(b);
  return [b.title, b.currency, JSON.stringify(t.lines), t.subtotal, b.discountPct, t.discount, b.taxRate, t.tax, t.total, b.billingInterval, b.notes ?? null, b.terms ?? null, b.validUntil];
}

export function quoteRoutes(): Router {
  const r = Router();

  r.get('/sales/quotes', requirePerm('sales', 'read'), validateQuery(z.object({
    status: z.enum([...QUOTE_STATUSES, 'expired']).optional(),
    leadId: z.string().regex(UUID_RE).optional(),
  })), asyncHandler(async (req, res) => {
    const f = res.locals.query as { status?: string; leadId?: string };
    const sc = leadScope(req, 'l', 1);
    const params = [...sc.params];
    const where = [sc.sql];
    if (f.leadId) { params.push(f.leadId); where.push(`q.lead_id = $${params.length}`); }
    if (f.status === 'expired') where.push(`q.status = 'sent' AND q.valid_until < (now() AT TIME ZONE 'UTC')::date`);
    else if (f.status === 'sent') where.push(`q.status = 'sent' AND q.valid_until >= (now() AT TIME ZONE 'UTC')::date`);
    else if (f.status) { params.push(f.status); where.push(`q.status = $${params.length}`); }
    const { rows } = await query<QuoteRow & { company: string; owner_name: string | null }>(
      `SELECT ${QUOTE_COLS}, l.company, COALESCE(o.name, o.email) AS owner_name
         FROM sales_quotes q JOIN sales_leads l ON l.id = q.lead_id LEFT JOIN platform_admins o ON o.id = l.owner_id
        WHERE ${where.join(' AND ')} ORDER BY q.created_at DESC LIMIT 500`, params);
    sendOk(res, rows.map(view));
  }));

  r.post('/sales/leads/:id/quotes', requirePerm('sales', 'full'), validateBody(quoteSchema), asyncHandler(async (req, res) => {
    const lead = await loadLead(req, req.params.id!);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO sales_quotes (title, currency, lines, subtotal, discount_pct, discount, tax_rate, tax, total, billing_interval, notes, terms, valid_until,
                                 lead_id, public_token, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [...priced(req.body as QuoteInput), lead.id, newQuoteToken(), meId(req)]);
    const q = await loadQuote(req, rows[0]!.id);
    await writePlatformAudit(req, null, { action: 'quote.create', entityType: 'sales_quote', entityId: q.id, after: { number: q.number, lead: lead.company, total: q.total, currency: q.currency } });
    sendOk(res, view(q), undefined, 201);
  }));

  r.get('/sales/quotes/:id', requirePerm('sales', 'read'), asyncHandler(async (req, res) => {
    sendOk(res, view(await loadQuote(req, req.params.id!)));
  }));

  r.patch('/sales/quotes/:id', requirePerm('sales', 'full'), validateBody(quoteSchema), asyncHandler(async (req, res) => {
    const q = await loadQuote(req, req.params.id!);
    const { rowCount } = await query(
      `UPDATE sales_quotes SET title = $1, currency = $2, lines = $3, subtotal = $4, discount_pct = $5, discount = $6, tax_rate = $7, tax = $8, total = $9,
              billing_interval = $10, notes = $11, terms = $12, valid_until = $13 WHERE id = $14 AND status = 'draft'`,
      [...priced(req.body as QuoteInput), q.id]);
    if (!rowCount) throw conflict('Only a draft can be changed — duplicate a sent quote to change it.');
    sendOk(res, view(await loadQuote(req, q.id)));
  }));

  r.delete('/sales/quotes/:id', requirePerm('sales', 'full'), asyncHandler(async (req, res) => {
    const q = await loadQuote(req, req.params.id!);
    const { rowCount } = await query(`DELETE FROM sales_quotes WHERE id = $1 AND status = 'draft'`, [q.id]);
    if (!rowCount) throw conflict('Only a draft can be deleted — a sent quote stays on the record.');
    await writePlatformAudit(req, null, { action: 'quote.delete', entityType: 'sales_quote', entityId: q.id, before: { number: q.number } });
    sendOk(res, { deleted: true });
  }));

  r.post('/sales/quotes/:id/duplicate', requirePerm('sales', 'full'), asyncHandler(async (req, res) => {
    const q = await loadQuote(req, req.params.id!);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO sales_quotes (lead_id, title, currency, lines, subtotal, discount_pct, discount, tax_rate, tax, total, billing_interval, notes, terms,
                                 valid_until, public_token, created_by)
       SELECT lead_id, title, currency, lines, subtotal, discount_pct, discount, tax_rate, tax, total, billing_interval, notes, terms,
              GREATEST(valid_until, (now() AT TIME ZONE 'UTC')::date + 30), $2, $3 FROM sales_quotes WHERE id = $1 RETURNING id`,
      [q.id, newQuoteToken(), meId(req)]);
    sendOk(res, view(await loadQuote(req, rows[0]!.id)), undefined, 201);
  }));

  r.post('/sales/quotes/:id/send', requirePerm('sales', 'full'), validateBody(z.object({
    to: optEmail,
    message: z.string().trim().max(2000).optional(),
  }).strict()), asyncHandler(async (req, res) => {
    const q = await loadQuote(req, req.params.id!);
    const b = req.body as { to?: string | null; message?: string };
    if (q.status === 'accepted' || q.status === 'declined') throw conflict(`This quote was already ${q.status}.`);
    if (q.valid_until < new Date().toISOString().slice(0, 10)) throw conflict('This quote is past its valid-until date — duplicate it, or change the date while it’s a draft.');
    const to = b.to ?? q.lead_email;
    if (!to) throw badRequest('This lead has no email address — enter one to send the quote to.');
    const smtp = await platformSmtpConfigError();
    if (smtp) throw new AppError('conflict', `${smtp} (Settings › Email)`, { reason: 'smtp_not_configured' });
    const link = appUrl(`/quote/${q.public_token}`);
    const greeting = q.contact_name ? `Hi ${e(q.contact_name)},` : 'Hello,';
    const sent = await enqueuePlatformEmails('sales.quote', [to], {
      subject: `Quote Q-${q.number}: ${q.title}`,
      html: layout({
        heading: `Your quote: ${q.title}`,
        paragraphs: [
          greeting,
          b.message ? e(b.message).replace(/\n/g, '<br>') : `Here is our quote for ${e(q.company)}.`,
          `<strong>${e(q.currency)} ${e(q.total)}</strong> ${e(INTERVAL_LABEL[q.billing_interval] ?? '')} · valid until ${e(q.valid_until)}`,
        ],
        button: { label: 'View the quote', url: link },
      }),
    });
    if (sent.error) throw new AppError('conflict', sent.error, { reason: 'email_failed' });
    await query(`UPDATE sales_quotes SET status = 'sent', sent_at = now(), sent_to = $2 WHERE id = $1`, [q.id, to]);
    await logLeadActivity(pool, q.lead_id, 'quote', b.message ?? null, { number: q.number, event: 'sent', to, total: q.total, currency: q.currency }, meId(req));
    await writePlatformAudit(req, null, { action: 'quote.send', entityType: 'sales_quote', entityId: q.id, after: { number: q.number, to } });
    sendOk(res, view(await loadQuote(req, q.id)));
  }));

  r.post('/sales/quotes/:id/mark', requirePerm('sales', 'full'), validateBody(z.object({
    decision: z.enum(['accepted', 'declined']),
    name: z.string().trim().max(200).optional(),
    reason: z.string().trim().max(2000).optional(),
  }).strict()), asyncHandler(async (req, res) => {
    const q = await loadQuote(req, req.params.id!);
    const b = req.body as { decision: 'accepted' | 'declined'; name?: string; reason?: string };
    const r2 = await respondToQuote({ id: q.id }, { decision: b.decision, name: b.name || null, reason: b.reason || null, actorId: meId(req) });
    if (!r2.ok) throw conflict(r2.reason === 'expired' ? 'This quote has expired.' : r2.reason === 'not_sent' ? 'Send the quote first.' : 'This quote was already answered.');
    await writePlatformAudit(req, null, { action: `quote.${b.decision}`, entityType: 'sales_quote', entityId: q.id, after: { number: q.number } });
    sendOk(res, view(await loadQuote(req, q.id)));
  }));

  return r;
}

