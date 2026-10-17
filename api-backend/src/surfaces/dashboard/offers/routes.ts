/**
 * Offers — Dashboard API routes (spec §1, §3A, §8A). Admin CRUD + nested geo-rules and
 * publisher-access, plus owner-scoped portal reads. Tenant integrity: any referenced
 * advertiser_id / offer_id / publisher_id is verified to belong to the caller's network before
 * use (FKs don't enforce tenant boundaries).
 */
import express, { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { uploadPublicObject } from '../../../lib/storage/supabase-storage.js';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, entityListLimit, ENTITY_LIST_CAP, type PaginationQuery } from '../../../lib/http/pagination.js';
import { badRequest, notFound, forbidden, conflict, validationFailed } from '../../../lib/http/errors.js';
import { queryBool } from '../../../lib/http/query-params.js';
import { rejectMalformedIdParams } from '../../../lib/http/path-params.js';
import { dbForRequest, ownerIdOf } from '../../../lib/db/from-request.js';
import { query, pool } from '../../../lib/db/pool.js';
import type { PoolClient } from 'pg';
import { containsPattern } from '../../../lib/db/like.js';
import { writeAudit } from '../../../lib/audit.js';
import { teamMembersByLogin, memberLabel, type TeamMember } from '../../../lib/auth/team-members.js';
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
import { offerStatusChanged, offerAccessChanged } from '../../../lib/email/notifications.js';
import { generateSecureCode } from '../../../lib/security-code.js';
import { mergeOfferMetadata, type OfferTargeting } from '../../../lib/offer-settings/index.js';
import { offerConfigWarnings } from '../../../lib/offer-settings/warnings.js';
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
 scheduledActionParams, validateScheduledAction, scheduledActionDtoExtras, type ScheduledActionParams,
} from '../../../lib/automation/scheduled-actions.js';
import { tierAutoApproves } from '../../../lib/partner-tiers.js';
import { sendTransactional, networkName } from '../../../lib/email/transactional.js';
import { offerDetailsEmail } from '../../../lib/email/templates.js';
import {
 toAdminDTO,
 withOfferSecrets,
 OFFER_SECRET_ROLES,
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

/** May this caller see offers' postback security codes? (O5: roles that manage integrations.) */
const seesOfferSecrets = (req: Request): boolean => {
 const id = req.identity;
 return !!id && id.surface === 'dashboard' && id.kind === 'admin' && OFFER_SECRET_ROLES.includes(id.role);
};
/** The admin DTO for this caller — the security code masked for finance / read-only (O5). */
const offerDtoFor = (req: Request) => (row: OfferRow) => withOfferSecrets(toAdminDTO(row), seesOfferSecrets(req));

const deleteOfferQuery = z.object({ hard: queryBool });

/** Run `fn` in one pg transaction (rolled back on any error). */
async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
 const client = await pool.connect();
 try {
 await client.query('BEGIN');
 const out = await fn(client);
 await client.query('COMMIT');
 return out;
 } catch (err) {
 await client.query('ROLLBACK');
 throw err;
 } finally {
 client.release();
 }
}

/** Copy one offer's child rows (`cols`) onto another offer of the same network. */
async function copyOfferRows(client: PoolClient, table: string, cols: string, networkId: string, fromOfferId: string, toOfferId: string): Promise<void> {
 await client.query(
 `INSERT INTO ${table} (network_id, offer_id, ${cols})
 SELECT network_id, $2, ${cols} FROM ${table} WHERE network_id = $1 AND offer_id = $3`,
 [networkId, toOfferId, fromOfferId],
 );
}

/**
 * offer_custom_settings columns a copy carries — the v2 schema (migration 1700000054000; event/value
 * are gone). Never `ref` (bigserial: each row gets its own display ref) or ids/timestamps. Shared by
 * Copy Offer and Copy Offer Settings so both copy exactly the same thing (F-11).
 */
const CUSTOM_SETTING_COPY_COLS = [
 'category', 'name', 'partner_ids', 'description', 'public_description', 'status', 'partner_id', 'apply_all_partners',
 'effective_from', 'effective_to', 'targeting', 'apply_custom_payout', 'payout_model', 'payout_value',
 'apply_custom_revenue', 'revenue_model', 'revenue_value', 'fire_partner_postback', 'caps', 'conversion_status',
 'throttle_rate', 'set_parameter_goal', 'landing_page_url', 'creative_type', 'creative_url', 'creative_thumbnail_url',
 'email_from', 'email_subject',
].join(', ');

