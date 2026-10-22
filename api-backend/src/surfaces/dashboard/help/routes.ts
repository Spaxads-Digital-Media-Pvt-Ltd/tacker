/**
 * Help center + "What's new" for everyone signed in (published content from Super Admin › Comms):
 * network staff see articles for everyone and for staff; partners and advertisers those for everyone and
 * for their own kind. publicStatusRoutes (unauthenticated): GET /api/public/status — the status page.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateQuery } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { containsPattern } from '../../../lib/db/like.js';
import { statusPage } from '../../../lib/platform/comms.js';

/** The article audiences this reader may see. */
function audiences(req: Request): string[] {
  const id = req.identity;
  const kind = id && id.surface === 'dashboard' ? id.kind : 'admin';
  return kind === 'publisher' ? ['all', 'partner'] : kind === 'advertiser' ? ['all', 'advertiser'] : ['all', 'staff'];
}

const ARTICLE_LIST = 'id, slug, title, category, audience, position, views, published_at, updated_at, left(body, 240) AS excerpt';

export function helpRoutes(): Router {
  const r = Router();
  const listQuery = z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(80).optional() });
  r.get('/articles', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const f = res.locals.query as z.infer<typeof listQuery>;
    const params: unknown[] = [audiences(req)];
    const where = [`status = 'published'`, `audience = ANY($1::text[])`];
    if (f.category) { params.push(f.category); where.push(`category = $${params.length}`); }
    if (f.q) { params.push(containsPattern(f.q)); where.push(`(title ILIKE $${params.length} ESCAPE '\\' OR body ILIKE $${params.length} ESCAPE '\\')`); }
    const { rows } = await query(`SELECT ${ARTICLE_LIST} FROM help_articles WHERE ${where.join(' AND ')} ORDER BY category, position, title LIMIT 500`, params);
    sendOk(res, rows);
  }));
  r.get('/articles/:slug', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE help_articles SET views = views + 1 WHERE slug = $1 AND status = 'published' AND audience = ANY($2::text[])
       RETURNING id, slug, title, category, body, audience, published_at, updated_at`, [req.params.slug, audiences(req)]);
    if (!rows[0]) throw notFound('Article not found');
    sendOk(res, rows[0]);
  }));
  r.get('/changelog', asyncHandler(async (_req, res) => {
    sendOk(res, (await query(`SELECT id, title, body, kind, published_at FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC LIMIT 100`)).rows);
  }));
  return r;
}

export function publicStatusRoutes(): Router {
  const r = Router();
  r.get('/status', asyncHandler(async (_req, res) => {
    res.setHeader('cache-control', 'public, max-age=30');
    sendOk(res, await statusPage());
  }));
  return r;
}
