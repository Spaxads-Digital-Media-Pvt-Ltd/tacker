/**
 * Super Admin › Comms (comms:read sees, comms:full changes) — the help center, the changelog, the status
 * page and email broadcasts (lib/platform/comms.ts). Announcements (banners) stay in flags-routes.ts.
 *
 * - /help-articles: markdown articles per audience (all / staff / partner / advertiser), draft or published.
 * - /changelog: "What's new" entries — new / improved / fixed.
 * - /status/components and /status/incidents (+ /:id/updates): the public status page (/status). Posting
 *   an update moves the incident to that state; "resolved" stamps resolved_at.
 * - /broadcasts: an email to network teams by role, plan and network status — draft, preview (recipient
 *   count + a few addresses), send once.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody } from '../../lib/http/validate.js';
import { conflict, notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import {
  ARTICLE_AUDIENCES, COMPONENT_STATES, INCIDENT_IMPACTS, INCIDENT_STATES, audienceSchema, broadcastRecipients, sendBroadcast, statusPage,
} from '../../lib/platform/comms.js';
import { requirePerm } from './auth.js';
import { meId, optText, optDateTime } from './fields.js';

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lower-case words joined by hyphens, like getting-started').max(120);
const articleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug,
  category: z.string().trim().min(1).max(80).default('General'),
  body: z.string().max(100_000).default(''),
  audience: z.enum(ARTICLE_AUDIENCES).default('all'),
  status: z.enum(['draft', 'published']).default('draft'),
  position: z.number().int().min(0).max(10_000).default(0),
}).strict();
const changelogSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50_000).default(''),
  kind: z.enum(['new', 'improved', 'fixed']).default('new'),
  status: z.enum(['draft', 'published']).default('draft'),
}).strict();
const componentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optText(500),
  position: z.number().int().min(0).max(1000).default(0),
  status: z.enum(COMPONENT_STATES).default('operational'),
}).strict();
const incidentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  impact: z.enum(INCIDENT_IMPACTS).default('minor'),
  status: z.enum(INCIDENT_STATES).default('investigating'),
  componentIds: z.array(z.string().uuid()).max(50).default([]),
  startsAt: optDateTime,
  message: z.string().trim().min(1).max(5000),
}).strict();
const incidentPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  impact: z.enum(INCIDENT_IMPACTS).optional(),
  componentIds: z.array(z.string().uuid()).max(50).optional(),
}).strict();
const updateSchema = z.object({ status: z.enum(INCIDENT_STATES), body: z.string().trim().min(1).max(5000) }).strict();
const broadcastSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  audience: audienceSchema.default({ roles: [], planIds: [], networkStatuses: ['active'] }),
}).strict();

/** A partial UPDATE from a camelCase → column map; returns the row or null. */
async function patchRow<T>(table: string, id: string, cols: Record<string, unknown>): Promise<T | null> {
  const sets: string[] = []; const params: unknown[] = [id];
  for (const [c, v] of Object.entries(cols)) if (v !== undefined) { params.push(v); sets.push(`${c} = $${params.length}`); }
  if (!sets.length) return (await query<T & Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0] ?? null;
  return (await query<T & Record<string, unknown>>(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)).rows[0] ?? null;
}