/**
 * Copy an offer's custom settings onto another offer (deleted ones stay behind). goal_id points at the
 * SOURCE offer's goals, so it's re-pointed to the destination's goal with the same name + event
 * (Copy Offer copies goals first), else cleared — never left pointing at another offer's goal.
 */
async function copyCustomSettings(client: PoolClient, networkId: string, fromOfferId: string, toOfferId: string): Promise<void> {
 await client.query(
 `INSERT INTO offer_custom_settings (network_id, offer_id, ${CUSTOM_SETTING_COPY_COLS}, goal_id)
 SELECT s.network_id, $2, ${CUSTOM_SETTING_COPY_COLS.split(', ').map((c) => `s.${c}`).join(', ')},
 (SELECT tg.id FROM offer_goals sg
 JOIN offer_goals tg ON tg.network_id = sg.network_id AND tg.offer_id = $2
 AND tg.name = sg.name AND tg.event_name IS NOT DISTINCT FROM sg.event_name
 WHERE sg.id = s.goal_id
 ORDER BY tg.created_at LIMIT 1)
 FROM offer_custom_settings s
 WHERE s.network_id = $1 AND s.offer_id = $3 AND s.status <> 'deleted'`,
 [networkId, toOfferId, fromOfferId],
 );
}

/**
 * What a hard delete of this offer would orphan or cascade away (F-09): its clicks and conversions,
 * the ledger entries behind those conversions (the ledger references conversions, which are kept
 * while ledgered), and its reporting adjustments. Empty = the offer never ran.
 */
