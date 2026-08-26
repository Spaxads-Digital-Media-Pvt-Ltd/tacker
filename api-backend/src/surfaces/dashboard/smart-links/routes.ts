/**
 * Smart Links — matches the reference's real "Manage Smart Links" (/offers/campaigns): a Redirect
 * Mechanism (KPI / Priority / Weight) instead of a plain rotation toggle, a Catch-All Offer,
 * Labels/Force SSL/Show to Partners/Tracking Domain, per-item Offer URL override + Position (for
 * Priority), and a real "Today's Revenue" aggregate (clicks routed through this link today, joined
 * to their conversions). Admin CRUD here; the tracking surface resolves & redirects at /sl (see
 * tracking/app.ts). Tenant-scoped by network_id; referenced offers/domains are verified to belong
 * to the caller's network (spec §3A).
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

const LINKS = 'smart_links';
const ITEMS = 'smart_link_items';

interface LinkRow {
  id: string; ref: string; name: string; status: string; labels: string | null;
  force_ssl: boolean; show_to_partners: boolean; tracking_domain_id: string | null;
  redirect_mechanism: string; catch_all_offer_id: string | null;
  kpi_run_frequency_hours: number | null; kpi_lookback_hours: number | null;
  kpi_metric: string | null; kpi_min_clicks: number | null;
  created_at: string; updated_at: string;
}
interface ItemRow { id: string; smart_link_id: string; offer_id: string; weight: number; country: string | null; offer_url: string | null; position: number | null }

const linkDTO = (r: LinkRow) => ({
  id: r.id, ref: Number(r.ref), name: r.name, status: r.status, labels: r.labels,
  forceSsl: r.force_ssl, showToPartners: r.show_to_partners, trackingDomainId: r.tracking_domain_id,
  redirectMechanism: r.redirect_mechanism, catchAllOfferId: r.catch_all_offer_id,
  kpiRunFrequencyHours: r.kpi_run_frequency_hours, kpiLookbackHours: r.kpi_lookback_hours,
  kpiMetric: r.kpi_metric, kpiMinClicks: r.kpi_min_clicks,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const itemDTO = (r: ItemRow) => ({ id: r.id, offerId: r.offer_id, weight: r.weight, country: r.country, offerUrl: r.offer_url, position: r.position });

const itemInputSchema = z.object({
  offerId: z.string().uuid(),
  weight: z.number().int().min(0).max(1000).default(1),
  position: z.number().int().min(1).nullable().optional(),
  country: z.string().max(3).nullable().optional(),
  offerUrl: z.string().url().max(2000).nullable().optional(),
});

const createLinkSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'paused', 'deleted']).default('active'),
  labels: z.string().max(500).nullable().optional(),
  forceSsl: z.boolean().default(true),
  showToPartners: z.boolean().default(false),
  trackingDomainId: z.string().uuid().nullable().optional(),
  redirectMechanism: z.enum(['kpi', 'priority', 'weight']).default('weight'),
  catchAllOfferId: z.string().uuid().nullable().optional(),
  kpiRunFrequencyHours: z.number().int().min(1).max(168).nullable().optional(),
  kpiLookbackHours: z.number().int().min(1).max(168).nullable().optional(),
  kpiMetric: z.enum(['CVR', 'EPC', 'Revenue']).nullable().optional(),
  kpiMinClicks: z.number().int().min(1).max(100000).nullable().optional(),
  items: z.array(itemInputSchema).max(50).default([]),
});
const updateLinkSchema = createLinkSchema.partial();

function itemColumns(mechanism: string, b: z.infer<typeof itemInputSchema>) {
  return {
    offer_id: b.offerId,
    weight: mechanism === 'weight' ? b.weight : 0,
    position: mechanism === 'priority' ? (b.position ?? null) : null,
    country: b.country ? b.country.toUpperCase() : null,
    offer_url: b.offerUrl ?? null,
  };
}

export function smartLinksRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<LinkRow>(LINKS, { where: {}, orderBy: 'created_at', limit: 500 });
    const { rows: revRows } = await query<{ smart_link_id: string; revenue: string }>(
      `SELECT cl.smart_link_id, COALESCE(SUM(c.revenue), 0)::text AS revenue
       FROM clicks cl JOIN conversions c ON c.click_id = cl.click_id AND c.network_id = cl.network_id
       WHERE cl.network_id = $1 AND cl.smart_link_id IS NOT NULL AND cl.created_at::date = CURRENT_DATE
       GROUP BY cl.smart_link_id`,
      [req.scope!.networkId],
    );
    const revByLink = new Map(revRows.map((x) => [x.smart_link_id, x.revenue]));
    sendOk(res, rows.map((row) => ({ ...linkDTO(row), todayRevenue: revByLink.get(row.id) ?? '0' })));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const link = await db.selectOne<LinkRow>(LINKS, { id: req.params.id });
    if (!link) throw notFound('Smart link not found');
    const items = await db.selectMany<ItemRow>(ITEMS, { where: { smart_link_id: req.params.id }, limit: 500 });
    sendOk(res, { ...linkDTO(link), items: items.map(itemDTO) });
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createLinkSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createLinkSchema>;
    const row = await db.insert<LinkRow>(LINKS, {
      name: b.name, status: b.status, labels: b.labels ?? null, force_ssl: b.forceSsl, show_to_partners: b.showToPartners,
      tracking_domain_id: b.trackingDomainId ?? null, redirect_mechanism: b.redirectMechanism, catch_all_offer_id: b.catchAllOfferId ?? null,
      kpi_run_frequency_hours: b.kpiRunFrequencyHours ?? null, kpi_lookback_hours: b.kpiLookbackHours ?? null,
      kpi_metric: b.kpiMetric ?? null, kpi_min_clicks: b.kpiMinClicks ?? null,
    });
    for (const item of b.items) {
      const offer = await db.selectOne('offers', { id: item.offerId });
      if (!offer) throw badRequest('offerId does not belong to this network');
      await db.insert(ITEMS, { smart_link_id: row.id, ...itemColumns(b.redirectMechanism, item) });
    }
    await writeAudit(req, { action: 'smart_link.create', entityType: 'smart_link', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, linkDTO(row));
  }));

  r.post('/:id/copy', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const link = await db.selectOne<LinkRow>(LINKS, { id: req.params.id });
    if (!link) throw notFound('Smart link not found');
    const items = await db.selectMany<ItemRow>(ITEMS, { where: { smart_link_id: req.params.id }, limit: 500 });
    const copy = await db.insert<LinkRow>(LINKS, {
      name: `${link.name} (copy)`, status: link.status, labels: link.labels, force_ssl: link.force_ssl,
      show_to_partners: link.show_to_partners, tracking_domain_id: link.tracking_domain_id,
      redirect_mechanism: link.redirect_mechanism, catch_all_offer_id: link.catch_all_offer_id,
      kpi_run_frequency_hours: link.kpi_run_frequency_hours, kpi_lookback_hours: link.kpi_lookback_hours,
      kpi_metric: link.kpi_metric, kpi_min_clicks: link.kpi_min_clicks,
    });
    for (const it of items) {
      await db.insert(ITEMS, { smart_link_id: copy.id, offer_id: it.offer_id, weight: it.weight, position: it.position, country: it.country, offer_url: it.offer_url });
    }
    await writeAudit(req, { action: 'smart_link.copy', entityType: 'smart_link', entityId: copy.id, after: copy });
    res.status(201);
    sendOk(res, linkDTO(copy));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateLinkSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateLinkSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    if (b.labels !== undefined) patch['labels'] = b.labels;
    if (b.forceSsl !== undefined) patch['force_ssl'] = b.forceSsl;
    if (b.showToPartners !== undefined) patch['show_to_partners'] = b.showToPartners;
    if (b.trackingDomainId !== undefined) patch['tracking_domain_id'] = b.trackingDomainId;
    if (b.redirectMechanism !== undefined) patch['redirect_mechanism'] = b.redirectMechanism;
    if (b.catchAllOfferId !== undefined) patch['catch_all_offer_id'] = b.catchAllOfferId;
    if (b.kpiRunFrequencyHours !== undefined) patch['kpi_run_frequency_hours'] = b.kpiRunFrequencyHours;
    if (b.kpiLookbackHours !== undefined) patch['kpi_lookback_hours'] = b.kpiLookbackHours;
    if (b.kpiMetric !== undefined) patch['kpi_metric'] = b.kpiMetric;
    if (b.kpiMinClicks !== undefined) patch['kpi_min_clicks'] = b.kpiMinClicks;
    const [row] = patchColumnsEmpty(patch) ? [await db.selectOne<LinkRow>(LINKS, { id: req.params.id })] : await db.update<LinkRow>(LINKS, patch, { id: req.params.id });
    if (!row) throw notFound('Smart link not found');

    if (b.items !== undefined) {
      const mechanism = b.redirectMechanism ?? row.redirect_mechanism;
      await db.delete(ITEMS, { smart_link_id: req.params.id });
      for (const item of b.items) {
        const offer = await db.selectOne('offers', { id: item.offerId });
        if (!offer) throw badRequest('offerId does not belong to this network');
        await db.insert(ITEMS, { smart_link_id: req.params.id, ...itemColumns(mechanism, item) });
      }
    }

    await writeAudit(req, { action: 'smart_link.update', entityType: 'smart_link', entityId: req.params.id, after: row });
    sendOk(res, linkDTO(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(LINKS, { id: req.params.id });
    if (n === 0) throw notFound('Smart link not found');
    await writeAudit(req, { action: 'smart_link.delete', entityType: 'smart_link', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  // --- Rotation items ---
  r.get('/:id/items', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<ItemRow>(ITEMS, { where: { smart_link_id: req.params.id }, limit: 500 });
    sendOk(res, rows.map(itemDTO));
  }));

  r.post('/:id/items', requireRole('admin', 'manager'), validateBody(itemInputSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const link = await db.selectOne<LinkRow>(LINKS, { id: req.params.id });
    if (!link) throw notFound('Smart link not found');
    const b = req.body as z.infer<typeof itemInputSchema>;
    const offer = await db.selectOne('offers', { id: b.offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    const row = await db.insert<ItemRow>(ITEMS, { smart_link_id: req.params.id, ...itemColumns(link.redirect_mechanism, b) });
    await writeAudit(req, { action: 'smart_link.item.create', entityType: 'smart_link_item', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, itemDTO(row));
  }));

  r.delete('/:id/items/:itemId', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(ITEMS, { id: req.params.itemId, smart_link_id: req.params.id });
    if (n === 0) throw notFound('Item not found');
    await writeAudit(req, { action: 'smart_link.item.delete', entityType: 'smart_link_item', entityId: req.params.itemId });
    sendOk(res, { deleted: true });
  }));

  // Matches the "History" tab pattern used across the app (e.g. Tiered Commissions'
  // /:id/history) — a per-entity slice of the same audit_log table writeAudit() writes to.
  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(LINKS, { id: req.params.id });
    if (!existing) throw notFound('Smart link not found');
    const { rows } = await query<{ id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'smart_link' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map((h) => {
      const suffix = h.action.split('.').pop() ?? '';
      return {
        id: h.id, operationTime: h.created_at, service: 'smart_link', changes: h.action,
        employee: h.actor_id, method: { create: 'POST', update: 'PATCH', delete: 'DELETE', copy: 'POST' }[suffix] ?? '—',
        portal: h.actor_type === 'user' ? 'Dashboard' : h.actor_type === 'api_key' ? 'API' : h.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
        userIp: h.ip, userAgent: h.user_agent,
      };
    }));
  }));

  return r;
}

function patchColumnsEmpty(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length === 0;
}
