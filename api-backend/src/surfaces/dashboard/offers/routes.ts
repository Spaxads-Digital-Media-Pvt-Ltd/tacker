/**
 * Offers — Dashboard API routes (spec §1, §3A, §8A). Admin CRUD + nested geo-rules and
 * publisher-access, plus owner-scoped portal reads. Tenant integrity: any referenced
 * advertiser_id / offer_id / publisher_id is verified to belong to the caller's network before
 * use (FKs don't enforce tenant boundaries).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../../lib/http/pagination.js';
import { badRequest, notFound, forbidden } from '../../../lib/http/errors.js';
import { dbForRequest, ownerIdOf } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import type {
  OfferRow,
  OfferGeoRuleRow,
  OfferPublisherAccessRow,
  AdvertiserRow,
  PublisherRow,
} from '../../../domain/entities.js';
import { requireRole } from '../auth.js';
import { invalidateOfferConfig } from '../../tracking/offer-cache.js';
import { generateSecureCode } from '../../../lib/security-code.js';
import {
  createOfferSchema,
  updateOfferSchema,
  createGeoRuleSchema,
  createAccessSchema,
  type CreateOffer,
  type UpdateOffer,
  type CreateGeoRule,
  type CreateAccess,
} from './schemas.js';
import { createScheduledActionSchema, updateScheduledActionSchema, type CreateScheduledAction } from './asset-schemas.js';
import {
  toAdminDTO,
  toAdvertiserDTO,
  toPublisherDTO,
  toGeoRuleDTO,
  toAccessDTO,
} from './dto.js';
import { mountOfferAssets } from './asset-routes.js';
import { attachTagRoutes } from '../tags/routes.js';

const OFFERS = 'offers';
const GEO = 'offer_geo_rules';
const ACCESS = 'offer_publisher_access';
const SCHEDULED_ACTIONS = 'offer_scheduled_actions';

const shareDetailsSchema = z.object({
  offerIds: z.array(z.string().uuid()).min(1),
  publisherId: z.string().uuid(),
});

const duplicateOptionsSchema = z.object({
  includeCustomSettings: z.boolean().default(false),
  includePartnerVisibility: z.boolean().default(false),
  includeForwardingRules: z.boolean().default(false),
  includeCreatives: z.boolean().default(false),
});

const copySettingsSchema = z.object({
  targetOfferId: z.string().uuid(),
  includeCustomSettings: z.boolean().default(false),
  includeForwardingRules: z.boolean().default(false),
  includeCreatives: z.boolean().default(false),
});

interface ScheduledActionRow {
  id: string; action_type: string; partner_ids: string[]; event: string | null;
  scheduled_time: string | null; internal_notes: string | null; created_by: string | null;
  status: string; created_at: string; updated_at: string;
}
const toScheduledActionDTO = (r: ScheduledActionRow) => ({
  id: r.id, actionType: r.action_type, partnerIds: r.partner_ids, event: r.event,
  scheduledTime: r.scheduled_time, internalNotes: r.internal_notes, createdBy: r.created_by,
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

interface AuditLogRow {
  id: string; action: string; actor_type: string; actor_id: string | null;
  ip: string | null; user_agent: string | null; created_at: string;
}
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'offer', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

/** Best-effort human label for an actor — this app has no display-name lookup for dashboard
 * users, so the raw userId is what's stored (matches the SmartSwitch history convention). */
function actorLabel(req: import('express').Request): string | null {
  return req.identity?.surface === 'dashboard' ? req.identity.userId : null;
}

