/**
 * Offer sub-entity routes (goals, creatives, coupons, deals) mounted under /api/offers/:id/*.
 * Factored through one generic nested-collection builder so every asset gets consistent
 * list/create/patch/delete + tenant integrity + audit, without five copies of the same CRUD.
 * Tenant scoping is structural (ScopedDb injects network_id); the offer is verified to belong to
 * the caller's network before any nested write (FKs don't enforce tenant boundaries — spec §3A).
 */
import { Router, type Request } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound, badRequest, conflict } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { invalidateOfferConfig } from '../../tracking/offer-cache.js';
import { requireRole } from '../auth.js';
import type { PublisherRow } from '../../../domain/entities.js';
import {
  createGoalSchema, updateGoalSchema,
  createCreativeSchema, updateCreativeSchema,
  createCouponSchema, updateCouponSchema,
  createDealSchema, updateDealSchema,
  createForwardingRuleSchema, updateForwardingRuleSchema,
  createOfferPostbackSchema, updateOfferPostbackSchema, POSTBACK_LEVELS,
} from './asset-schemas.js';

type Db = ReturnType<typeof dbForRequest>;
export interface Row { id: string; [k: string]: unknown; }

async function ensureOffer(db: Db, id: string | undefined): Promise<void> {
  if (!id) throw notFound('Offer not found');
  const offer = await db.selectOne('offers', { id });
  if (!offer) throw notFound('Offer not found');
}

/** Map a validated (camelCase) body onto snake_case columns, keeping only defined keys.
 * `jsonCols` (snake_case) get JSON.stringify'd — `pg` doesn't auto-serialize arrays/objects for
 * jsonb columns. */
function toColumns(body: Record<string, unknown>, colMap: Record<string, string>, jsonCols: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(colMap)) {
    const v = body[camel];
    if (v !== undefined) out[snake] = jsonCols.includes(snake) ? JSON.stringify(v) : v;
  }
  return out;
}

export interface AssetSpec {
  collection: string;                 // URL segment
  table: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  colMap: Record<string, string>;     // camelCase body key -> snake_case column
  jsonCols?: string[];                // snake_case columns that are jsonb arrays/objects
  dto: (row: Row) => unknown;
  auditKind: string;                  // e.g. 'goal'
  invalidateCache?: boolean;          // goals affect payout resolution → bust the offer cache
  beforeWrite?: (db: Db, offerId: string, body: Record<string, unknown>) => Promise<void>;
  /** Allow-listed exact-match list filters: query param → snake_case column + its allowed values
   * (e.g. ?level=event). An empty param is ignored; any other value outside `values` is a 400. */
  listFilters?: Record<string, { column: string; values: readonly [string, ...string[]] }>;
  /** Readable 409 message when a write hits one of the table's unique indexes. */
  uniqueMessage?: string;
}

async function withUniqueMessage<T>(spec: AssetSpec, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (spec.uniqueMessage && (err as { code?: string })?.code === '23505') throw conflict(spec.uniqueMessage);
    throw err;
  }
}

/**
 * The write half of an asset collection, callable outside the /api/offers/:id/* router (Advertiser
 * Details → Events writes offer goals through these). Callers must already have verified that the
 * offer is in the caller's network; the ScopedDb still pins network_id on every statement.
 */
export async function createAsset(req: Request, spec: AssetSpec, offerId: string, body: Record<string, unknown>): Promise<Row> {
  const db = dbForRequest(req);
  if (spec.beforeWrite) await spec.beforeWrite(db, offerId, body);
  const row = await withUniqueMessage(spec, () => db.insert<Row>(spec.table, { offer_id: offerId, ...toColumns(body, spec.colMap, spec.jsonCols) }));
  await writeAudit(req, { action: `offer.${spec.auditKind}.create`, entityType: spec.table, entityId: row.id, after: row });
  if (spec.invalidateCache) await invalidateOfferConfig(db.scope.networkId, offerId);
  return row;
}

