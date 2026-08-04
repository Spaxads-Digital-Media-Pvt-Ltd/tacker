/**
 * Network/Admin Public API (spec §8A) — /api/v1/network/*. Full network-level programmatic
 * access (the Everflow admin-key equivalent). Still tenant-bound: a network key can never reach
 * another network's data. Sees margin/revenue (unlike the publisher key).
 */
import { Router } from 'express';
import { query } from '../../lib/db/pool.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateQuery } from '../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../lib/http/pagination.js';
import { toAdminDTO } from '../dashboard/offers/dto.js';
import type { OfferRow } from '../../domain/entities.js';
import { createPayoutRun } from '../../lib/ledger/ledger.js';
import { reportQuerySchema, buildReportRequest } from '../../lib/reporting/request.js';
import { getReportingProvider } from '../../lib/reporting/index.js';
import { requireScope, apiIdentity } from './auth.js';

export function networkApi(): Router {
  const r = Router();

  const list = (table: 'offers' | 'publishers' | 'advertisers', scope: string, map: (row: never) => unknown) =>
    [
      requireScope(scope),
      validateQuery(paginationSchema),
      asyncHandler(async (req: import('express').Request, res: import('express').Response) => {
        const id = apiIdentity(req);
        const { limit, offset } = res.locals.query as PaginationQuery;
        const { rows } = await query(
          `SELECT * FROM ${table} WHERE network_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [id.networkId, limit, offset],
        );
        sendOk(res, rows.map(map as (row: unknown) => unknown), { limit, offset });
      }),
    ] as const;

  r.get('/offers', ...list('offers', 'offers:read', (o: OfferRow) => toAdminDTO(o)));
  r.get('/publishers', ...list('publishers', 'publishers:read',
    (p: { id: string; name: string; status: string }) => ({ id: p.id, name: p.name, status: p.status })));
  r.get('/advertisers', ...list('advertisers', 'advertisers:read',
    (a: { id: string; name: string; status: string }) => ({ id: a.id, name: a.name, status: a.status })));

  // Network-wide report summary (last 30d) — includes margin (revenue − payout). Full grouped
  // reporting is Phase 5; this is the API-key summary.
  r.get(
    '/reports/summary',
    requireScope('reports:read'),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const clicks = (await query<{ n: string }>(
        `SELECT COUNT(*)::text n FROM clicks WHERE network_id = $1 AND created_at >= now() - interval '30 days'`,
        [id.networkId],
      )).rows[0]!.n;
      const conv = (await query<{ n: string; payout: string; revenue: string }>(
        `SELECT COUNT(*)::text n,
                COALESCE(SUM(payout),0)::text payout, COALESCE(SUM(revenue),0)::text revenue
           FROM conversions
          WHERE network_id = $1 AND status = 'approved' AND created_at >= now() - interval '30 days'`,
        [id.networkId],
      )).rows[0]!;
      const margin = (Number(conv.revenue) - Number(conv.payout)).toFixed(4);
      sendOk(res, {
        windowDays: 30, clicks: Number(clicks), conversions: Number(conv.n),
        payout: conv.payout, revenue: conv.revenue, margin,
      });
    }),
  );

  // Full grouped report (network audience → all metrics incl. margin).
  r.get(
    '/reports',
    requireScope('reports:read'),
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const request = buildReportRequest(id.networkId, res.locals.query, 'network');
      sendOk(res, await getReportingProvider().runReport(request));
    }),
  );

  // Trigger a payout run (payouts:write). Reuses the ledger service.
  r.post(
    '/payouts',
    requireScope('payouts:write'),
    asyncHandler(async (req, res) => {
      const id = apiIdentity(req);
      const b = (req.body ?? {}) as { publisherIds?: string[]; note?: string };
      const result = await createPayoutRun(id.networkId, {
        ...(b.publisherIds ? { publisherIds: b.publisherIds } : {}),
        ...(b.note ? { note: b.note } : {}),
        createdBy: `apikey:${id.keyId}`,
      });
      res.status(201);
      sendOk(res, result);
    }),
  );

  return r;
}