export function offersAdminRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { limit, offset } = res.locals.query as PaginationQuery;
      const db = dbForRequest(req);
      const [rows, total] = await Promise.all([
        db.selectMany<OfferRow>(OFFERS, { limit, offset, orderBy: 'created_at' }),
        db.count(OFFERS),
      ]);
      sendOk(res, rows.map(toAdminDTO), { limit, offset, total });
    }),
  );

  // Status counts for the list stat-card header (registered before /:id).
  r.get('/stats', asyncHandler(async (req, res) => {
    const { rows } = await query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text n FROM offers WHERE network_id = $1 GROUP BY status`,
      [req.scope!.networkId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    sendOk(res, { total, active: by['active'] ?? 0, pending: by['draft'] ?? 0, paused: (by['paused'] ?? 0) + (by['archived'] ?? 0) });
  }));

  // "Share Offer(s) Details" (Table Actions). This app has no outbound-email infrastructure, so
  // this doesn't actually send mail — it records a real, queryable audit trail entry per offer
  // (who shared what with which partner, and when), which is the honest equivalent given what's
  // actually available. Registered before /:id.
  r.post('/share-details', requireRole('admin', 'manager'), validateBody(shareDetailsSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof shareDetailsSchema>;
    const pub = await db.selectOne<PublisherRow>('publishers', { id: b.publisherId });
    if (!pub) throw badRequest('publisherId does not belong to this network');
    for (const offerId of b.offerIds) {
      const offer = await db.selectOne<OfferRow>(OFFERS, { id: offerId });
      if (!offer) continue;
      await writeAudit(req, {
        action: 'offer.share_details', entityType: 'offer', entityId: offerId,
        after: { publisherId: pub.id, publisherName: pub.name },
      });
    }
    sendOk(res, { shared: true, count: b.offerIds.length, publisherName: pub.name });
  }));

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await dbForRequest(req).selectOne<OfferRow>(OFFERS, { id: req.params.id });
      if (!row) throw notFound('Offer not found');
      sendOk(res, toAdminDTO(row));
    }),
  );

  r.post(
    '/',
    requireRole('admin', 'manager'),
    validateBody(createOfferSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as CreateOffer;
      const db = dbForRequest(req);
      // Tenant integrity: advertiser must belong to this network.
      const adv = await db.selectOne<AdvertiserRow>('advertisers', { id: b.advertiserId });
      if (!adv) throw badRequest('advertiserId does not belong to this network');
      if (b.trackingDomainId) {
        const dom = await db.selectOne('tracking_domains', { id: b.trackingDomainId });
        if (!dom) throw badRequest('trackingDomainId does not belong to this network');
      }

      const row = await db.insert<OfferRow>(OFFERS, {
        advertiser_id: b.advertiserId,
        name: b.name,
        status: b.status,
        destination_url: b.destinationUrl,
        payout_model: b.payoutModel,
        default_payout: b.defaultPayout,
        default_revenue: b.defaultRevenue,
        currency: b.currency,
        daily_conversion_cap: b.dailyConversionCap ?? null,
        total_conversion_cap: b.totalConversionCap ?? null,
        daily_click_cap: b.dailyClickCap ?? null,
        ...(b.attributionWindowS !== undefined ? { attribution_window_s: b.attributionWindowS } : {}),
        ...(b.dedupWindowS !== undefined ? { dedup_window_s: b.dedupWindowS } : {}),
        ...(b.allowedTrafficTypes !== undefined ? { allowed_traffic_types: b.allowedTrafficTypes } : {}),
        fallback_url: b.fallbackUrl ?? null,
        objective: b.objective,
        visibility: b.visibility,
        category: b.category ?? null,
        preview_url: b.previewUrl ?? null,
        tracking_domain_id: b.trackingDomainId ?? null,
        ...(b.description || b.kpi ? { metadata: { description: b.description ?? null, kpi: b.kpi ?? null } } : {}),
      });
      await writeAudit(req, { action: 'offer.create', entityType: 'offer', entityId: row.id, after: row });
      res.status(201);
      sendOk(res, toAdminDTO(row));
    }),
  );

  r.patch(
    '/:id',
    requireRole('admin', 'manager'),
    validateBody(updateOfferSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
      if (!before) throw notFound('Offer not found');
      const b = req.body as UpdateOffer;

      if (b.advertiserId !== undefined) {
        const adv = await db.selectOne<AdvertiserRow>('advertisers', { id: b.advertiserId });
        if (!adv) throw badRequest('advertiserId does not belong to this network');
      }
      if (b.trackingDomainId) {
        const dom = await db.selectOne('tracking_domains', { id: b.trackingDomainId });
        if (!dom) throw badRequest('trackingDomainId does not belong to this network');
      }

      const patch: Record<string, unknown> = {};
      const map: Record<string, string> = {
        advertiserId: 'advertiser_id', name: 'name', status: 'status',
        destinationUrl: 'destination_url', payoutModel: 'payout_model',
        defaultPayout: 'default_payout', defaultRevenue: 'default_revenue', currency: 'currency',
        dailyConversionCap: 'daily_conversion_cap', totalConversionCap: 'total_conversion_cap',
        dailyClickCap: 'daily_click_cap', attributionWindowS: 'attribution_window_s',
        dedupWindowS: 'dedup_window_s', allowedTrafficTypes: 'allowed_traffic_types',
        fallbackUrl: 'fallback_url', objective: 'objective', visibility: 'visibility',
        category: 'category', previewUrl: 'preview_url', trackingDomainId: 'tracking_domain_id',
      };
      for (const [k, col] of Object.entries(map)) {
        const val = (b as Record<string, unknown>)[k];
        if (val !== undefined) patch[col] = val;
      }
      // Notes/description live in metadata (merge, don't clobber other keys).
      const bx = b as { notes?: string[]; description?: string; kpi?: string };
      if (bx.notes !== undefined || bx.description !== undefined || bx.kpi !== undefined) {
        patch['metadata'] = {
          ...(before.metadata ?? {}),
          ...(bx.notes !== undefined ? { notes: bx.notes } : {}),
          ...(bx.description !== undefined ? { description: bx.description } : {}),
          ...(bx.kpi !== undefined ? { kpi: bx.kpi } : {}),
        };
      }
      const [row] = await db.update<OfferRow>(OFFERS, patch, { id: req.params.id });
      await writeAudit(req, { action: 'offer.update', entityType: 'offer', entityId: req.params.id, before, after: row });
      await invalidateOfferConfig(db.scope.networkId, req.params.id!);
      sendOk(res, toAdminDTO(row ?? before));
    }),
  );

  r.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
      if (!before) throw notFound('Offer not found');
      await db.delete(OFFERS, { id: req.params.id });
      await writeAudit(req, { action: 'offer.delete', entityType: 'offer', entityId: req.params.id, before });
      await invalidateOfferConfig(db.scope.networkId, req.params.id!);
      sendOk(res, { deleted: true });
    }),
  );

  // --- Duplicate ("Copy Offer") — clones the offer row. Goals/coupons/deals/tags always come
  // along (base config, not user-optional in the reference either); creatives, forwarding rules,
  // partner visibility, and custom settings/geo-rules are gated by the caller's checkboxes. New
  // name gets a " (copy)" suffix, same convention as the reference. ---
  r.post('/:id/duplicate', requireRole('admin', 'manager'), validateBody(duplicateOptionsSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const src = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
    if (!src) throw notFound('Offer not found');
    const opts = req.body as z.infer<typeof duplicateOptionsSchema>;

    const copy = await db.insert<OfferRow>(OFFERS, {
      advertiser_id: src.advertiser_id,
      name: `${src.name} (copy)`,
      status: src.status,
      destination_url: src.destination_url,
      payout_model: src.payout_model,
      default_payout: src.default_payout,
      default_revenue: src.default_revenue,
      currency: src.currency,
      daily_conversion_cap: src.daily_conversion_cap,
      total_conversion_cap: src.total_conversion_cap,
      daily_click_cap: src.daily_click_cap,
      attribution_window_s: src.attribution_window_s,
      dedup_window_s: src.dedup_window_s,
      allowed_traffic_types: src.allowed_traffic_types,
      fallback_url: src.fallback_url,
      objective: src.objective,
      visibility: src.visibility,
      category: src.category,
      preview_url: src.preview_url,
      tracking_domain_id: src.tracking_domain_id,
      metadata: JSON.stringify(src.metadata ?? {}),
    });

    const networkId = db.scope.networkId;
    const copyTable = async (table: string, cols: string): Promise<void> => {
      await query(
        `INSERT INTO ${table} (network_id, offer_id, ${cols})
           SELECT network_id, $2, ${cols} FROM ${table} WHERE network_id = $1 AND offer_id = $3`,
        [networkId, copy.id, src.id],
      );
    };
    // Always copied — base config, not gated by a checkbox in the reference either.
    await copyTable('offer_goals', 'name, event_name, payout_model, payout, revenue, currency, daily_conversion_cap, total_conversion_cap, is_default, status, sort_order');
    await copyTable('offer_coupons', 'code, publisher_id, description, discount, status, starts_at, ends_at');
    await copyTable('offer_deals', 'name, description, deal_type, value, status, starts_at, ends_at');
    await query(
      `INSERT INTO taggings (network_id, tag_id, entity_type, entity_id)
         SELECT network_id, tag_id, 'offer', $2 FROM taggings WHERE network_id = $1 AND entity_type = 'offer' AND entity_id = $3`,
      [networkId, copy.id, src.id],
    );

    if (opts.includeCreatives) await copyTable('offer_creatives', 'name, type, url, html, width, height, language, status');
    if (opts.includeCustomSettings) {
      await copyTable(GEO, 'country, region, action, payout_override, revenue_override, destination_override');
      await query(
        `INSERT INTO offer_custom_settings (network_id, offer_id, category, name, partner_ids, description, public_description, event, value, status)
           SELECT network_id, $2, category, name, partner_ids, description, public_description, event, value, status
             FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $3`,
        [networkId, copy.id, src.id],
      );
    }
    if (opts.includePartnerVisibility) await copyTable(ACCESS, 'publisher_id, access, approval_status, payout_override');
    if (opts.includeForwardingRules) await copyTable('offer_forwarding_rules', 'name, partner_ids, offer_urls, destination, countries, status');

    await writeAudit(req, { action: 'offer.duplicate', entityType: 'offer', entityId: copy.id, after: copy });
    res.status(201);
    sendOk(res, toAdminDTO(copy));
  }));

  // --- "Copy Offer Settings" — same idea as duplicate, but onto an EXISTING offer instead of a
  // new one (appends, doesn't replace the target's existing rows). "Include Offer URLs" has no
  // equivalent concept here (same reason as Copy Offer), so it's accepted but ignored server-side
  // too — the frontend disables that checkbox.
  r.post('/:id/copy-settings-to', requireRole('admin', 'manager'), validateBody(copySettingsSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const src = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
    if (!src) throw notFound('Offer not found');
    const opts = req.body as z.infer<typeof copySettingsSchema>;
    const target = await db.selectOne<OfferRow>(OFFERS, { id: opts.targetOfferId });
    if (!target) throw badRequest('targetOfferId does not belong to this network');

    const networkId = db.scope.networkId;
    const copyTable = async (table: string, cols: string): Promise<void> => {
      await query(
        `INSERT INTO ${table} (network_id, offer_id, ${cols})
           SELECT network_id, $2, ${cols} FROM ${table} WHERE network_id = $1 AND offer_id = $3`,
        [networkId, target.id, src.id],
      );
    };

    if (opts.includeCreatives) await copyTable('offer_creatives', 'name, type, url, html, width, height, language, status');
    if (opts.includeCustomSettings) {
      await copyTable(GEO, 'country, region, action, payout_override, revenue_override, destination_override');
      await query(
        `INSERT INTO offer_custom_settings (network_id, offer_id, category, name, partner_ids, description, public_description, event, value, status)
           SELECT network_id, $2, category, name, partner_ids, description, public_description, event, value, status
             FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $3`,
        [networkId, target.id, src.id],
      );
    }
    if (opts.includeForwardingRules) await copyTable('offer_forwarding_rules', 'name, partner_ids, offer_urls, destination, countries, status');

    await writeAudit(req, { action: 'offer.copy_settings_to', entityType: 'offer', entityId: target.id, after: { sourceOfferId: src.id, ...opts } });
    sendOk(res, { copied: true, targetOfferId: target.id });
  }));

  // --- Geo rules (nested) ---
  r.get(
    '/:id/geo-rules',
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      await ensureOffer(db, req.params.id);
      const rows = await db.selectMany<OfferGeoRuleRow>(GEO, { where: { offer_id: req.params.id }, limit: 500 });
      sendOk(res, rows.map(toGeoRuleDTO));
    }),
  );

  r.post(
    '/:id/geo-rules',
    requireRole('admin', 'manager'),
    validateBody(createGeoRuleSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      await ensureOffer(db, req.params.id);
      const b = req.body as CreateGeoRule;
      const row = await db.insert<OfferGeoRuleRow>(GEO, {
        offer_id: req.params.id,
        country: b.country.toUpperCase(),
        region: b.region ?? null,
        action: b.action,
        payout_override: b.payoutOverride ?? null,
        revenue_override: b.revenueOverride ?? null,
        destination_override: b.destinationOverride ?? null,
      });
      await writeAudit(req, { action: 'offer.geo_rule.create', entityType: 'offer_geo_rule', entityId: row.id, after: row });
      await invalidateOfferConfig(db.scope.networkId, req.params.id!);
      res.status(201);
      sendOk(res, toGeoRuleDTO(row));
    }),
  );

  r.delete(
    '/:id/geo-rules/:ruleId',
    requireRole('admin', 'manager'),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const n = await db.delete(GEO, { id: req.params.ruleId, offer_id: req.params.id });
      if (n === 0) throw notFound('Geo rule not found');
      await writeAudit(req, { action: 'offer.geo_rule.delete', entityType: 'offer_geo_rule', entityId: req.params.ruleId });
      await invalidateOfferConfig(db.scope.networkId, req.params.id!);
      sendOk(res, { deleted: true });
    }),
  );

  // --- Per-offer postback secure_code (overrides the network-wide code) ---
  r.post('/:id/security-code/regenerate', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const offer = await db.selectOne<OfferRow>('offers', { id: req.params.id });
    if (!offer) throw notFound('Offer not found');
    const code = generateSecureCode();
    await db.update('offers', { security_code: code }, { id: req.params.id });
    await invalidateOfferConfig(db.scope.networkId, req.params.id!);
    await writeAudit(req, { action: 'offer.security_code.regenerate', entityType: 'offer', entityId: req.params.id });
    sendOk(res, { securityCode: code });
  }));

  r.delete('/:id/security-code', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await db.update('offers', { security_code: null }, { id: req.params.id });
    await invalidateOfferConfig(db.scope.networkId, req.params.id!);
    await writeAudit(req, { action: 'offer.security_code.clear', entityType: 'offer', entityId: req.params.id });
    sendOk(res, { securityCode: null });
  }));

  // --- Publisher access (nested) ---
  r.get(
    '/:id/publishers',
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      await ensureOffer(db, req.params.id);
      const rows = await db.selectMany<OfferPublisherAccessRow>(ACCESS, { where: { offer_id: req.params.id }, limit: 500 });
      sendOk(res, rows.map(toAccessDTO));
    }),
  );

  r.post(
    '/:id/publishers',
    requireRole('admin', 'manager'),
    validateBody(createAccessSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      await ensureOffer(db, req.params.id);
      const b = req.body as CreateAccess;
      const pub = await db.selectOne<PublisherRow>('publishers', { id: b.publisherId });
      if (!pub) throw badRequest('publisherId does not belong to this network');

      const row = await db.insert<OfferPublisherAccessRow>(ACCESS, {
        offer_id: req.params.id,
        publisher_id: b.publisherId,
        access: b.access,
        approval_status: b.approvalStatus,
        payout_override: b.payoutOverride ?? null,
      });
      await writeAudit(req, { action: 'offer.access.create', entityType: 'offer_publisher_access', entityId: row.id, after: row });
      await invalidateOfferConfig(db.scope.networkId, req.params.id!); // block/allow takes effect on next click
      res.status(201);
      sendOk(res, toAccessDTO(row));
    }),
  );

  r.delete(
    '/:id/publishers/:accessId',
    requireRole('admin', 'manager'),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const n = await db.delete(ACCESS, { id: req.params.accessId, offer_id: req.params.id });
      if (n === 0) throw notFound('Access entry not found');
      await writeAudit(req, { action: 'offer.access.delete', entityType: 'offer_publisher_access', entityId: req.params.accessId });
      await invalidateOfferConfig(db.scope.networkId, req.params.id!);
      sendOk(res, { deleted: true });
    }),
  );

  // --- Offer assets: goals, creatives, coupons, deals, forwarding rules, postbacks (nested under /:id/*) ---
  mountOfferAssets(r);
  // --- Offer tags (/:id/tags) ---
  attachTagRoutes(r, 'offer');

  // --- Scheduled Actions (nested) — hand-rolled (not mountAsset) so created_by can be stamped
  // from the caller's identity. ---
  r.get('/:id/scheduled-actions', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureOffer(db, req.params.id);
    const rows = await db.selectMany<ScheduledActionRow>(SCHEDULED_ACTIONS, { where: { offer_id: req.params.id }, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(toScheduledActionDTO));
  }));

  r.post(
    '/:id/scheduled-actions',
    requireRole('admin', 'manager'),
    validateBody(createScheduledActionSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      await ensureOffer(db, req.params.id);
      const b = req.body as CreateScheduledAction;
      const row = await db.insert<ScheduledActionRow>(SCHEDULED_ACTIONS, {
        offer_id: req.params.id,
        action_type: b.actionType,
        partner_ids: JSON.stringify(b.partnerIds),
        event: b.event ?? null,
        scheduled_time: b.scheduledTime ?? null,
        internal_notes: b.internalNotes ?? null,
        created_by: actorLabel(req),
        status: b.status,
      });
      await writeAudit(req, { action: 'offer.scheduled_action.create', entityType: 'offer_scheduled_actions', entityId: row.id, after: row });
      res.status(201);
      sendOk(res, toScheduledActionDTO(row));
    }),
  );

  r.patch(
    '/:id/scheduled-actions/:actionId',
    requireRole('admin', 'manager'),
    validateBody(updateScheduledActionSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<ScheduledActionRow>(SCHEDULED_ACTIONS, { id: req.params.actionId, offer_id: req.params.id });
      if (!before) throw notFound('Scheduled action not found');
      const b = req.body as Partial<CreateScheduledAction>;
      const patch: Record<string, unknown> = {};
      if (b.actionType !== undefined) patch['action_type'] = b.actionType;
      if (b.partnerIds !== undefined) patch['partner_ids'] = JSON.stringify(b.partnerIds);
      if (b.event !== undefined) patch['event'] = b.event;
      if (b.scheduledTime !== undefined) patch['scheduled_time'] = b.scheduledTime;
      if (b.internalNotes !== undefined) patch['internal_notes'] = b.internalNotes;
      if (b.status !== undefined) patch['status'] = b.status;
      const [row] = await db.update<ScheduledActionRow>(SCHEDULED_ACTIONS, patch, { id: req.params.actionId, offer_id: req.params.id });
      await writeAudit(req, { action: 'offer.scheduled_action.update', entityType: 'offer_scheduled_actions', entityId: req.params.actionId, before, after: row });
      sendOk(res, toScheduledActionDTO(row ?? before));
    }),
  );

  r.delete('/:id/scheduled-actions/:actionId', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const n = await db.delete(SCHEDULED_ACTIONS, { id: req.params.actionId, offer_id: req.params.id });
    if (n === 0) throw notFound('Scheduled action not found');
    await writeAudit(req, { action: 'offer.scheduled_action.delete', entityType: 'offer_scheduled_actions', entityId: req.params.actionId });
    sendOk(res, { deleted: true });
  }));

  // --- History (read-only) — this offer's own create/update/delete/status-change trail from
  // audit_log (spec §4, §12). Sub-resource changes (creatives, geo-rules, …) have their own
  // entity_id and aren't included here — this mirrors "offer record" history, not every nested edit.
  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureOffer(db, req.params.id);
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'offer' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}

async function ensureOffer(db: ReturnType<typeof dbForRequest>, id: string | undefined): Promise<void> {
  if (!id) throw notFound('Offer not found');
  const offer = await db.selectOne<OfferRow>(OFFERS, { id });
  if (!offer) throw notFound('Offer not found');
}

/**
 * Portal offer reads. Owner-scoped. Advertisers see their own offers (revenue, not publisher
 * payout); publishers see offers they're granted (payout only, NEVER revenue). Both queries pin
 * network_id AND the caller's owner id explicitly (spec §3A).
 */
export function offerPortalRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const id = req.identity;
      if (!id || id.surface !== 'dashboard' || id.kind === 'admin') {
        throw forbidden('Portal access required.');
      }
      const { limit, offset } = res.locals.query as PaginationQuery;
      const ownerId = ownerIdOf(req);
      const networkId = id.networkId;

      if (id.kind === 'advertiser') {
        const { rows } = await query<OfferRow>(
          `SELECT * FROM offers WHERE network_id = $1 AND advertiser_id = $2
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
          [networkId, ownerId, limit, offset],
        );
        sendOk(res, rows.map(toAdvertiserDTO), { limit, offset });
        return;
      }

      // publisher: only offers with an approved 'allow' access grant; effective payout applied.
      const { rows } = await query<OfferRow & { effective_payout: string }>(
        `SELECT o.*, COALESCE(a.payout_override, o.default_payout) AS effective_payout
           FROM offer_publisher_access a
           JOIN offers o ON o.id = a.offer_id AND o.network_id = a.network_id
          WHERE a.network_id = $1 AND a.publisher_id = $2
            AND a.access = 'allow' AND a.approval_status = 'approved'
            AND o.status = 'active'
          ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
        [networkId, ownerId, limit, offset],
      );
      // Attach a ready-to-use tracking link (primary tracking domain + this publisher's id).
      const dom = await query<{ host: string }>(
        `SELECT host FROM tracking_domains WHERE network_id = $1 AND status = 'active'
          ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
        [networkId],
      );
      const host = dom.rows[0]?.host ?? null;
      const withLink = rows.map((row) => ({
        ...toPublisherDTO(row, row.effective_payout),
        trackingUrl: host ? `https://${host}/click?offer_id=${row.id}&pub_id=${ownerId}` : null,
      }));
      sendOk(res, withLink, { limit, offset });
    }),
  );

  return r;
}
