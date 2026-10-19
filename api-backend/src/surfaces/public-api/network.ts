/**
 * Network/Admin Public API (spec §8A) — /api/v1/network/*. Full network-level programmatic
 * access (the Everflow admin-key equivalent). Still tenant-bound: a network key can never reach
 * another network's data. Sees margin/revenue (unlike the publisher key).
 */
import { Router } from 'express';
import { query } from '../../lib/db/pool.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { forbidden, validationFailed } from '../../lib/http/errors.js';
import { validateQuery } from '../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../lib/http/pagination.js';
import { toNetworkApiDTO } from '../dashboard/offers/dto.js';
import type { OfferRow } from '../../domain/entities.js';
import { createPayoutRun } from '../../lib/ledger/ledger.js';
import { CURRENCY_RE } from '../../lib/money.js';
import { reportQuerySchema, buildReportRequest } from '../../lib/reporting/request.js';
import { getReportingProvider } from '../../lib/reporting/index.js';
import { attachLabels } from '../../lib/reporting/labels.js';
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

 // Offers go through the API-key DTO: the admin DTO's postback securityCode never leaves the dashboard.
 r.get('/offers', ...list('offers', 'offers:read', (o: OfferRow) => toNetworkApiDTO(o)));
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
 // Money stays exact (O9): the margin is computed by Postgres's numeric, not as JS floats.
 const conv = (await query<{ n: string; payout: string; revenue: string; margin: string }>(
 `SELECT COUNT(*)::text n,
 COALESCE(SUM(payout),0)::text payout, COALESCE(SUM(revenue),0)::text revenue,
 (COALESCE(SUM(revenue),0) - COALESCE(SUM(payout),0))::numeric(16,4)::text margin
 FROM conversions
 WHERE network_id = $1 AND status = 'approved' AND created_at >= now() - interval '30 days'`,
 [id.networkId],
 )).rows[0]!;
 sendOk(res, {
 windowDays: 30, clicks: Number(clicks), conversions: Number(conv.n),
 payout: conv.payout, revenue: conv.revenue, margin: conv.margin,
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
 sendOk(res, await attachLabels(id.networkId, await getReportingProvider().runReport(request)));
 }),
 );

 // Trigger a payout run (payouts:write). Reuses the ledger service.
 // Every caller-supplied publisherId is validated against the publishers table scoped to
 // the authenticated network before forwarding to createPayoutRun. This prevents a network
 // key from triggering payouts for publishers that belong to a different network.
 r.post(
 '/payouts',
 requireScope('payouts:write'),
 asyncHandler(async (req, res) => {
 const id = apiIdentity(req);
 const b = (req.body ?? {}) as { publisherIds?: string[]; note?: string; currency?: unknown };
 // A batch carries ONE currency (no FX). Omitted = the single currency of the payable balances
 // (422 when they span several). An invalid code is a 422 before anything else runs.
 if (b.currency !== undefined && (typeof b.currency !== 'string' || !CURRENCY_RE.test(b.currency))) {
 throw validationFailed('currency must be a 3-letter upper-case code (e.g. USD)', { currency: ['Invalid currency'] });
 }
 const currency = b.currency as string | undefined;
 const publisherIds: string[] | undefined = b.publisherIds?.filter(
 (x): x is string => typeof x === 'string',
 );

 if (publisherIds && publisherIds.length > 0) {
 const { rows } = await query<{ id: string }>(
 `SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2)`,
 [id.networkId, publisherIds],
 );
 const authorizedIds = new Set(rows.map((r) => r.id));
 const unauthorized = publisherIds.filter((pid) => !authorizedIds.has(pid));
 if (unauthorized.length > 0) {
 throw forbidden(
 `Publisher IDs not found in your network: ${unauthorized.map((x) => `"${x}"`).join(', ')}`,
 );
 }
 }

 const result = await createPayoutRun(id.networkId, {
 ...(publisherIds ? { publisherIds } : {}),
 ...(b.note ? { note: b.note } : {}),
 ...(currency ? { currency } : {}),
 createdBy: `apikey:${id.keyId}`,
 });
 sendOk(res, result, undefined, 201);
 }),
 );

 return r;
}
