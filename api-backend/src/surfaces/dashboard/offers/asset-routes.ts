/**
 * Offer sub-entity routes (goals, creatives, coupons, deals) mounted under /api/offers/:id/*.
 * Factored through one generic nested-collection builder so every asset gets consistent
 * list/create/patch/delete + tenant integrity + audit, without five copies of the same CRUD.
 * Tenant scoping is structural (ScopedDb injects network_id); the offer is verified to belong to
 * the caller's network before any nested write (FKs don't enforce tenant boundaries — spec §3A).
 */
import { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
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
} from './asset-schemas.js';

type Db = ReturnType<typeof dbForRequest>;
interface Row { id: string; [k: string]: unknown; }

async function ensureOffer(db: Db, id: string | undefined): Promise<void> {
  if (!id) throw notFound('Offer not found');
  const offer = await db.selectOne('offers', { id });
  if (!offer) throw notFound('Offer not found');
}

/** Map a validated (camelCase) body onto snake_case columns, keeping only defined keys. */
function toColumns(body: Record<string, unknown>, colMap: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(colMap)) {
    const v = body[camel];
    if (v !== undefined) out[snake] = v;
  }
  return out;
}

interface AssetSpec {
  collection: string;                 // URL segment
  table: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  colMap: Record<string, string>;     // camelCase body key -> snake_case column
  dto: (row: Row) => unknown;
  auditKind: string;                  // e.g. 'goal'
  invalidateCache?: boolean;          // goals affect payout resolution → bust the offer cache
  beforeWrite?: (db: Db, offerId: string, body: Record<string, unknown>) => Promise<void>;
}

function mountAsset(r: Router, spec: AssetSpec): void {
  const base = `/:id/${spec.collection}`;

  r.get(base, asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureOffer(db, req.params.id);
    const rows = await db.selectMany<Row>(spec.table, { where: { offer_id: req.params.id }, limit: 1000, orderBy: 'created_at' });
    sendOk(res, rows.map(spec.dto));
  }));

  r.post(base, requireRole('admin', 'manager'), validateBody(spec.createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensureOffer(db, req.params.id);
    const body = req.body as Record<string, unknown>;
    if (spec.beforeWrite) await spec.beforeWrite(db, req.params.id!, body);
    const row = await db.insert<Row>(spec.table, { offer_id: req.params.id, ...toColumns(body, spec.colMap) });
    await writeAudit(req, { action: `offer.${spec.auditKind}.create`, entityType: spec.table, entityId: row.id, after: row });
    if (spec.invalidateCache) await invalidateOfferConfig(db.scope.networkId, req.params.id!);
    res.status(201);
    sendOk(res, spec.dto(row));
  }));

  r.patch(`${base}/:assetId`, requireRole('admin', 'manager'), validateBody(spec.updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(spec.table, { id: req.params.assetId, offer_id: req.params.id });
    if (!before) throw notFound(`${spec.auditKind} not found`);
    const body = req.body as Record<string, unknown>;
    if (spec.beforeWrite) await spec.beforeWrite(db, req.params.id!, body);
    const [row] = await db.update<Row>(spec.table, toColumns(body, spec.colMap), { id: req.params.assetId, offer_id: req.params.id });
    await writeAudit(req, { action: `offer.${spec.auditKind}.update`, entityType: spec.table, entityId: req.params.assetId, before, after: row });
    if (spec.invalidateCache) await invalidateOfferConfig(db.scope.networkId, req.params.id!);
    sendOk(res, spec.dto(row ?? before));
  }));

  r.delete(`${base}/:assetId`, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const n = await db.delete(spec.table, { id: req.params.assetId, offer_id: req.params.id });
    if (n === 0) throw notFound(`${spec.auditKind} not found`);
    await writeAudit(req, { action: `offer.${spec.auditKind}.delete`, entityType: spec.table, entityId: req.params.assetId });
    if (spec.invalidateCache) await invalidateOfferConfig(db.scope.networkId, req.params.id!);
    sendOk(res, { deleted: true });
  }));
}

// ── DTOs ────────────────────────────────────────────────────────────────────
const goalDTO = (r: Row) => ({
  id: r.id, name: r.name, eventName: r.event_name, payoutModel: r.payout_model,
  payout: r.payout, revenue: r.revenue, currency: r.currency,
  dailyConversionCap: r.daily_conversion_cap, totalConversionCap: r.total_conversion_cap,
  isDefault: r.is_default, status: r.status, sortOrder: r.sort_order,
});
const creativeDTO = (r: Row) => ({
  id: r.id, name: r.name, type: r.type, url: r.url, html: r.html,
  width: r.width, height: r.height, language: r.language, status: r.status,
});
const couponDTO = (r: Row) => ({
  id: r.id, code: r.code, publisherId: r.publisher_id, description: r.description,
  discount: r.discount, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at,
});
const dealDTO = (r: Row) => ({
  id: r.id, name: r.name, description: r.description, dealType: r.deal_type,
  value: r.value, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at,
});

/** Register all offer asset collections onto the offers admin router. */
export function mountOfferAssets(r: Router): void {
  mountAsset(r, {
    collection: 'goals', table: 'offer_goals',
    createSchema: createGoalSchema, updateSchema: updateGoalSchema,
    colMap: {
      name: 'name', eventName: 'event_name', payoutModel: 'payout_model', payout: 'payout',
      revenue: 'revenue', currency: 'currency', dailyConversionCap: 'daily_conversion_cap',
      totalConversionCap: 'total_conversion_cap', isDefault: 'is_default', status: 'status', sortOrder: 'sort_order',
    },
    dto: goalDTO, auditKind: 'goal', invalidateCache: true,
    // Enforce a single default goal per offer: clear the others when this one is marked default.
    beforeWrite: async (db, offerId, body) => {
      if (body['isDefault'] === true) {
        await db.update('offer_goals', { is_default: false }, { offer_id: offerId, is_default: true });
      }
    },
  });

  mountAsset(r, {
    collection: 'creatives', table: 'offer_creatives',
    createSchema: createCreativeSchema, updateSchema: updateCreativeSchema,
    colMap: { name: 'name', type: 'type', url: 'url', html: 'html', width: 'width', height: 'height', language: 'language', status: 'status' },
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
}