async function offerHistory(networkId: string, offerId: string): Promise<string[]> {
 const { rows } = await query<{ clicks: boolean; conversions: boolean; ledger: boolean; adjustments: boolean }>(
 `SELECT EXISTS (SELECT 1 FROM clicks WHERE network_id = $1 AND offer_id = $2) AS clicks,
 EXISTS (SELECT 1 FROM conversions WHERE network_id = $1 AND offer_id = $2) AS conversions,
 EXISTS (SELECT 1 FROM ledger_entries l
 JOIN conversions c ON c.network_id = l.network_id AND c.conversion_id = l.conversion_id
 WHERE l.network_id = $1 AND c.offer_id = $2) AS ledger,
 EXISTS (SELECT 1 FROM reporting_adjustments WHERE network_id = $1 AND offer_id = $2) AS adjustments`,
 [networkId, offerId],
 );
 const r = rows[0];
 return r ? (['clicks', 'conversions', 'ledger', 'adjustments'] as const).filter((k) => r[k]) : [];
}
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
 params?: ScheduledActionParams | null; executed_at?: string | null; result?: unknown;
}
const toScheduledActionDTO = (r: ScheduledActionRow, creators?: Map<string, TeamMember>) => ({
 id: r.id, actionType: r.action_type, partnerIds: r.partner_ids, event: r.event,
 scheduledTime: r.scheduled_time, internalNotes: r.internal_notes, createdBy: r.created_by,
 // N2: who created it, by name — `createdBy` is their login id.
 createdByName: r.created_by ? memberLabel(creators?.get(r.created_by)) : null,
 status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
 ...scheduledActionDtoExtras(r),
});
const scheduledActionDTOs = async (networkId: string, rows: ScheduledActionRow[]) => {
 const creators = await teamMembersByLogin(networkId, rows.map((r) => r.created_by));
 return rows.map((r) => toScheduledActionDTO(r, creators));
};

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
 sendOk(res, await runPagedList(built, q, (row: PagedOfferRow) => withOfferSecrets(toPagedOfferDTO(row), seesOfferSecrets(req))));
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
 sendOk(res, rows.map(offerDtoFor(req)), { limit, offset, total });
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

 // "Share Offer(s) Details" (Table Actions) — emails the partner the offers' details (name, payout,
 // preview, their tracking link) — "Offer Details Shared" system email (F-24) — and records an audit
 // entry per offer (who shared what with which partner, and when). Registered before /:id.
 r.post('/share-details', requireRole('admin', 'manager'), validateBody(shareDetailsSchema), asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 const b = req.body as z.infer<typeof shareDetailsSchema>;
 const pub = await db.selectOne<PublisherRow>('publishers', { id: b.publisherId });
 if (!pub) throw badRequest('publisherId does not belong to this network');
 const networkId = db.scope.networkId;
 const fallbackHost = await primaryTrackingHost(networkId);
 const shared: { ref: number | null; name: string; payout: string | null; currency: string | null; previewUrl: string | null; trackingLink: string | null }[] = [];
 for (const offerId of b.offerIds) {
 const offer = await db.selectOne<OfferRow>(OFFERS, { id: offerId });
 if (!offer) continue;
 // This partner's own payout on the offer when they have one, else the offer default.
 const own = (await query<{ p: string | null }>(
 `SELECT payout_override::text AS p FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3`,
 [networkId, offerId, pub.id])).rows[0]?.p;
 const host = (await offerTrackingHost(networkId, offer.tracking_domain_id)) ?? fallbackHost;
 shared.push({
 ref: offer.ref != null ? Number(offer.ref) : null, name: offer.name, payout: own ?? offer.default_payout,
 currency: offer.currency, previewUrl: offer.preview_url ?? null, trackingLink: portalClickUrl(host, offerId, pub.id),
 });
 await writeAudit(req, {
 action: 'offer.share_details', entityType: 'offer', entityId: offerId,
 after: { publisherId: pub.id, publisherName: pub.name },
 });
 }
 const email = shared.length
 ? await sendTransactional(networkId, 'offer_details_shared', [pub.contact_email],
 offerDetailsEmail({ networkName: await networkName(networkId), partnerName: pub.name, offers: shared }))
 : null;
 sendOk(res, { shared: true, count: b.offerIds.length, publisherName: pub.name, email });
 }));

 r.get(
 '/:id',
 asyncHandler(async (req, res) => {
 const row = await dbForRequest(req).selectOne<OfferRow>(OFFERS, { id: req.params.id });
 if (!row) throw notFound('Offer not found');
 // Settings that contradict each other so the offer can't get traffic (lib/offer-settings/warnings.ts).
 const [geo, approved] = await Promise.all([
 query<{ country: string; region: string | null; action: string }>(
 'SELECT country, region, action FROM offer_geo_rules WHERE network_id = $1 AND offer_id = $2', [row.network_id, row.id]),
 query<{ n: number }>(
 `SELECT COUNT(*)::int AS n FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2 AND access = 'allow' AND approval_status = 'approved'`,
 [row.network_id, row.id]),
 ]);
 const configWarnings = offerConfigWarnings({
 status: row.status, visibility: row.visibility ?? null, approvedPartners: approved.rows[0]?.n ?? 0,
 allowedTrafficTypes: row.allowed_traffic_types ?? null,
 targeting: (row.metadata as { targeting?: OfferTargeting } | null)?.targeting ?? null, geoRules: geo.rows,
 });
 sendOk(res, { ...offerDtoFor(req)(row), configWarnings });
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
 cap_timezone: b.capTimezone ?? null,
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
 sendOk(res, offerDtoFor(req)(row), undefined, 201);
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
 dailyClickCap: 'daily_click_cap', capTimezone: 'cap_timezone', attributionWindowS: 'attribution_window_s',
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
 if (Object.keys(patch).length === 0) { sendOk(res, offerDtoFor(req)(before)); return; }
 const [row] = await db.update<OfferRow>(OFFERS, patch, { id: req.params.id });
 await writeAudit(req, { action: 'offer.update', entityType: 'offer', entityId: req.params.id, before, after: row });
 await invalidateOfferConfig(db.scope.networkId, req.params.id!);
 // Live again / paused → Partner Offer Now Available / Unavailable to its partners (O11).
 if (b.status !== undefined) offerStatusChanged(db.scope.networkId, before.id, before.status, b.status);
 sendOk(res, offerDtoFor(req)(row ?? before));
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
 sendOk(res, offerDtoFor(req)(row ?? before));
 }),
 );

 // Delete (F-09). A hard DELETE cascades the offer's goals, geo rules, partner access, creatives,
 // coupons, smart-link items, tier links, traffic blocking AND reporting adjustments (financial
 // records), and orphans its clicks/conversions/ledger (no FK), so reports show raw ids. So an offer
 // with tracking history is ARCHIVED instead: status 'archived' stops it at /click (only 'active'
 // runs), hides it from portals, and keeps every record and its name in reports. Only an offer with
 // no history can really be removed: an unused draft on a plain DELETE, or any unused offer with
 // ?hard=true — which answers 409 when there is history (same style as the advertiser-delete guard).
 r.delete(
 '/:id',
 requireRole('admin'),
 validateQuery(deleteOfferQuery),
 asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 const before = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
 if (!before) throw notFound('Offer not found');
 const hard = (res.locals.query as z.infer<typeof deleteOfferQuery>).hard === true;
 const history = await offerHistory(db.scope.networkId, before.id);

 if (history.length === 0 && (hard || before.status === 'draft')) {
 await db.delete(OFFERS, { id: before.id });
 await writeAudit(req, { action: 'offer.delete', entityType: 'offer', entityId: before.id, before });
 await invalidateOfferConfig(db.scope.networkId, before.id);
 sendOk(res, { deleted: true, archived: false });
 return;
 }
 if (hard) throw conflict(`This offer has tracking history (${history.join(', ')}); archive it instead.`);

 const [row] = await db.update<OfferRow>(OFFERS, { status: 'archived' }, { id: before.id });
 await writeAudit(req, { action: 'offer.archive', entityType: 'offer', entityId: before.id, before, after: row });
 await invalidateOfferConfig(db.scope.networkId, before.id);
 offerStatusChanged(db.scope.networkId, before.id, before.status, 'archived');
 sendOk(res, { deleted: false, archived: true, offer: offerDtoFor(req)(row ?? before) });
 }),
 );

 // --- Duplicate ("Copy Offer") — clones the offer row. Goals/coupons/deals/tags always come
 // along (base config, not user-optional in the reference either); creatives, forwarding rules,
 // partner visibility, and custom settings/geo-rules are gated by the caller's checkboxes. New
 // name gets a " (copy)" suffix, same convention as the reference. The copy starts as a DRAFT (a
 // brand-new offer shouldn't go live just because its source was), and the whole copy is ONE
 // transaction: a failure part-way leaves no half-copied offer behind (F-11). ---
 r.post('/:id/duplicate', requireRole('admin', 'manager'), validateBody(duplicateOptionsSchema), asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 const src = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
 if (!src) throw notFound('Offer not found');
 const opts = req.body as z.infer<typeof duplicateOptionsSchema>;
 const networkId = db.scope.networkId;

 const copy = await inTransaction(async (client) => {
 const { rows } = await client.query<OfferRow>(
 `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, payout_model, default_payout,
 default_revenue, currency, daily_conversion_cap, total_conversion_cap, daily_click_cap, cap_timezone, attribution_window_s,
 dedup_window_s, allowed_traffic_types, fallback_url, objective, visibility, category, preview_url,
 tracking_domain_id, metadata)
 SELECT network_id, advertiser_id, name || ' (copy)', 'draft', destination_url, payout_model, default_payout,
 default_revenue, currency, daily_conversion_cap, total_conversion_cap, daily_click_cap, cap_timezone, attribution_window_s,
 dedup_window_s, allowed_traffic_types, fallback_url, objective, visibility, category, preview_url,
 tracking_domain_id,
 -- The copy is its own offer (O7): it keeps every setting but not the offer-feed link, or the next
 -- feed sync would update the copy instead of the original.
 COALESCE(metadata, '{}'::jsonb) - 'feedExternalId' - 'feedSource'
 FROM offers WHERE network_id = $1 AND id = $2
 RETURNING *`,
 [networkId, src.id],
 );
 const created = rows[0]!;
 const copyTable = (table: string, cols: string) => copyOfferRows(client, table, cols, networkId, src.id, created.id);
 // Always copied — base config, not gated by a checkbox in the reference either.
 await copyTable('offer_goals', 'name, event_name, payout_model, payout, revenue, currency, daily_conversion_cap, total_conversion_cap, duplicate_mode, is_default, status, sort_order');
 await copyTable('offer_coupons', 'code, publisher_id, description, discount, status, starts_at, ends_at');
 await copyTable('offer_deals', 'name, description, deal_type, value, status, starts_at, ends_at');
 await client.query(
 `INSERT INTO taggings (network_id, tag_id, entity_type, entity_id)
 SELECT network_id, tag_id, 'offer', $2 FROM taggings WHERE network_id = $1 AND entity_type = 'offer' AND entity_id = $3`,
 [networkId, created.id, src.id],
 );

 if (opts.includeCreatives) await copyTable('offer_creatives', 'name, type, url, html, width, height, language, status');
 if (opts.includeCustomSettings) {
 await copyTable(GEO, 'country, region, action, payout_override, revenue_override, destination_override');
 await copyCustomSettings(client, networkId, src.id, created.id);
 }
 if (opts.includePartnerVisibility) await copyTable(ACCESS, 'publisher_id, access, approval_status, payout_override');
 if (opts.includeForwardingRules) await copyTable('offer_forwarding_rules', 'name, partner_ids, offer_urls, destination, countries, status');
 return created;
 });

 await writeAudit(req, { action: 'offer.duplicate', entityType: 'offer', entityId: copy.id, after: copy });
 sendOk(res, offerDtoFor(req)(copy), undefined, 201);
 }));

 // --- "Copy Offer Settings" — same idea as duplicate, but onto an EXISTING offer instead of a
 // new one (appends, doesn't replace the target's existing rows). "Include Offer URLs" has no
 // equivalent concept here (same reason as Copy Offer), so it's accepted but ignored server-side
 // too — the frontend disables that checkbox. One transaction, like duplicate (F-11).
 r.post('/:id/copy-settings-to', requireRole('admin', 'manager'), validateBody(copySettingsSchema), asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 const src = await db.selectOne<OfferRow>(OFFERS, { id: req.params.id });
 if (!src) throw notFound('Offer not found');
 const opts = req.body as z.infer<typeof copySettingsSchema>;
 const target = await db.selectOne<OfferRow>(OFFERS, { id: opts.targetOfferId });
 if (!target) throw badRequest('targetOfferId does not belong to this network');
 const networkId = db.scope.networkId;

 const result: { copied: boolean; targetOfferId: string; geoRulesInserted?: number } = {
 copied: true, targetOfferId: target.id,
 };
 await inTransaction(async (client) => {
 const copyTable = (table: string, cols: string) => copyOfferRows(client, table, cols, networkId, src.id, target.id);
 if (opts.includeCreatives) await copyTable('offer_creatives', 'name, type, url, html, width, height, language, status');
 if (opts.includeCustomSettings) {
 // offer_geo_rules has a unique index (offer_id, country, COALESCE(region, '')).
 // Use a NOT EXISTS subquery so that when the target already has a geo rule for the same
 // country/region as the source, the target's existing row is preserved and the source's
 // row is silently skipped. This avoids a 500 on a normal "copy settings" operation while
 // never destroying existing target configuration.
 const { rowCount } = await client.query(
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
 result.geoRulesInserted = rowCount ?? 0;
 await copyCustomSettings(client, networkId, src.id, target.id);
 }
 if (opts.includeForwardingRules) await copyTable('offer_forwarding_rules', 'name, partner_ids, offer_urls, destination, countries, status');
 });
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

 const previous = await db.selectOne<OfferPublisherAccessRow>(ACCESS, { offer_id: req.params.id, publisher_id: b.publisherId });
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
 // Given access → Partner Offer Now Available; blocked → Now Unavailable (O11).
 offerAccessChanged(db.scope.networkId, req.params.id!, [b.publisherId], previous ?? null, row);
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
 const previous = await db.selectOne<OfferPublisherAccessRow>(ACCESS, { id: req.params.accessId, offer_id: req.params.id });
 const [row] = await db.update<OfferPublisherAccessRow>(ACCESS, patch, { id: req.params.accessId, offer_id: req.params.id });
 if (!row) throw notFound('Access entry not found');
 await writeAudit(req, { action: 'offer.access.update', entityType: 'offer_publisher_access', entityId: row.id, after: row });
 await invalidateOfferConfig(db.scope.networkId, req.params.id!); // deny list + partner payout are cached for /click
 offerAccessChanged(db.scope.networkId, req.params.id!, [row.publisher_id], previous ?? null, row);
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
 sendOk(res, await scheduledActionDTOs(db.scope.networkId, rows));
 }));

 r.post(
 '/:id/scheduled-actions',
 requireRole('admin', 'manager'),
 validateBody(createScheduledActionSchema),
 asyncHandler(async (req, res) => {
 const db = dbForRequest(req);
 await ensureOffer(db, req.params.id);
 const b = req.body as CreateScheduledAction;
 // F-17a: the worker runs pending actions, so they must be runnable (cap_change has its cap, partners exist).
 const params = scheduledActionParams(b);
 if (b.status === 'pending') {
 const problem = await validateScheduledAction(db.scope.networkId, { actionType: b.actionType, partnerIds: b.partnerIds, params });
 if (problem) throw validationFailed(problem);
 }
 const row = await db.insert<ScheduledActionRow>(SCHEDULED_ACTIONS, {
 offer_id: req.params.id,
 action_type: b.actionType,
 partner_ids: JSON.stringify(b.partnerIds),
 params: JSON.stringify(params),
 event: b.event ?? null,
 scheduled_time: b.scheduledTime ?? null,
 internal_notes: b.internalNotes ?? null,
 created_by: actorLabel(req),
 status: b.status,
 });
 await writeAudit(req, { action: 'offer.scheduled_action.create', entityType: 'offer_scheduled_actions', entityId: row.id, after: row });
 sendOk(res, (await scheduledActionDTOs(db.scope.networkId, [row]))[0], undefined, 201);
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
 const params = scheduledActionParams(b, before.params ?? {});
 if ((b.status ?? before.status) === 'pending') {
 const problem = await validateScheduledAction(db.scope.networkId, {
 actionType: b.actionType ?? before.action_type, partnerIds: b.partnerIds ?? before.partner_ids, params,
 });
 if (problem) throw validationFailed(problem);
 }
 const patch: Record<string, unknown> = {};
 if (b.actionType !== undefined) patch['action_type'] = b.actionType;
 if (b.partnerIds !== undefined) patch['partner_ids'] = JSON.stringify(b.partnerIds);
 if (b.event !== undefined) patch['event'] = b.event;
 if (b.scheduledTime !== undefined) patch['scheduled_time'] = b.scheduledTime;
 if (b.internalNotes !== undefined) patch['internal_notes'] = b.internalNotes;
 if (b.status !== undefined) patch['status'] = b.status;
 if (b.capType !== undefined || b.capValue !== undefined) patch['params'] = JSON.stringify(params);
 // Back to pending = run again: forget the previous run.
 if (b.status === 'pending' && before.status !== 'pending') { patch['executed_at'] = null; patch['result'] = null; }
 const [row] = await db.update<ScheduledActionRow>(SCHEDULED_ACTIONS, patch, { id: req.params.actionId, offer_id: req.params.id });
 await writeAudit(req, { action: 'offer.scheduled_action.update', entityType: 'offer_scheduled_actions', entityId: req.params.actionId, before, after: row });
 sendOk(res, (await scheduledActionDTOs(db.scope.networkId, [row ?? before]))[0]);
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
 // Partner Tiers (F-17b): a member of an active tier linked to this offer with "auto-approve
 // partners" is approved straight away.
 void b;
 const auto = await tierAutoApproves(networkId, offerId, ownerId);
 const access = auto ? 'allow' : 'deny';
 const approvalStatus = auto ? 'approved' : 'pending';
 const row = await query<{ id: string }>(
 `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
 [networkId, offerId, ownerId, access, approvalStatus],
 );
 await invalidateOfferConfig(networkId, offerId);
 await writeAudit(req, {
 action: auto ? 'offer.access.auto_approve' : 'offer.access.request',
 entityType: 'offer_publisher_access', entityId: row.rows[0]!.id, after: { offerId, ...(auto ? { by: 'partner_tier' } : {}) },
 });
 sendOk(res, { access, approvalStatus }, undefined, 201);
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