export async function updateAsset(req: Request, spec: AssetSpec, offerId: string, assetId: string, body: Record<string, unknown>): Promise<Row> {
  const db = dbForRequest(req);
  const before = await db.selectOne<Row>(spec.table, { id: assetId, offer_id: offerId });
  if (!before) throw notFound(`${spec.auditKind} not found`);
  if (spec.beforeWrite) await spec.beforeWrite(db, offerId, body);
  const [row] = await withUniqueMessage(spec, () => db.update<Row>(spec.table, toColumns(body, spec.colMap, spec.jsonCols), { id: assetId, offer_id: offerId }));
  await writeAudit(req, { action: `offer.${spec.auditKind}.update`, entityType: spec.table, entityId: assetId, before, after: row });
  if (spec.invalidateCache) await invalidateOfferConfig(db.scope.networkId, offerId);
  return row ?? before;
}

export async function deleteAsset(req: Request, spec: AssetSpec, offerId: string, assetId: string): Promise<void> {
  const db = dbForRequest(req);
  const n = await db.delete(spec.table, { id: assetId, offer_id: offerId });
  if (n === 0) throw notFound(`${spec.auditKind} not found`);
  await writeAudit(req, { action: `offer.${spec.auditKind}.delete`, entityType: spec.table, entityId: assetId });
  if (spec.invalidateCache) await invalidateOfferConfig(db.scope.networkId, offerId);
}

function mountAsset(r: Router, spec: AssetSpec): void {
  const base = `/:id/${spec.collection}`;
  const filters = Object.entries(spec.listFilters ?? {});
  const listQuery = z.object(Object.fromEntries(filters.map(([param, f]) => [
    param, z.preprocess((v) => (v === '' ? undefined : v), z.enum(f.values).optional()),
  ])));

  r.get(base, validateQuery(listQuery), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureOffer(db, req.params.id);
    const where: Record<string, unknown> = { offer_id: req.params.id };
    const q = res.locals.query as Record<string, string | undefined>;
    for (const [param, f] of filters) {
      const v = q[param];
      if (v) where[f.column] = v;
    }
    const rows = await db.selectMany<Row>(spec.table, { where, limit: LIST_CAP, maxLimit: LIST_CAP, orderBy: 'created_at' });
    warnIfCapped(rows, LIST_CAP, `offer-assets.${spec.collection}`);
    sendOk(res, rows.map(spec.dto));
  }));

  r.post(base, requireRole('admin', 'manager'), validateBody(spec.createSchema), asyncHandler(async (req, res) => {
    await ensureOffer(dbForRequest(req), req.params.id);
    const row = await createAsset(req, spec, req.params.id!, req.body as Record<string, unknown>);
    sendOk(res, spec.dto(row), undefined, 201);
  }));

  r.patch(`${base}/:assetId`, requireRole('admin', 'manager'), validateBody(spec.updateSchema), asyncHandler(async (req, res) => {
    const row = await updateAsset(req, spec, req.params.id!, req.params.assetId!, req.body as Record<string, unknown>);
    sendOk(res, spec.dto(row));
  }));

  r.delete(`${base}/:assetId`, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    await deleteAsset(req, spec, req.params.id!, req.params.assetId!);
    sendOk(res, { deleted: true });
  }));
}

// ── DTOs ────────────────────────────────────────────────────────────────────
export const goalDTO = (r: Row) => ({
  id: r.id, name: r.name, eventName: r.event_name, payoutModel: r.payout_model,
  payout: r.payout, revenue: r.revenue, currency: r.currency,
  dailyConversionCap: r.daily_conversion_cap, totalConversionCap: r.total_conversion_cap,
  isDefault: r.is_default, status: r.status, sortOrder: r.sort_order,
});

/** Offer goals ("events" in the reference's vocabulary) — shared by /api/offers/:id/goals and
 * /api/advertisers/:id/events so both write through identical rules. */
