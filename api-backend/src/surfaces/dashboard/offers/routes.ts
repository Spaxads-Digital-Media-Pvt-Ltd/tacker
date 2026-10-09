/**
 * Offers — Dashboard API routes (spec §1, §3A, §8A). Admin CRUD + nested geo-rules and
 * publisher-access, plus owner-scoped portal reads. Tenant integrity: any referenced
 * advertiser_id / offer_id / publisher_id is verified to belong to the caller's network before
 * use (FKs don't enforce tenant boundaries).
 */
import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { uploadPublicObject } from '../../../lib/storage/supabase-storage.js';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, entityListLimit, ENTITY_LIST_CAP, type PaginationQuery } from '../../../lib/http/pagination.js';
import { badRequest, notFound, forbidden } from '../../../lib/http/errors.js';
import { rejectMalformedIdParams } from '../../../lib/http/path-params.js';
import { dbForRequest, ownerIdOf } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { containsPattern } from '../../../lib/db/like.js';
import { writeAudit } from '../../../lib/audit.js';
import { idempotentCreate } from '../../../lib/http/idempotency.js';
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
import { mergeOfferMetadata } from '../../../lib/offer-settings/index.js';
import {
 createOfferSchema,
 updateOfferSchema,
 createGeoRuleSchema,
 updateGeoRuleSchema,
 createAccessSchema,
 updateAccessSchema,
 type CreateOffer,
 type UpdateOffer,
 type CreateGeoRule,
 type UpdateGeoRule,
 type CreateAccess,
} from './schemas.js';
import { requestAccessSchema } from './schemas.js';
import { createScheduledActionSchema, updateScheduledActionSchema, type CreateScheduledAction } from './asset-schemas.js';
import {
 toAdminDTO,
 toAdvertiserDTO,
 toPublisherDetailDTO,
 toPublisherDTO,
 toAdvertiserDetailDTO,
 toGeoRuleDTO,
 toOfferCountryDTO,
 toAccessDTO,
} from './dto.js';
import { env } from '../../../config/env.js';
import { mountOfferAssets } from './asset-routes.js';
import { attachTagRoutes } from '../tags/routes.js';
import { isPagedRequest, runPagedList } from '../../../lib/http/paged-list.js';
import { offerListQuerySchema, buildOfferListQuery, type OfferListQuery } from './list-query.js';

/** Paged Manage Offers row: the admin DTO plus the advertiser fields the table shows, joined in the
 * same query so a page never depends on the (capped) advertiser picker list. */
type PagedOfferRow = OfferRow & {
 advertiser_name: string | null; advertiser_ref: string | null;
 advertiser_account_manager_id: string | null; advertiser_sales_manager_id: string | null;
};
const toPagedOfferDTO = (row: PagedOfferRow) => ({
 ...toAdminDTO(row),
 advertiserName: row.advertiser_name,
 advertiserRef: row.advertiser_ref == null ? null : Number(row.advertiser_ref),
 advertiserAccountManagerId: row.advertiser_account_manager_id,
 advertiserSalesManagerId: row.advertiser_sales_manager_id,
});

