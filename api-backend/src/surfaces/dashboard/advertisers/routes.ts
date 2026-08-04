/**
 * Advertisers — Dashboard API routes. Two mounts:
 *   - admin: full CRUD, network-scoped, RBAC-gated (spec §1 Phase 1).
 *   - advertiser portal: self-read only, owner-scoped (spec §3A owner isolation).
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../../lib/http/pagination.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest, ownerIdOf } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import type { AdvertiserRow } from '../../../domain/entities.js';
import { requireRole, requirePortal } from '../auth.js';
import { reportQuerySchema, buildReportRequest } from '../../../lib/reporting/request.js';
import { getReportingProvider } from '../../../lib/reporting/index.js';
import { summary24h } from '../../../lib/reporting/summary.js';
import { createAdvertiserSchema, updateAdvertiserSchema, debugPostbackSchema, type DebugPostback } from './schemas.js';
import { toAdminDTO, toSelfDTO } from './dto.js';
import { attachTagRoutes } from '../tags/routes.js';
import { mergeCustomFields } from '../custom-fields/routes.js';
import { firePostbackTest, sampleMacros } from '../../../lib/postback/test.js';

const TABLE = 'advertisers';

export function advertisersAdminRoutes(): Router {
  const r = Router();

  // List (paginated, bounded).
  r.get(
    '/',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { limit, offset } = res.locals.query as PaginationQuery;
      const db = dbForRequest(req);
      const [rows, total] = await Promise.all([
        db.selectMany<AdvertiserRow>(TABLE, { limit, offset, orderBy: 'created_at' }),
        db.count(TABLE),
      ]);
      sendOk(res, rows.map(toAdminDTO), { limit, offset, total });
    }),
  );

  r.get('/stats', asyncHandler(async (req, res) => {
    const { rows } = await query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text n FROM advertisers WHERE network_id = $1 GROUP BY status`,
      [req.scope!.networkId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    sendOk(res, { total, active: by['active'] ?? 0, pending: by['pending'] ?? 0, suspended: by['inactive'] ?? 0 });
  }));

  // Get one.
  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await dbForRequest(req).selectOne<AdvertiserRow>(TABLE, { id: req.params.id });
      if (!row) throw notFound('Advertiser not found');
      sendOk(res, toAdminDTO(row));
    }),
  );

  // Create (admin/manager only).
  r.post(
    '/',
    requireRole('admin', 'manager'),
    validateBody(createAdvertiserSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as import('./schemas.js').CreateAdvertiser;
      const row = await dbForRequest(req).insert<AdvertiserRow>(TABLE, {
        name: b.name,
        status: b.status,
        contact_email: b.contactEmail ?? null,
        billing_terms: b.billingTerms ?? null,
        default_currency: b.defaultCurrency,
        ...(b.customFields ? { metadata: mergeCustomFields(null, b.customFields) } : {}),
      });
      await writeAudit(req, { action: 'advertiser.create', entityType: 'advertiser', entityId: row.id, after: row });
      res.status(201);
      sendOk(res, toAdminDTO(row));
    }),
  );

  // Update (admin/manager only).
  r.patch(
    '/:id',
    requireRole('admin', 'manager'),
    validateBody(updateAdvertiserSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<AdvertiserRow>(TABLE, { id: req.params.id });
      if (!before) throw notFound('Advertiser not found');

      const b = req.body as import('./schemas.js').UpdateAdvertiser;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch['name'] = b.name;
      if (b.status !== undefined) patch['status'] = b.status;
      if (b.contactEmail !== undefined) patch['contact_email'] = b.contactEmail;
      if (b.billingTerms !== undefined) patch['billing_terms'] = b.billingTerms;
      if (b.defaultCurrency !== undefined) patch['default_currency'] = b.defaultCurrency;
      if (b.customFields !== undefined) patch['metadata'] = mergeCustomFields(before.metadata, b.customFields);

      const [row] = await db.update<AdvertiserRow>(TABLE, patch, { id: req.params.id });
      await writeAudit(req, { action: 'advertiser.update', entityType: 'advertiser', entityId: req.params.id, before, after: row });
      sendOk(res, toAdminDTO(row ?? before));
    }),
  );

  // Delete (admin only).
  r.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<AdvertiserRow>(TABLE, { id: req.params.id });
      if (!before) throw notFound('Advertiser not found');
      await db.delete(TABLE, { id: req.params.id });
      await writeAudit(req, { action: 'advertiser.delete', entityType: 'advertiser', entityId: req.params.id, before });
      sendOk(res, { deleted: true });
    }),
  );

  // --- Debug Postback: fire a conversion postback URL with sample macros (connectivity check) ---
  r.post('/:id/debug-postback', requireRole('admin', 'manager'), validateBody(debugPostbackSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const adv = await db.selectOne<AdvertiserRow>(TABLE, { id: req.params.id });
    if (!adv) throw notFound('Advertiser not found');
    const b = req.body as DebugPostback;
    const overrides: Record<string, string> = { advertiser_id: req.params.id ?? 'test-advertiser' };
    if (b.country) { overrides['country'] = b.country; overrides['geo'] = b.country; }
    if (b.device) overrides['device'] = b.device;
    const result = await firePostbackTest(b.url, b.method, sampleMacros(overrides));
    sendOk(res, result);
  }));

  // --- Tags (/:id/tags) ---
  attachTagRoutes(r, 'advertiser');

  return r;
}

/** Advertiser portal: your OWN profile + stats. Owner-scoped by advertiser_id === owner. */
export function advertiserPortalRoutes(): Router {
  const r = Router();
  r.use(requirePortal('advertiser'));

  r.get(
    '/me',
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      // Owner isolation: fetch strictly by the caller's own id.
      const row = await dbForRequest(req).selectOne<AdvertiserRow>(TABLE, { id: ownerId });
      if (!row) throw notFound('Advertiser profile not found');
      sendOk(res, toSelfDTO(row));
    }),
  );

  // Stats: reporting scoped to THIS advertiser (revenue but no publisher payout — audience 'advertiser').
  r.get(
    '/stats',
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const request = buildReportRequest(req.scope!.networkId, res.locals.query, 'advertiser', { advertiserId: ownerIdOf(req) });
      sendOk(res, await getReportingProvider().runReport(request));
    }),
  );

  // 24h KPI summary for the advertiser dashboard tiles (revenue, no payout).
  r.get(
    '/summary',
    asyncHandler(async (req, res) => {
      sendOk(res, await summary24h(req.scope!.networkId, 'advertiser', { advertiserId: ownerIdOf(req) }));
    }),
  );

  return r;
}