export const GOAL_ASSET: AssetSpec = {
  collection: 'goals', table: 'offer_goals',
  createSchema: createGoalSchema, updateSchema: updateGoalSchema,
  colMap: {
    name: 'name', eventName: 'event_name', payoutModel: 'payout_model', payout: 'payout',
    revenue: 'revenue', currency: 'currency', dailyConversionCap: 'daily_conversion_cap',
    totalConversionCap: 'total_conversion_cap', isDefault: 'is_default', status: 'status', sortOrder: 'sort_order',
  },
  dto: goalDTO, auditKind: 'goal', invalidateCache: true,
  uniqueMessage: 'This offer already has a goal/event with that event name.',
  // Enforce a single default goal per offer: clear the others when this one is marked default.
  beforeWrite: async (db, offerId, body) => {
    if (body['isDefault'] === true) {
      await db.update('offer_goals', { is_default: false }, { offer_id: offerId, is_default: true });
    }
  },
};
const creativeDTO = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, type: r.type, url: r.url, html: r.html,
  width: r.width, height: r.height, language: r.language, status: r.status,
  visibleToPartners: r.visible_to_partners, emailFrom: r.email_from, emailSubject: r.email_subject,
  offerId: r.offer_id, createdAt: r.created_at, updatedAt: r.updated_at,
});
const couponDTO = (r: Row) => ({
  id: r.id, code: r.code, publisherId: r.publisher_id, description: r.description,
  discount: r.discount, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at,
});
const dealDTO = (r: Row) => ({
  id: r.id, name: r.name, description: r.description, dealType: r.deal_type,
  value: r.value, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at,
});
const forwardingRuleDTO = (r: Row) => ({
  id: r.id, name: r.name, partnerIds: r.partner_ids, offerUrls: r.offer_urls,
  destination: r.destination, countries: r.countries, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const offerPostbackDTO = (r: Row) => ({
  id: r.id, publisherId: r.publisher_id, url: r.url, method: r.method, event: r.event,
  level: r.level, status: r.status, createdAt: r.created_at,
});

/** Register all offer asset collections onto the offers admin router. */
export function mountOfferAssets(r: Router): void {
  mountAsset(r, GOAL_ASSET);

  mountAsset(r, {
    collection: 'creatives', table: 'offer_creatives',
    createSchema: createCreativeSchema, updateSchema: updateCreativeSchema,
    colMap: {
      name: 'name', type: 'type', url: 'url', html: 'html', width: 'width', height: 'height', language: 'language',
      status: 'status', visibleToPartners: 'visible_to_partners', emailFrom: 'email_from', emailSubject: 'email_subject',
    },
    dto: creativeDTO, auditKind: 'creative',
  });

  mountAsset(r, {
    collection: 'coupons', table: 'offer_coupons',
    createSchema: createCouponSchema, updateSchema: updateCouponSchema,
    colMap: { code: 'code', publisherId: 'publisher_id', description: 'description', discount: 'discount', status: 'status', startsAt: 'starts_at', endsAt: 'ends_at' },
    dto: couponDTO, auditKind: 'coupon',
    // If a coupon is pinned to a publisher, that publisher must belong to this network.
    beforeWrite: async (db, _offerId, body) => {
      const pid = body['publisherId'];
      if (typeof pid === 'string') {
        const pub = await db.selectOne<PublisherRow>('publishers', { id: pid });
        if (!pub) throw badRequest('publisherId does not belong to this network');
      }
    },
  });

  mountAsset(r, {
    collection: 'deals', table: 'offer_deals',
    createSchema: createDealSchema, updateSchema: updateDealSchema,
    colMap: { name: 'name', description: 'description', dealType: 'deal_type', value: 'value', status: 'status', startsAt: 'starts_at', endsAt: 'ends_at' },
    dto: dealDTO, auditKind: 'deal',
  });

  mountAsset(r, {
    collection: 'forwarding-rules', table: 'offer_forwarding_rules',
    createSchema: createForwardingRuleSchema, updateSchema: updateForwardingRuleSchema,
    colMap: {
      name: 'name', partnerIds: 'partner_ids', offerUrls: 'offer_urls',
      destination: 'destination', countries: 'countries', status: 'status',
    },
    jsonCols: ['partner_ids', 'offer_urls', 'countries'],
    dto: forwardingRuleDTO, auditKind: 'forwarding_rule',
  });

  mountAsset(r, {
    collection: 'postbacks', table: 'publisher_postbacks',
    createSchema: createOfferPostbackSchema, updateSchema: updateOfferPostbackSchema,
    colMap: { publisherId: 'publisher_id', url: 'url', method: 'method', event: 'event', level: 'level', status: 'status' },
    dto: offerPostbackDTO, auditKind: 'postback', listFilters: { level: { column: 'level', values: POSTBACK_LEVELS } },
    // The partner (publisher) a postback is scoped to must belong to this network.
    beforeWrite: async (db, _offerId, body) => {
      const pid = body['publisherId'];
      if (typeof pid === 'string') {
        const pub = await db.selectOne<PublisherRow>('publishers', { id: pid });
        if (!pub) throw badRequest('publisherId does not belong to this network');
      }
    },
  });
}