const OFFERS = 'offers';
const GEO = 'offer_geo_rules';
const ACCESS = 'offer_publisher_access';
const SCHEDULED_ACTIONS = 'offer_scheduled_actions';
const THUMBNAIL_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

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
 rejectMalformedIdParams(r, 'id', 'accessId', 'actionId', 'ruleId', 'assetId');

 // Paged mode (`?paged=1`) for the Manage Offers page: filters/search/sort/paging in SQL, returns
 // { rows, total, page, pageSize, counts: { statuses } }. Any other caller (every offer picker)
 // falls through to the plain array below via next('route').
 r.get(
 '/',
 (req, _res, next) => next(isPagedRequest(req.query) ? undefined : 'route'),
 validateQuery(offerListQuerySchema),
 asyncHandler(async (req, res) => {
 const q = res.locals.query as OfferListQuery;
 const built = buildOfferListQuery(req.scope!.networkId, q);
 sendOk(res, await runPagedList(built, q, toPagedOfferDTO));
 }),
 );

 r.get(
 '/',
 validateQuery(paginationSchema),
 asyncHandler(async (req, res) => {
 const { offset } = res.locals.query as PaginationQuery;
 const limit = entityListLimit(req.query, res.locals.query as PaginationQuery);
 const db = dbForRequest(req);
 const [rows, total] = await Promise.all([
 db.selectMany<OfferRow>(OFFERS, { limit, offset, orderBy: 'created_at', maxLimit: ENTITY_LIST_CAP }),
 db.count(OFFERS),
 ]);
 sendOk(res, rows.map(toAdminDTO), { limit, offset, total });
 }),
 );

 // Bulk per-offer "effective allowed countries" for the Manage Offers list (Country filter +
 // Countries column). Collapses each offer's geo rules to an allow-list / deny-list the same way
 // tracking/geo-rules.ts evaluates them at click time — this is a read-only mirror, no enforcement.
 // Offers with no geo rules are omitted (caller treats "absent" as "allows every country").
 // Registered before /:id so "geo-rules" isn't captured as an offer id.
 r.get('/geo-rules', asyncHandler(async (req, res) => {
 const { rows } = await query<{
 offer_id: string; allow_countries: string[]; deny_countries: string[];
 wildcard_allow: boolean; wildcard_deny: boolean;
 }>(
 `SELECT offer_id,
 COALESCE(array_agg(country) FILTER (WHERE action = 'allow' AND country <> '*'), '{}') AS allow_countries,
 COALESCE(array_agg(country) FILTER (WHERE action = 'deny' AND country <> '*'), '{}') AS deny_countries,
 COALESCE(bool_or(country = '*' AND action = 'allow'), false) AS wildcard_allow,
 COALESCE(bool_or(country = '*' AND action = 'deny'), false) AS wildcard_deny
 FROM offer_geo_rules
 WHERE network_id = $1
 GROUP BY offer_id`,
 [req.scope!.networkId],
 );
 sendOk(res, rows.map(toOfferCountryDTO));
 }));

 // Complete option lists for the Manage Offers filters, independent of the (paged) list: every
 // category in use, every country named in a geo rule or targeting.country rule, every platform named
 // in a targeting.platform rule. Registered before /:id.
 r.get('/filter-options', asyncHandler(async (req, res) => {
 const nid = req.scope!.networkId;
 const [cats, geo, tgt, plat] = await Promise.all([
 query<{ v: string }>(
 `SELECT DISTINCT btrim(category) AS v FROM offers WHERE network_id = $1 AND category IS NOT NULL AND btrim(category) <> '' ORDER BY 1`,
 [nid],
 ),
 query<{ v: string }>(
 `SELECT DISTINCT upper(country) AS v FROM offer_geo_rules WHERE network_id = $1 AND country <> '*'`,
 [nid],
 ),
 query<{ v: string }>(
 `SELECT DISTINCT upper(tv.v) AS v
 FROM offers o, jsonb_array_elements_text(
 CASE WHEN jsonb_typeof(o.metadata->'targeting'->'country'->'values') = 'array'
 THEN o.metadata->'targeting'->'country'->'values' ELSE '[]'::jsonb END) AS tv(v)
 WHERE o.network_id = $1`,
 [nid],
 ),
 query<{ v: string }>(
 `SELECT DISTINCT tv.v AS v
 FROM offers o, jsonb_array_elements_text(
 CASE WHEN jsonb_typeof(o.metadata->'targeting'->'platform'->'values') = 'array'
 THEN o.metadata->'targeting'->'platform'->'values' ELSE '[]'::jsonb END) AS tv(v)
 WHERE o.network_id = $1`,
 [nid],
 ),
 ]);
 // Categories de-duplicated case-insensitively (first spelling wins), like the platform list.
 const ci = (vals: string[]) => Array.from(new Map(vals.filter(Boolean).map((v) => [v.toLowerCase(), v] as const)).values())
 .sort((a, b) => a.localeCompare(b));
 sendOk(res, {
 categories: ci(cats.rows.map((x) => x.v)),
 countries: Array.from(new Set([...geo.rows, ...tgt.rows].map((x) => x.v).filter((v) => /^[A-Z]{2}$/.test(v)))).sort(),
 platforms: ci(plat.rows.map((x) => x.v.trim())),
 });
 }));

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
 // Optional Idempotency-Key: a repeat of the same create (retry, resubmit, second tab) returns
 // the original offer instead of inserting another. Without the header nothing changes.
 const { result: row, replayed } = await idempotentCreate(req, 'offers:create', async () => {
 // Tenant integrity: advertiser must belong to this network.
 const adv = await db.selectOne<AdvertiserRow>('advertisers', { id: b.advertiserId });
 if (!adv) throw badRequest('advertiserId does not belong to this network');
 if (b.trackingDomainId) {
 const dom = await db.selectOne<{ status: string; verification_state: string; host: string }>('tracking_domains', { id: b.trackingDomainId });
 if (!dom) throw badRequest('trackingDomainId does not belong to this network');
 // /click only resolves active + verified hosts — any other domain would make every link dead.
 if (dom.status !== 'active' || dom.verification_state !== 'verified') throw badRequest(`Tracking domain ${dom.host} is not active and verified yet, so links on it would not work.`);
 }

 const created = await db.insert<OfferRow>(OFFERS, {
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
 ...(() => {
   const metadata = mergeOfferMetadata({}, b as Record<string, unknown>);
   return metadata ? { metadata } : {};
 })(),
 });
 await writeAudit(req, { action: 'offer.create', entityType: 'offer', entityId: created.id, after: created });
 return created;
 }, (id) => db.selectOne<OfferRow>(OFFERS, { id }));
 if (replayed) res.setHeader('Idempotent-Replayed', 'true');
 sendOk(res, toAdminDTO(row), undefined, 201);
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
 if (b.trackingDomainId && b.trackingDomainId !== before.tracking_domain_id) {
 const dom = await db.selectOne<{ status: string; verification_state: string; host: string }>('tracking_domains', { id: b.trackingDomainId });
 if (!dom) throw badRequest('trackingDomainId does not belong to this network');
 // /click only resolves active + verified hosts — switching to any other domain would make every link dead.
 if (dom.status !== 'active' || dom.verification_state !== 'verified') throw badRequest(`Tracking domain ${dom.host} is not active and verified yet, so links on it would not work.`);
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
 // Metadata-backed fields (notes, description, targeting, settings…) merge over existing keys.
 const metadata = mergeOfferMetadata(before.metadata, b as Record<string, unknown>);
 if (metadata) patch['metadata'] = metadata;
 if (Object.keys(patch).length === 0) { sendOk(res, toAdminDTO(before)); return; }
 const [row] = await db.update<OfferRow>(OFFERS, patch, { id: req.params.id });
 await writeAudit(req, { action: 'offer.update', entityType: 'offer', entityId: req.params.id, before, after: row });
 await invalidateOfferConfig(db.scope.networkId, req.params.id!);
 sendOk(res, toAdminDTO(row ?? before));
 }),
 );

 // Thumbnail upload — raw image body (≤2MB) → Supabase Storage (public bucket) → metadata.thumbnail_url.
 r.post(
 '/:id/thumbnail',
 requireRole('admin', 'manager'),
 express.raw({ type: Object.keys(THUMBNAIL_TYPES), limit: '2mb' }),
 asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 const before = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
 if (!before) throw notFound('Offer not found');
 const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
 const ext = THUMBNAIL_TYPES[type];
 if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
 throw badRequest('Upload a PNG, JPEG, WebP or GIF image up to 2 MB');
 }
 let url: string;
 try {
 url = await uploadPublicObject('offer-thumbnails', `${db.scope.networkId}/${before.id}/${randomUUID()}.${ext}`, req.body, type);
 } catch (e) {
 throw badRequest(e instanceof Error ? e.message : 'Upload failed');
 }
 const [row] = await db.update<OfferRow>(OFFERS, { metadata: { ...(before.metadata ?? {}), thumbnail_url: url } }, { id: before.id });
 await writeAudit(req, { action: 'offer.update', entityType: 'offer', entityId: before.id, before, after: row });
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
 sendOk(res, toAdminDTO(copy), undefined, 201);
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

 // offer_geo_rules has a unique index (offer_id, country, COALESCE(region, '')).
 // Use a NOT EXISTS subquery so that when the target already has a geo rule for the same
 // country/region as the source, the target's existing row is preserved and the source's
 // row is silently skipped. This avoids a 500 on a normal "copy settings" operation while
 // never destroying existing target configuration.
 const copyGeoRules = async (): Promise<number> => {
 const { rowCount } = await query(
 `INSERT INTO ${GEO} (network_id, offer_id, country, region, action, payout_override, revenue_override, destination_override)
 SELECT src.network_id, $2, src.country, src.region, src.action, src.payout_override, src.revenue_override, src.destination_override
 FROM ${GEO} src
 WHERE src.network_id = $1 AND src.offer_id = $3
 AND NOT EXISTS (
   SELECT 1 FROM ${GEO} tgt
   WHERE tgt.network_id = $1 AND tgt.offer_id = $2
     AND tgt.country = src.country
     AND COALESCE(tgt.region, '') = COALESCE(src.region, '')
 )`,
 [networkId, target.id, src.id],
 );
 return rowCount;
 };

 const result: { copied: boolean; targetOfferId: string; geoRulesInserted?: number } = {
 copied: true, targetOfferId: target.id,
 };

 if (opts.includeCreatives) await copyTable('offer_creatives', 'name, type, url, html, width, height, language, status');
 if (opts.includeCustomSettings) {
 result.geoRulesInserted = await copyGeoRules();
 await query(
 `INSERT INTO offer_custom_settings (network_id, offer_id, category, name, partner_ids, description, public_description, status, ref, partner_id, apply_all_partners, effective_from, effective_to, targeting, apply_custom_payout, payout_model, payout_value, apply_custom_revenue, revenue_model, revenue_value, goal_id, fire_partner_postback, caps, conversion_status, throttle_rate, set_parameter_goal, landing_page_url, creative_type, creative_url, creative_thumbnail_url, email_from, email_subject)
 SELECT network_id, $2, category, name, partner_ids, description, public_description, status, ref, partner_id, apply_all_partners, effective_from, effective_to, targeting, apply_custom_payout, payout_model, payout_value, apply_custom_revenue, revenue_model, revenue_value, goal_id, fire_partner_postback, caps, conversion_status, throttle_rate, set_parameter_goal, landing_page_url, creative_type, creative_url, creative_thumbnail_url, email_from, email_subject
 FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $3`,
 [networkId, target.id, src.id],
 );
 }
 if (opts.includeForwardingRules) await copyTable('offer_forwarding_rules', 'name, partner_ids, offer_urls, destination, countries, status');
 // Copied geo rules feed the target's cached click config.
 await invalidateOfferConfig(networkId, target.id);

 await writeAudit(req, { action: 'offer.copy_settings_to', entityType: 'offer', entityId: target.id, after: { sourceOfferId: src.id, ...opts } });
 sendOk(res, result);
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
 sendOk(res, toGeoRuleDTO(row), undefined, 201);
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

 r.patch(
 '/:id/geo-rules/:ruleId',
 requireRole('admin', 'manager'),
 validateBody(updateGeoRuleSchema),
 asyncHandler(async (req, res) => {
  const db = dbForRequest(req);
  const before = await db.selectOne<OfferGeoRuleRow>(GEO, { id: req.params.ruleId, offer_id: req.params.id });
  if (!before) throw notFound('Geo rule not found');
  const b = req.body as UpdateGeoRule;
  const patch: Record<string, unknown> = {};
  if (b.country !== undefined) patch['country'] = b.country.toUpperCase();
  if (b.region !== undefined) patch['region'] = b.region;
  if (b.action !== undefined) patch['action'] = b.action;
  if (b.payoutOverride !== undefined) patch['payout_override'] = b.payoutOverride;
  if (b.revenueOverride !== undefined) patch['revenue_override'] = b.revenueOverride;
  if (b.destinationOverride !== undefined) patch['destination_override'] = b.destinationOverride;
  if (Object.keys(patch).length === 0) throw badRequest('No fields to update');
  const [row] = await db.update<OfferGeoRuleRow>(GEO, patch, { id: req.params.ruleId, offer_id: req.params.id });
  await writeAudit(req, { action: 'offer.geo_rule.update', entityType: 'offer_geo_rule', entityId: req.params.ruleId, before, after: row });
  await invalidateOfferConfig(db.scope.networkId, req.params.id!);
  sendOk(res, toGeoRuleDTO(row ?? before));
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

 // Upsert: granting access to a partner who already has a row (e.g. their own pending request)
 // updates that row instead of failing on the (offer_id, publisher_id) unique key.
 const { rows: upserted } = await query<OfferPublisherAccessRow>(
 `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status, payout_override)
 VALUES ($1, $2, $3, $4, $5, $6)
 ON CONFLICT (offer_id, publisher_id) DO UPDATE
 SET access = EXCLUDED.access, approval_status = EXCLUDED.approval_status,
 payout_override = EXCLUDED.payout_override, updated_at = now()
 WHERE offer_publisher_access.network_id = EXCLUDED.network_id
 RETURNING *`,
 [db.scope.networkId, req.params.id, b.publisherId, b.access, b.approvalStatus, b.payoutOverride ?? null],
 );
 const row = upserted[0];
 if (!row) throw notFound('Access entry not found');
 await writeAudit(req, { action: 'offer.access.create', entityType: 'offer_publisher_access', entityId: row.id, after: row });
 await invalidateOfferConfig(db.scope.networkId, req.params.id!); // block/allow takes effect on next click
 sendOk(res, toAccessDTO(row), undefined, 201);
 }),
 );

 r.patch(
 '/:id/publishers/:accessId',
 requireRole('admin', 'manager'),
 validateBody(updateAccessSchema),
 asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 const b = req.body as z.infer<typeof updateAccessSchema>;
 const patch: Record<string, unknown> = {};
 if (b.access !== undefined) patch['access'] = b.access;
 if (b.approvalStatus !== undefined) patch['approval_status'] = b.approvalStatus;
 if (b.payoutOverride !== undefined) patch['payout_override'] = b.payoutOverride;
 const [row] = await db.update<OfferPublisherAccessRow>(ACCESS, patch, { id: req.params.accessId, offer_id: req.params.id });
 if (!row) throw notFound('Access entry not found');
 await writeAudit(req, { action: 'offer.access.update', entityType: 'offer_publisher_access', entityId: row.id, after: row });
 await invalidateOfferConfig(db.scope.networkId, req.params.id!); // deny list + partner payout are cached for /click
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
 sendOk(res, toScheduledActionDTO(row), undefined, 201);
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

const offerPortalFilterSchema = z.object({
 q: z.string().max(200).optional(),
 status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
 visibility: z.enum(['public', 'private', 'ask']).optional(),
});

const offerPortalPaginationSchema = paginationSchema.extend(offerPortalFilterSchema.shape);

// ---- Partner-portal offer visibility (used by list + detail; $1 = network, $2 = publisher) ----
const PORTAL_JOINS = `LEFT JOIN offer_publisher_access a
 ON a.offer_id = o.id AND a.network_id = o.network_id AND a.publisher_id = $2
 LEFT JOIN tracking_domains td
 ON td.id = o.tracking_domain_id AND td.network_id = o.network_id AND td.status = 'active'`;
/** Hide offers this partner was denied/rejected on; a still-pending request stays visible. */
const PORTAL_NOT_DENIED = `NOT COALESCE(a.access = 'deny' AND a.approval_status <> 'pending', false)`;
const PORTAL_VISIBLE = `(o.visibility IN ('public', 'ask') OR (o.visibility = 'private' AND a.access = 'allow' AND a.approval_status = 'approved'))`;
type PortalOfferRow = OfferRow & { effective_payout: string; access: string | null; approval_status: string | null; offer_host: string | null };

/** A partner may send traffic to a public offer, or to any offer they're approved on. */
function portalCanRun(row: PortalOfferRow): boolean {
 if (row.access === 'allow' && row.approval_status === 'approved') return true;
 return row.visibility === 'public' && row.access !== 'deny';
}

async function primaryTrackingHost(networkId: string): Promise<string | null> {
 const { rows } = await query<{ host: string }>(
 `SELECT host FROM tracking_domains WHERE network_id = $1 AND status = 'active'
 ORDER BY is_primary DESC, created_at ASC LIMIT 1`, [networkId]);
 return rows[0]?.host ?? null;
}

async function offerTrackingHost(networkId: string, trackingDomainId: string | null): Promise<string | null> {
 if (!trackingDomainId) return null;
 const { rows } = await query<{ host: string }>(
 `SELECT host FROM tracking_domains WHERE id = $1 AND network_id = $2 AND status = 'active'`, [trackingDomainId, networkId]);
 return rows[0]?.host ?? null;
}

/** Tracking link on the offer's own domain (local dev hosts point at the tracking server port). */
function portalClickUrl(host: string | null, offerId: string, pubId: string | null): string | null {
 if (!host) return null;
 const base = /^(localhost|127\.0\.0\.1)$/i.test(host) ? `http://${host}:${env.PORT_TRACKING}` : `https://${host}`;
 return `${base}/click?offer_id=${offerId}${pubId ? `&pub_id=${pubId}` : ''}`;
}

export function offerPortalRoutes(): Router {
 const r = Router();
 rejectMalformedIdParams(r, 'id');

 r.get(
 '/',
 validateQuery(offerPortalPaginationSchema),
 asyncHandler(async (req, res) => {
 const id = req.identity;
 if (!id || id.surface !== 'dashboard' || id.kind === 'admin') {
 throw forbidden('Portal access required.');
 }
 const { limit, offset } = res.locals.query as PaginationQuery;
 const ownerId = ownerIdOf(req);
 const networkId = id.networkId;
 // The zod-validated copy (enums checked, single strings) — never the raw req.query.
 const filter = res.locals.query as z.infer<typeof offerPortalPaginationSchema>;

 if (id.kind === 'advertiser') {
 const where = ['network_id = $1', 'advertiser_id = $2'];
 const params: (string | number)[] = [networkId, ownerId];
 if (filter.q) {
 const next = params.length + 1;
 where.push(`name ILIKE $${next} ESCAPE '\\'`);
 params.push(containsPattern(filter.q));
 }
 if (filter.status) {
 const next = params.length + 1;
 where.push(`status = $${next}`);
 params.push(filter.status);
 }
 const whereClause = where.join(' AND ');
 const [{ rows: data }, { rows: countRows }] = await Promise.all([
 query<OfferRow>(`SELECT * FROM offers WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
 query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM offers WHERE ${whereClause}`, params),
 ]);
 sendOk(res, data.map(toAdvertiserDTO), { limit, offset, total: Number(countRows[0]?.count ?? 0) });
 return;
 }

 // publisher: ACTIVE public + ask (can request) + approved private offers, minus any this partner
 // is denied/rejected on (a pending request stays visible); effective payout applied. LEFT JOIN so
 // public offers show without an access row.
 const where = ['o.network_id = $1', "o.status = 'active'", PORTAL_NOT_DENIED];
 const params: (string | number)[] = [networkId, ownerId];
 if (filter.q) {
 const next = params.length + 1;
 where.push(`o.name ILIKE $${next} ESCAPE '\\'`);
 params.push(containsPattern(filter.q));
 }
 if (filter.status) {
 const next = params.length + 1;
 where.push(`o.status = $${next}`);
 params.push(filter.status);
 }
 if (filter.visibility) {
 const next = params.length + 1;
 where.push(`o.visibility = $${next}`);
 params.push(filter.visibility);
 }
 const whereClause = where.join(' AND ');

 const [{ rows }, { rows: countRows }] = await Promise.all([
 query<PortalOfferRow>(
 `SELECT o.*, COALESCE(a.payout_override, o.default_payout) AS effective_payout,
 a.access, a.approval_status, td.host AS offer_host
 FROM offers o ${PORTAL_JOINS}
 WHERE ${whereClause} AND ${PORTAL_VISIBLE}
 ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
 [...params, limit, offset],
 ),
 query<{ count: string }>(
 `SELECT COUNT(*)::text AS count FROM offers o ${PORTAL_JOINS}
 WHERE ${whereClause} AND ${PORTAL_VISIBLE}`,
 params,
 ),
 ]);

 const primary = await primaryTrackingHost(networkId);
 const withLink = rows.map((row) => ({
 ...toPublisherDTO(row, row.effective_payout),
 trackingUrl: portalCanRun(row) ? portalClickUrl(row.offer_host ?? primary, row.id, ownerId) : null,
 access: row.access as 'allow' | 'deny' | 'pending',
 approvalStatus: row.approval_status as 'approved' | 'pending' | 'rejected',
 }));
 sendOk(res, withLink, { limit, offset, total: Number(countRows[0]?.count ?? 0) });
 }),
 );

 r.get(
 '/:id',
 asyncHandler(async (req, res) => {
 const id = req.identity;
 if (!id || id.surface !== 'dashboard' || id.kind === 'admin') {
 throw forbidden('Portal access required.');
 }
 const ownerId = ownerIdOf(req);
 const networkId = id.networkId;

 if (id.kind === 'advertiser') {
 const { rows } = await query<OfferRow>(
 `SELECT * FROM offers WHERE network_id = $1 AND advertiser_id = $2 AND id = $3`,
 [networkId, ownerId, req.params.id],
 );
 if (!rows[0]) throw notFound('Offer not found');
 const host = (await offerTrackingHost(networkId, rows[0].tracking_domain_id)) ?? await primaryTrackingHost(networkId);
 sendOk(res, toAdvertiserDetailDTO(rows[0], portalClickUrl(host, rows[0].id, null)));
 return;
 }

 // publisher: same visibility rules as the list; attach access + effective payout
 const { rows } = await query<PortalOfferRow>(
 `SELECT o.*, COALESCE(a.payout_override, o.default_payout) AS effective_payout,
 a.access, a.approval_status, td.host AS offer_host
 FROM offers o ${PORTAL_JOINS}
 WHERE o.network_id = $1 AND o.id = $3 AND o.status = 'active' AND ${PORTAL_NOT_DENIED} AND ${PORTAL_VISIBLE}`,
 [networkId, ownerId, req.params.id],
 );
 if (!rows[0]) throw notFound('Offer not found');
 const row = rows[0];
 const host = row.offer_host ?? await primaryTrackingHost(networkId);
 sendOk(res, toPublisherDetailDTO(row, row.effective_payout, row.access as 'allow' | 'deny' | null, row.approval_status as 'approved' | 'pending' | 'rejected' | null,
 portalCanRun(row) ? portalClickUrl(host, row.id, ownerId) : null));
 }),
 );

 r.post(
 '/:id/request',
 validateBody(requestAccessSchema),
 asyncHandler(async (req, res) => {
 const id = req.identity;
 if (!id || id.surface !== 'dashboard' || id.kind !== 'publisher') {
 throw forbidden('Publisher access required.');
 }
 const ownerId = ownerIdOf(req);
 const networkId = id.networkId;
 const b = req.body as z.infer<typeof requestAccessSchema>;
 const offerId = req.params.id!;

 const offer = await query<{ id: string }>(
 `SELECT id FROM offers WHERE network_id = $1 AND id = $2 AND visibility = 'ask' AND status = 'active'`,
 [networkId, offerId],
 );
 if (!offer.rows[0]) throw notFound('Offer not found or not open for requests');

 // Idempotent: if a pending request already exists, return it
 const existing = await query<{ id: string; access: string; approval_status: string }>(
 `SELECT id, access, approval_status FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3`,
 [networkId, offerId, ownerId],
 );
 if (existing.rows[0]) {
 sendOk(res, { access: existing.rows[0].access, approvalStatus: existing.rows[0].approval_status, requestExists: true });
 return;
 }

 // A pending request must not run traffic: it stays blocked ('deny') until an admin approves it
 // (Offer Applications → approve sets access='allow'). The body's `access` is ignored on purpose.
 void b;
 const row = await query<{ id: string }>(
 `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
 VALUES ($1, $2, $3, 'deny', 'pending') RETURNING id`,
 [networkId, offerId, ownerId],
 );
 await invalidateOfferConfig(networkId, offerId);
 await writeAudit(req, { action: 'offer.access.request', entityType: 'offer_publisher_access', entityId: row.rows[0]!.id, after: { offerId } });
 sendOk(res, { access: 'deny', approvalStatus: 'pending' }, undefined, 201);
 }),
 );

 r.delete(
 '/:id/request',
 asyncHandler(async (req, res) => {
 const id = req.identity;
 if (!id || id.surface !== 'dashboard' || id.kind !== 'publisher') {
 throw forbidden('Publisher access required.');
 }
 const ownerId = ownerIdOf(req);
 const networkId = id.networkId;
 const offerId = req.params.id!;

 const n = await query<{ n: string }>(
 `DELETE FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3 AND approval_status = 'pending'
 RETURNING 1`,
 [networkId, offerId, ownerId],
 );
 if (!n.rows[0]) throw notFound('No pending request found');
 await invalidateOfferConfig(networkId, offerId);
 await writeAudit(req, { action: 'offer.access.withdraw', entityType: 'offer_publisher_access', entityId: offerId, after: { publisherId: ownerId } });
 sendOk(res, { withdrawn: true });
 }),
 );

 return r;
}
