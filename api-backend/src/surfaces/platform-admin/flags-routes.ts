/**
 * Super Admin › Platform — feature flags and announcements.
 *
 * - /flags (platform:read / full): the flags with how many networks have each on; the gateable features
 *   (lib/platform/flags.ts); create / change (enabled, rollout %, plans, networks on / off, kill switch) /
 *   delete — changes apply within 10 s (this process at once). /flags/:id/networks: each network's answer.
 * - /announcements (comms:read / full): draft → published → archived; audience (all · plans · networks),
 *   who sees it (staff, partner, advertiser portals), from / until, maintenance window, dismissible, a link;
 *   how many dismissed it.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody } from '../../lib/http/validate.js';
import { badRequest, notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { GATEABLE, evaluateFlag, forgetFlags, type FlagRow } from '../../lib/platform/flags.js';
import { requirePerm } from './auth.js';
import { UUID_RE, meId, optText } from './fields.js';

const uuids = z.array(z.string().uuid()).max(5000);
const flagFields = {
  name: z.string().trim().min(1).max(120),
  description: optText(500),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
  planIds: uuids,
  networkIdsOn: uuids,
  networkIdsOff: uuids,
  killSwitch: z.boolean(),
};
const flagCreateSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, 'lowercase letters, digits and _ (e.g. ai_assistant)'),
  ...flagFields,
  enabled: flagFields.enabled.default(false), rolloutPercent: flagFields.rolloutPercent.default(0), planIds: uuids.default([]),
  networkIdsOn: uuids.default([]), networkIdsOff: uuids.default([]), killSwitch: flagFields.killSwitch.default(false),
}).strict();
const flagPatchSchema = z.object(flagFields).partial().strict();

const dateTime = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a date and time').transform((v) => new Date(v).toISOString());
const annFields = {
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
  kind: z.enum(['info', 'success', 'warning', 'critical', 'maintenance']),
  audience: z.enum(['all', 'plans', 'networks']),
  planIds: uuids,
  networkIds: uuids,
  roles: z.array(z.enum(['admin', 'publisher', 'advertiser'])).min(1).max(3),
  startsAt: dateTime,
  endsAt: dateTime.nullable(),
  maintenanceStartsAt: dateTime.nullable(),
  maintenanceEndsAt: dateTime.nullable(),
  dismissible: z.boolean(),
  linkUrl: z.string().trim().url().max(500).nullable().or(z.literal('').transform(() => null)),
  linkLabel: optText(60),
};
const annCreateSchema = z.object({
  ...annFields,
  kind: annFields.kind.default('info'), audience: annFields.audience.default('all'), planIds: uuids.default([]), networkIds: uuids.default([]),
  roles: annFields.roles.default(['admin']), startsAt: annFields.startsAt.optional(), endsAt: annFields.endsAt.optional(),
  maintenanceStartsAt: annFields.maintenanceStartsAt.optional(), maintenanceEndsAt: annFields.maintenanceEndsAt.optional(),
  dismissible: annFields.dismissible.default(true), linkUrl: annFields.linkUrl.optional(),
}).strict();
const annPatchSchema = z.object(annFields).partial().strict();

const FLAG_COLS: Record<string, string> = {
  name: 'name', description: 'description', enabled: 'enabled', rolloutPercent: 'rollout_percent', planIds: 'plan_ids',
  networkIdsOn: 'network_ids_on', networkIdsOff: 'network_ids_off', killSwitch: 'kill_switch',
};
const ANN_COLS: Record<string, string> = {
  title: 'title', body: 'body', kind: 'kind', audience: 'audience', planIds: 'plan_ids', networkIds: 'network_ids', roles: 'roles',
  startsAt: 'starts_at', endsAt: 'ends_at', maintenanceStartsAt: 'maintenance_starts_at', maintenanceEndsAt: 'maintenance_ends_at',
  dismissible: 'dismissible', linkUrl: 'link_url', linkLabel: 'link_label',
};
const ANN_CAST: Record<string, string> = { plan_ids: '::uuid[]', network_ids: '::uuid[]', roles: '::text[]', starts_at: '::timestamptz', ends_at: '::timestamptz',
  maintenance_starts_at: '::timestamptz', maintenance_ends_at: '::timestamptz' };

/** Each network's plan, for counting a flag's reach. */
async function networksWithPlans(): Promise<{ id: string; name: string; plan_id: string | null }[]> {
  return (await query<{ id: string; name: string; plan_id: string | null }>(
    `SELECT n.id, n.name, s.plan_id FROM networks n
       LEFT JOIN subscriptions s ON s.network_id = n.id AND s.status IN ('trialing', 'active', 'past_due')
      WHERE n.status <> 'deleted' ORDER BY n.name`)).rows;
}