export function commsRoutes(): Router {
  const r = Router();
  const read = requirePerm('comms', 'read');
  const full = requirePerm('comms', 'full');

  // ── Help center ──────────────────────────────────────────────────────────
  r.get('/help-articles', read, asyncHandler(async (_req, res) => {
    sendOk(res, (await query('SELECT * FROM help_articles ORDER BY category, position, title')).rows);
  }));
  r.post('/help-articles', full, validateBody(articleSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof articleSchema>;
    if ((await query('SELECT 1 FROM help_articles WHERE slug = $1', [b.slug])).rows.length) throw conflict(`An article already uses the address "${b.slug}".`);
    const { rows } = await query(
      `INSERT INTO help_articles (slug, title, category, body, audience, status, position, created_by, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 = 'published' THEN now() END) RETURNING *`,
      [b.slug, b.title, b.category, b.body, b.audience, b.status, b.position, meId(req)]);
    await writePlatformAudit(req, null, { action: 'platform.help_article.create', entityType: 'help_article', entityId: rows[0]!['id'] as string });
    sendOk(res, rows[0], undefined, 201);
  }));
  r.patch('/help-articles/:id', full, validateBody(articleSchema.partial().strict()), asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof articleSchema>>;
    if (b.slug && (await query('SELECT 1 FROM help_articles WHERE slug = $1 AND id <> $2', [b.slug, req.params.id])).rows.length) throw conflict(`An article already uses the address "${b.slug}".`);
    const row = await patchRow<Record<string, unknown>>('help_articles', req.params.id!, {
      slug: b.slug, title: b.title, category: b.category, body: b.body, audience: b.audience, status: b.status, position: b.position,
    });
    if (!row) throw notFound('Article not found');
    if (b.status === 'published' && !row['published_at']) await query('UPDATE help_articles SET published_at = now() WHERE id = $1', [row['id']]);
    await writePlatformAudit(req, null, { action: 'platform.help_article.update', entityType: 'help_article', entityId: req.params.id });
    sendOk(res, (await query('SELECT * FROM help_articles WHERE id = $1', [req.params.id])).rows[0]);
  }));
  r.delete('/help-articles/:id', full, asyncHandler(async (req, res) => {
    if (!(await query('DELETE FROM help_articles WHERE id = $1', [req.params.id])).rowCount) throw notFound('Article not found');
    await writePlatformAudit(req, null, { action: 'platform.help_article.delete', entityType: 'help_article', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  // ── Changelog ────────────────────────────────────────────────────────────
  r.get('/changelog', read, asyncHandler(async (_req, res) => {
    sendOk(res, (await query('SELECT * FROM changelog_entries ORDER BY COALESCE(published_at, created_at) DESC LIMIT 500')).rows);
  }));
  r.post('/changelog', full, validateBody(changelogSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof changelogSchema>;
    const { rows } = await query(
      `INSERT INTO changelog_entries (title, body, kind, status, created_by, published_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'published' THEN now() END) RETURNING *`,
      [b.title, b.body, b.kind, b.status, meId(req)]);
    await writePlatformAudit(req, null, { action: 'platform.changelog.create', entityType: 'changelog_entry', entityId: rows[0]!['id'] as string });
    sendOk(res, rows[0], undefined, 201);
  }));
  r.patch('/changelog/:id', full, validateBody(changelogSchema.partial().strict()), asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof changelogSchema>>;
    const row = await patchRow<Record<string, unknown>>('changelog_entries', req.params.id!, { title: b.title, body: b.body, kind: b.kind, status: b.status });
    if (!row) throw notFound('Entry not found');
    if (b.status === 'published' && !row['published_at']) await query('UPDATE changelog_entries SET published_at = now() WHERE id = $1', [row['id']]);
    sendOk(res, (await query('SELECT * FROM changelog_entries WHERE id = $1', [req.params.id])).rows[0]);
  }));
  r.delete('/changelog/:id', full, asyncHandler(async (req, res) => {
    if (!(await query('DELETE FROM changelog_entries WHERE id = $1', [req.params.id])).rowCount) throw notFound('Entry not found');
    sendOk(res, { deleted: true });
  }));

  // ── Status page ──────────────────────────────────────────────────────────
  r.get('/status', read, asyncHandler(async (_req, res) => {
    const page = await statusPage();
    const incidents = (await query('SELECT * FROM status_incidents ORDER BY starts_at DESC LIMIT 200')).rows;
    sendOk(res, { ...page, all: incidents });
  }));
  r.post('/status/components', full, validateBody(componentSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof componentSchema>;
    const { rows } = await query('INSERT INTO status_components (name, description, position, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [b.name, b.description ?? null, b.position, b.status]);
    await writePlatformAudit(req, null, { action: 'platform.status_component.create', entityType: 'status_component', entityId: rows[0]!['id'] as string });
    sendOk(res, rows[0], undefined, 201);
  }));
  r.patch('/status/components/:id', full, validateBody(componentSchema.partial().strict()), asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof componentSchema>>;
    const row = await patchRow('status_components', req.params.id!, { name: b.name, description: b.description, position: b.position, status: b.status });
    if (!row) throw notFound('Component not found');
    await writePlatformAudit(req, null, { action: 'platform.status_component.update', entityType: 'status_component', entityId: req.params.id, after: b });
    sendOk(res, row);
  }));
  r.delete('/status/components/:id', full, asyncHandler(async (req, res) => {
    if (!(await query('DELETE FROM status_components WHERE id = $1', [req.params.id])).rowCount) throw notFound('Component not found');
    sendOk(res, { deleted: true });
  }));
  r.post('/status/incidents', full, validateBody(incidentSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof incidentSchema>;
    const { rows } = await query<{ id: string }>(
      `INSERT INTO status_incidents (title, impact, status, component_ids, starts_at, resolved_at, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), CASE WHEN $3 = 'resolved' THEN now() END, $6) RETURNING id`,
      [b.title, b.impact, b.status, b.componentIds, b.startsAt ?? null, meId(req)]);
    await query('INSERT INTO status_incident_updates (incident_id, status, body, created_by) VALUES ($1, $2, $3, $4)', [rows[0]!.id, b.status, b.message, meId(req)]);
    await writePlatformAudit(req, null, { action: 'platform.status_incident.create', entityType: 'status_incident', entityId: rows[0]!.id, after: { title: b.title, impact: b.impact } });
    sendOk(res, (await query('SELECT * FROM status_incidents WHERE id = $1', [rows[0]!.id])).rows[0], undefined, 201);
  }));
  r.patch('/status/incidents/:id', full, validateBody(incidentPatchSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof incidentPatchSchema>;
    const row = await patchRow('status_incidents', req.params.id!, { title: b.title, impact: b.impact, component_ids: b.componentIds });
    if (!row) throw notFound('Incident not found');
    sendOk(res, row);
  }));
  r.post('/status/incidents/:id/updates', full, validateBody(updateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof updateSchema>;
    const { rows } = await query(
      `UPDATE status_incidents SET status = $2, resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END
        WHERE id = $1 RETURNING *`, [req.params.id, b.status]);
    if (!rows[0]) throw notFound('Incident not found');
    await query('INSERT INTO status_incident_updates (incident_id, status, body, created_by) VALUES ($1, $2, $3, $4)', [req.params.id, b.status, b.body, meId(req)]);
    await writePlatformAudit(req, null, { action: 'platform.status_incident.update', entityType: 'status_incident', entityId: req.params.id, after: { status: b.status } });
    sendOk(res, rows[0], undefined, 201);
  }));
  r.delete('/status/incidents/:id', full, asyncHandler(async (req, res) => {
    if (!(await query('DELETE FROM status_incidents WHERE id = $1', [req.params.id])).rowCount) throw notFound('Incident not found');
    sendOk(res, { deleted: true });
  }));

  // ── Broadcasts ───────────────────────────────────────────────────────────
  r.get('/broadcasts', read, asyncHandler(async (_req, res) => {
    sendOk(res, (await query(
      `SELECT b.*, COALESCE(a.name, a.email) AS created_by_name FROM platform_broadcasts b LEFT JOIN platform_admins a ON a.id = b.created_by
        ORDER BY b.created_at DESC LIMIT 200`)).rows);
  }));
  r.post('/broadcasts', full, validateBody(broadcastSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof broadcastSchema>;
    const { rows } = await query('INSERT INTO platform_broadcasts (subject, body, audience, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [b.subject, b.body, JSON.stringify(b.audience), meId(req)]);
    sendOk(res, rows[0], undefined, 201);
  }));
  r.patch('/broadcasts/:id', full, validateBody(broadcastSchema.partial().strict()), asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof broadcastSchema>>;
    const cur = (await query<{ status: string }>('SELECT status FROM platform_broadcasts WHERE id = $1', [req.params.id])).rows[0];
    if (!cur) throw notFound('Broadcast not found');
    if (cur.status !== 'draft') throw conflict('This broadcast was sent — it can no longer change.');
    sendOk(res, await patchRow('platform_broadcasts', req.params.id!, { subject: b.subject, body: b.body, audience: b.audience ? JSON.stringify(b.audience) : undefined }));
  }));
  // Who it would reach, before sending (count + the first few addresses).
  r.post('/broadcasts/preview', read, validateBody(z.object({ audience: audienceSchema }).strict()), asyncHandler(async (req, res) => {
    const to = await broadcastRecipients((req.body as { audience: z.infer<typeof audienceSchema> }).audience);
    sendOk(res, { recipients: to.length, sample: to.slice(0, 5) });
  }));
  r.post('/broadcasts/:id/send', full, asyncHandler(async (req, res) => {
    const out = await sendBroadcast(req.params.id!);
    if (!out) throw conflict('Only a draft broadcast can be sent (it may have been sent already).');
    await writePlatformAudit(req, null, { action: 'platform.broadcast.send', entityType: 'platform_broadcast', entityId: req.params.id, after: out });
    sendOk(res, out);
  }));
  r.delete('/broadcasts/:id', full, asyncHandler(async (req, res) => {
    if (!(await query(`DELETE FROM platform_broadcasts WHERE id = $1 AND status = 'draft'`, [req.params.id])).rowCount) throw conflict('Only a draft can be deleted.');
    sendOk(res, { deleted: true });
  }));

  return r;
}
