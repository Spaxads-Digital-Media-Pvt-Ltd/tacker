/**
 * A quote's private page (unauthenticated, before the auth gate) — the link a prospect gets by email from
 * Super Admin › Sales (lib/platform/quotes.ts). The token is the only key: 32 random bytes, so it can't be
 * guessed; a draft is never shown.
 *
 * - GET /api/public/quotes/:token — the quote (marks it viewed).
 * - POST /api/public/quotes/:token/respond { decision: accept | decline, name, reason? } — once, while it's
 *   valid (expired / answered → 409); accepting needs the person's name. The lead's owner is told.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { AppError, notFound } from '../../../lib/http/errors.js';
import { publicQuote, respondToQuote } from '../../../lib/platform/quotes.js';
import { notifyQuoteResponded } from '../../../lib/platform/notify.js';

const respondSchema = z.object({
  decision: z.enum(['accept', 'decline']),
  name: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(2000).optional(),
}).strict().refine((b) => b.decision === 'decline' || (b.name ?? '').length > 0, { message: 'type your name to accept', path: ['name'] });

const REFUSAL: Record<string, string> = {
  expired: 'This quote has expired — ask for a new one.',
  already_answered: 'This quote has already been answered.',
  not_sent: 'This quote isn’t available.',
};

export function publicQuoteRoutes(): Router {
  const r = Router();
  r.get('/quotes/:token', asyncHandler(async (req, res) => {
    const q = await publicQuote(req.params.token!);
    if (!q) throw notFound('This quote link isn’t valid.');
    res.setHeader('cache-control', 'no-store');
    sendOk(res, q);
  }));
  r.post('/quotes/:token/respond', validateBody(respondSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof respondSchema>;
    const out = await respondToQuote({ token: req.params.token! }, {
      decision: b.decision === 'accept' ? 'accepted' : 'declined', name: b.name || null, reason: b.reason || null,
    });
    if (!out.ok) {
      if (out.reason === 'not_found') throw notFound('This quote link isn’t valid.');
      throw new AppError('conflict', REFUSAL[out.reason] ?? 'This quote can’t be answered.', { reason: out.reason });
    }
    await notifyQuoteResponded(out.id);
    sendOk(res, await publicQuote(req.params.token!));
  }));
  return r;
}