/** Postgres check messages → the reason in words. */
function annError(err: unknown): never {
  const c = (err as { constraint?: string; code?: string });
  if (c.code === '23514') {
    if (/maintenance/.test(c.constraint ?? '') || /check1/.test(c.constraint ?? '')) throw badRequest('A maintenance announcement needs its window: a start and an end after it.');
    throw badRequest('“Until” must be after “From”.');
  }
  throw err;
}

export function flagsRoutes(): Router {
  const r = Router();

  // ---------- Feature flags ----------
  r.get('/flags', requirePerm('platform', 'read'), asyncHandler(async (_req, res) => {
    const [flags, nets] = await Promise.all([query<FlagRow & Record<string, unknown>>('SELECT * FROM platform_feature_flags ORDER BY key'), networksWithPlans()]);
    sendOk(res, {
      flags: flags.rows.map((f) => ({ ...f, networks_on: nets.filter((n) => evaluateFlag(f, n.id, n.plan_id)).length, networks_total: nets.length })),
      gateable: GATEABLE,
    });
  }));

  r.get('/flags/:id/networks', requirePerm('platform', 'read'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const flag = UUID_RE.test(id) ? (await query<FlagRow>('SELECT * FROM platform_feature_flags WHERE id = $1', [id])).rows[0] : undefined;
    if (!flag) throw notFound('Flag not found');
    sendOk(res, (await networksWithPlans()).map((n) => ({ ...n, on: evaluateFlag(flag, n.id, n.plan_id) })));
  }));

  r.post('/flags', requirePerm('platform', 'full'), validateBody(flagCreateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof flagCreateSchema>;
    try {
      const row = (await query(
        `INSERT INTO platform_feature_flags (key, name, description, enabled, rollout_percent, plan_ids, network_ids_on, network_ids_off, kill_switch, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *`,
        [b.key, b.name, b.description ?? null, b.enabled, b.rolloutPercent, b.planIds, b.networkIdsOn, b.networkIdsOff, b.killSwitch, meId(req)])).rows[0]!;
      forgetFlags();
      await writePlatformAudit(req, null, { action: 'flag.create', entityType: 'feature_flag', entityId: row['id'] as string, after: row });
      sendOk(res, row, undefined, 201);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw badRequest(`A flag with the key ${b.key} already exists.`);
      throw err;
    }
  }));

  r.patch('/flags/:id', requirePerm('platform', 'full'), validateBody(flagPatchSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const before = UUID_RE.test(id) ? (await query('SELECT * FROM platform_feature_flags WHERE id = $1', [id])).rows[0] : undefined;
    if (!before) throw notFound('Flag not found');
    const b = req.body as Record<string, unknown>;
    const sets: string[] = []; const params: unknown[] = [];
    for (const [k, col] of Object.entries(FLAG_COLS)) if (b[k] !== undefined) { params.push(b[k]); sets.push(`${col} = $${params.length}`); }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(meId(req)); sets.push(`updated_by = $${params.length}`);
    params.push(id);
    const row = (await query(`UPDATE platform_feature_flags SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params)).rows[0];
    forgetFlags();
    await writePlatformAudit(req, null, { action: 'flag.update', entityType: 'feature_flag', entityId: id, before, after: row });
    sendOk(res, row);
  }));

  r.delete('/flags/:id', requirePerm('platform', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const row = UUID_RE.test(id) ? (await query('DELETE FROM platform_feature_flags WHERE id = $1 RETURNING *', [id])).rows[0] : undefined;
    if (!row) throw notFound('Flag not found');
    forgetFlags();
    await writePlatformAudit(req, null, { action: 'flag.delete', entityType: 'feature_flag', entityId: id, before: row });
    sendOk(res, { deleted: true });
  }));

  // ---------- Announcements ----------
  r.get('/announcements', requirePerm('comms', 'read'), asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT a.*, COALESCE(pa.name, pa.email) AS created_by_name,
              (SELECT COUNT(*) FROM platform_announcement_dismissals d WHERE d.announcement_id = a.id)::int AS dismissals,
              (a.status = 'published' AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now())) AS live
         FROM platform_announcements a LEFT JOIN platform_admins pa ON pa.id = a.created_by
        ORDER BY CASE a.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, a.starts_at DESC LIMIT 300`);
    sendOk(res, rows);
  }));

  r.post('/announcements', requirePerm('comms', 'full'), validateBody(annCreateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof annCreateSchema>;
    const row = await query(
      `INSERT INTO platform_announcements (title, body, kind, audience, plan_ids, network_ids, roles, starts_at, ends_at, maintenance_starts_at, maintenance_ends_at,
                                          dismissible, link_url, link_label, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15) RETURNING *`,
      [b.title, b.body, b.kind, b.audience, b.planIds, b.networkIds, b.roles, b.startsAt ?? null, b.endsAt ?? null, b.maintenanceStartsAt ?? null,
        b.maintenanceEndsAt ?? null, b.dismissible, b.linkUrl ?? null, b.linkLabel ?? null, meId(req)]).catch(annError);
    await writePlatformAudit(req, null, { action: 'announcement.create', entityType: 'announcement', entityId: row.rows[0]!['id'] as string, after: row.rows[0] });
    sendOk(res, row.rows[0], undefined, 201);
  }));

  r.patch('/announcements/:id', requirePerm('comms', 'full'), validateBody(annPatchSchema), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!UUID_RE.test(id)) throw notFound('Announcement not found');
    const b = req.body as Record<string, unknown>;
    const sets: string[] = []; const params: unknown[] = [];
    for (const [k, col] of Object.entries(ANN_COLS)) if (b[k] !== undefined) { params.push(b[k]); sets.push(`${col} = $${params.length}${ANN_CAST[col] ?? ''}`); }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(id);
    const row = (await query(`UPDATE platform_announcements SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params).catch(annError)).rows[0];
    if (!row) throw notFound('Announcement not found');
    await writePlatformAudit(req, null, { action: 'announcement.update', entityType: 'announcement', entityId: id, after: row });
    sendOk(res, row);
  }));

  // Publish (shown from its start), archive (gone), or back to draft.
  for (const [path, status] of [['publish', 'published'], ['archive', 'archived'], ['unpublish', 'draft']] as const) {
    r.post(`/announcements/:id/${path}`, requirePerm('comms', 'full'), asyncHandler(async (req, res) => {
      const id = req.params.id!;
      const row = UUID_RE.test(id) ? (await query(
        `UPDATE platform_announcements SET status = $2, published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
          WHERE id = $1 RETURNING *`, [id, status])).rows[0] : undefined;
      if (!row) throw notFound('Announcement not found');
      await writePlatformAudit(req, null, { action: `announcement.${path}`, entityType: 'announcement', entityId: id });
      sendOk(res, row);
    }));
  }

  r.delete('/announcements/:id', requirePerm('comms', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const row = UUID_RE.test(id) ? (await query('DELETE FROM platform_announcements WHERE id = $1 RETURNING id', [id])).rows[0] : undefined;
    if (!row) throw notFound('Announcement not found');
    await writePlatformAudit(req, null, { action: 'announcement.delete', entityType: 'announcement', entityId: id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
