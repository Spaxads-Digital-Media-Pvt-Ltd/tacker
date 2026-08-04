/**
 * Advertiser Public API (spec §8A) — /api/v1/advertiser/*. Bound to ONE advertiser. Can read
 * their own offers/conversions and post conversions (S2S). NEVER sees other advertisers, publisher
 * payout, or network-wide data — enforced by owner-scoped queries + advertiser DTOs.
 */
import { Router } from 'express';
import { query } from '../../lib/db/pool.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateQuery } from '../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../lib/http/pagination.js';
import { badRequest, forbidden } from '../../lib/http/errors.js';
import { toAdvertiserDTO } from '../dashboard/offers/dto.js';
import type { OfferRow } from '../../domain/entities.js';
import { recordConversion } from '../tracking/conversions/record.js';
import { reportQuerySchema, buildReportRequest } from '../../lib/reporting/request.js';
import { getReportingProvider } from '../../lib/reporting/index.js';
import { requireScope, apiIdentity } from './auth.js';

export function advertiserApi(): Router {
  const r = Router();

  r.get(
    '/offers',
    requireScope('offers:read'),
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const { limit, offset } = res.locals.query as PaginationQuery;
      const { rows } = await query<OfferRow>(
        `SELECT * FROM offers WHERE network_id = $1 AND advertiser_id = $2
           ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [id.networkId, id.ownerId, limit, offset],
      );
      sendOk(res, rows.map(toAdvertiserDTO), { limit, offset });
    }),
  );

  r.get(
    '/conversions',
    requireScope('conversions:read'),
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const { limit, offset } = res.locals.query as PaginationQuery;
      // Advertiser sees their revenue (cost), status, txn — NOT publisher payout or publisher id.
      const { rows } = await query<{
        conversion_id: string; offer_id: string; status: string; event_name: string | null;
        revenue: string | null; currency: string | null; transaction_id: string | null; created_at: string;
      }>(
        `SELECT conversion_id, offer_id, status, event_name, revenue, currency, transaction_id, created_at
           FROM conversions WHERE network_id = $1 AND advertiser_id = $2
           ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [id.networkId, id.ownerId, limit, offset],
      );
      sendOk(res, rows.map((c) => ({
        conversionId: c.conversion_id, offerId: c.offer_id, status: c.status, event: c.event_name,
        revenue: c.revenue, currency: c.currency, transactionId: c.transaction_id, createdAt: c.created_at,
      })), { limit, offset });
    }),
  );

  // S2S conversion posting (spec §8A — advertiser conversion posting with idempotency).
  r.post(
    '/conversions',
    requireScope('conversions:write'),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const clickId = typeof b['click_id'] === 'string' ? b['click_id'] : null;
      if (!clickId) throw badRequest('click_id is required');
      // Idempotency-Key header or txn_id — both feed the dedup guard.
      const txnId = (typeof b['txn_id'] === 'string' ? b['txn_id'] : null) ?? req.header('idempotency-key') ?? null;

      // Ownership: the click's offer MUST belong to this advertiser (no posting for others' clicks).
      const { rows } = await query<{ advertiser_id: string | null }>(
        `SELECT o.advertiser_id FROM clicks c JOIN offers o ON o.id = c.offer_id
          WHERE c.click_id = $1 AND c.network_id = $2 LIMIT 1`,
        [clickId, id.networkId],
      );
      // If the click isn't persisted yet, recordConversion's Redis fast-path still attributes; but
      // for ownership we require the offer link — reject cross-advertiser posting when we can see it.
      if (rows[0] && rows[0].advertiser_id !== id.ownerId) {
        throw forbidden('This click does not belong to your offers.');
      }

      const result = await recordConversion({
        networkId: id.networkId,
        clickId,
        txnId,
        event: typeof b['event'] === 'string' ? b['event'] : null,
        statusHint: typeof b['status'] === 'string' ? b['status'] : 'approved',
        payoutParam: null, // advertiser never sets publisher payout
        revenueParam: null, // revenue comes from the frozen click/offer config
        secureCode: null,
        skipSecureCode: true, // this endpoint is already authenticated by API key
        source: 'postback',
        rawParams: b,
      });
      res.status(result.outcome === 'duplicate' ? 200 : 201);
      sendOk(res, { status: result.outcome, conversionId: result.conversionId ?? null });
    }),
  );

  // Stats scoped to THIS advertiser (revenue but no publisher payout).
  r.get(
    '/stats',
    requireScope('stats:read'),
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const request = buildReportRequest(id.networkId, res.locals.query, 'advertiser', { advertiserId: id.ownerId });
      sendOk(res, await getReportingProvider().runReport(request));
    }),
  );

  return r;
}
