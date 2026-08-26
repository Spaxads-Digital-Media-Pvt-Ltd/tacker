/**
 * Offer Groups — matches the reference's real "Manage Offer Groups" (/offers/groups): a Currency,
 * Labels/Notes, an "Enable Caps" toggle guarding a Click/Conversion/Payout/Revenue ×
 * Daily/Weekly/Monthly/Global cap matrix, plus real "Today's Clicks/Payout/Revenue" aggregates
 * (today's clicks/conversions for the group's member offers). Tenant-scoped by network_id (spec
 * §3A); member offers are verified to belong to the caller's network.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'offer_groups';

interface CapWindow { daily?: number | null; weekly?: number | null; monthly?: number | null; global?: number | null }
interface Caps { clicks?: CapWindow; conversions?: CapWindow; payout?: CapWindow; revenue?: CapWindow }

interface Row {
  id: string; ref: string; name: string; advertiser_id: string | null; offer_ids: string[];
  currency: string; labels: string | null; notes: string | null; status: string;
  caps_enabled: boolean; caps: Caps; created_at: string; updated_at: string;
}
const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, advertiserId: r.advertiser_id, offerIds: r.offer_ids,
  currency: r.currency, labels: r.labels, notes: r.notes, status: r.status,
  capsEnabled: r.caps_enabled, caps: r.caps, createdAt: r.created_at, updatedAt: r.updated_at,
});

const capWindowSchema = z.object({
  daily: z.number().min(0).nullable().optional(),
  weekly: z.number().min(0).nullable().optional(),
  monthly: z.number().min(0).nullable().optional(),
  global: z.number().min(0).nullable().optional(),
}).optional();
const capsSchema = z.object({
  clicks: capWindowSchema, conversions: capWindowSchema, payout: capWindowSchema, revenue: capWindowSchema,
}).default({});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  advertiserId: z.string().uuid().nullable().optional(),
  offerIds: z.array(z.string().uuid()).default([]),
  currency: z.string().min(1).max(8).default('USD'),
  labels: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['active', 'paused', 'deleted']).default('active'),
  capsEnabled: z.boolean().default(false),
  caps: capsSchema,
});
const updateSchema = createSchema.partial();

async function todayAggForOffers(networkId: string, offerIds: string[]): Promise<{ clicks: number; payout: string; revenue: string }> {
  if (offerIds.length === 0) return { clicks: 0, payout: '0', revenue: '0' };
  const { rows } = await query<{ clicks: string; payout: string; revenue: string }>(
    `SELECT
       COUNT(DISTINCT cl.id)::text AS clicks,
       COALESCE(SUM(c.payout), 0)::text AS payout,
       COALESCE(SUM(c.revenue), 0)::text AS revenue
     FROM clicks cl
     LEFT JOIN conversions c ON c.click_id = cl.click_id AND c.network_id = cl.network_id
     WHERE cl.network_id = $1 AND cl.offer_id = ANY($2::uuid[]) AND cl.created_at::date = CURRENT_DATE`,
    [networkId, offerIds],
  );
  const r = rows[0];
  return { clicks: Number(r?.clicks ?? 0), payout: r?.payout ?? '0', revenue: r?.revenue ?? '0' };
}

export function offerGroupsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where: {}, orderBy: 'created_at', limit: 500 });
    const withStats = await Promise.all(rows.map(async (row) => ({
      ...dto(row), today: await todayAggForOffers(req.scope!.networkId, row.offer_ids),
    })));
    sendOk(res, withStats);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Offer group not found');
    sendOk(res, dto(row));
  }));

  r.get('/:id/stats', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const group = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!group) throw notFound('Offer group not found');
    const offerIds = group.offer_ids;
    if (offerIds.length === 0) return sendOk(res, { revenue: '0', payout: '0', margin: '0', clicks: 0, cv: 0, cvr: 0 });
    const { rows } = await query<{ clicks: string; cv: string; payout: string; revenue: string }>(
      `SELECT
         COUNT(DISTINCT cl.id)::text AS clicks,
         COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'approved')::text AS cv,
         COALESCE(SUM(c.payout), 0)::text AS payout,
         COALESCE(SUM(c.revenue), 0)::text AS revenue
       FROM clicks cl
       LEFT JOIN conversions c ON c.click_id = cl.click_id AND c.network_id = cl.network_id
       WHERE cl.network_id = $1 AND cl.offer_id = ANY($2::uuid[]) AND cl.created_at::date = CURRENT_DATE`,
      [req.scope!.networkId, offerIds],
    );
    const row = rows[0];
    const clicks = Number(row?.clicks ?? 0);
    const cv = Number(row?.cv ?? 0);
    const payout = Number(row?.payout ?? 0);
    const revenue = Number(row?.revenue ?? 0);
    sendOk(res, {
      revenue: revenue.toFixed(2), payout: payout.toFixed(2), margin: (revenue - payout).toFixed(2),
      clicks, cv, cvr: clicks > 0 ? cv / clicks : 0,
    });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Offer group not found');
    const { rows } = await query<{ id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'offer_group' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map((h) => {
      const suffix = h.action.split('.').pop() ?? '';
      return {
        id: h.id, operationTime: h.created_at, service: 'offer_group', changes: h.action,
        employee: h.actor_id, method: { create: 'POST', update: 'PATCH', delete: 'DELETE' }[suffix] ?? '—',
        portal: h.actor_type === 'user' ? 'Dashboard' : h.actor_type === 'api_key' ? 'API' : h.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
        userIp: h.ip, userAgent: h.user_agent,
      };
    }));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    for (const offerId of b.offerIds) {
      const offer = await db.selectOne('offers', { id: offerId });
      if (!offer) throw badRequest('offerIds contains an offer outside this network');
    }
    const row = await db.insert<Row>(TABLE, {
      name: b.name, advertiser_id: b.advertiserId ?? null, offer_ids: JSON.stringify(b.offerIds),
      currency: b.currency, labels: b.labels ?? null, notes: b.notes ?? null, status: b.status,
      caps_enabled: b.capsEnabled, caps: JSON.stringify(b.caps),
    });
    await writeAudit(req, { action: 'offer_group.create', entityType: 'offer_group', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.offerIds !== undefined) {
      for (const offerId of b.offerIds) {
        const offer = await db.selectOne('offers', { id: offerId });
        if (!offer) throw badRequest('offerIds contains an offer outside this network');
      }
    }
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.advertiserId !== undefined) patch['advertiser_id'] = b.advertiserId;
    if (b.offerIds !== undefined) patch['offer_ids'] = JSON.stringify(b.offerIds);
    if (b.currency !== undefined) patch['currency'] = b.currency;
    if (b.labels !== undefined) patch['labels'] = b.labels;
    if (b.notes !== undefined) patch['notes'] = b.notes;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.capsEnabled !== undefined) patch['caps_enabled'] = b.capsEnabled;
    if (b.caps !== undefined) patch['caps'] = JSON.stringify(b.caps);
    const [row] = await db.update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Offer group not found');
    await writeAudit(req, { action: 'offer_group.update', entityType: 'offer_group', entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Offer group not found');
    await writeAudit(req, { action: 'offer_group.delete', entityType: 'offer_group', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
