/**
 * Publisher Public API (spec §8A) — /api/v1/publisher/*. Bound to ONE publisher. Sees only their
 * own offers/clicks/conversions/earnings. NEVER other publishers, advertiser-identifying data, or
 * revenue/margin — publishers see PAYOUT, never revenue.
 */
import { Router } from 'express';
import { query } from '../../lib/db/pool.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateQuery } from '../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../lib/http/pagination.js';
import { toPublisherDTO } from '../dashboard/offers/dto.js';
import type { OfferRow } from '../../domain/entities.js';
import { accountBalance } from '../../lib/ledger/ledger.js';
import { reportQuerySchema, buildReportRequest } from '../../lib/reporting/request.js';
import { getReportingProvider } from '../../lib/reporting/index.js';
import { requireScope, apiIdentity } from './auth.js';

export function publisherApi(): Router {
  const r = Router();

  r.get(
    '/offers',
    requireScope('offers:read'),
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const { limit, offset } = res.locals.query as PaginationQuery;
      const { rows } = await query<OfferRow & { effective_payout: string }>(
        `SELECT o.*, COALESCE(a.payout_override, o.default_payout) AS effective_payout
           FROM offer_publisher_access a
           JOIN offers o ON o.id = a.offer_id AND o.network_id = a.network_id
          WHERE a.network_id = $1 AND a.publisher_id = $2
            AND a.access = 'allow' AND a.approval_status = 'approved' AND o.status = 'active'
          ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
        [id.networkId, id.ownerId, limit, offset],
      );
      sendOk(res, rows.map((row) => toPublisherDTO(row, row.effective_payout)), { limit, offset });
    }),
  );

  r.get(
    '/conversions',
    requireScope('conversions:read'),
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const { limit, offset } = res.locals.query as PaginationQuery;
      // Payout only — NO revenue field is selected or returned.
      const { rows } = await query<{
        conversion_id: string; offer_id: string; status: string; event_name: string | null;
        payout: string | null; currency: string | null; created_at: string;
      }>(
        `SELECT conversion_id, offer_id, status, event_name, payout, currency, created_at
           FROM conversions WHERE network_id = $1 AND publisher_id = $2
           ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [id.networkId, id.ownerId, limit, offset],
      );
      sendOk(res, rows.map((c) => ({
        conversionId: c.conversion_id, offerId: c.offer_id, status: c.status, event: c.event_name,
        payout: c.payout, currency: c.currency, createdAt: c.created_at,
      })), { limit, offset });
    }),
  );

  r.get(
    '/earnings',
    requireScope('earnings:read'),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const balance = await accountBalance(id.networkId, 'publisher', id.ownerId, 'approved');
      const { rows } = await query<{
        entry_type: string; direction: string; amount: string; currency: string; status: string; created_at: string;
      }>(
        `SELECT entry_type, direction, amount, currency, status, created_at
           FROM ledger_entries
          WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2
          ORDER BY created_at DESC LIMIT 200`,
        [id.networkId, id.ownerId],
      );
      sendOk(res, {
        balance,
        statement: rows.map((e) => ({
          type: e.entry_type, direction: e.direction, amount: e.amount,
          currency: e.currency, status: e.status, createdAt: e.created_at,
        })),
      });
    }),
  );

  // Stats scoped to THIS publisher (payout only — no revenue/margin).
  r.get(
    '/stats',
    requireScope('stats:read'),
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const request = buildReportRequest(id.networkId, res.locals.query, 'publisher', { publisherId: id.ownerId });
      sendOk(res, await getReportingProvider().runReport(request));
    }),
  );

  return r;
}
