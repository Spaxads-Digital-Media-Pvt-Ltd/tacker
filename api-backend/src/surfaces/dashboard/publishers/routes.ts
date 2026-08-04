/**
 * Publishers — Dashboard API routes. Admin CRUD (network-scoped, RBAC) + publisher portal
 * self-read (owner-scoped by publisher_id === owner). Spec §1 / §3A.
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
import type { PublisherRow } from '../../../domain/entities.js';
import { requireRole, requirePortal } from '../auth.js';
import { accountBalance } from '../../../lib/ledger/ledger.js';
import { reportQuerySchema, buildReportRequest } from '../../../lib/reporting/request.js';
import { getReportingProvider } from '../../../lib/reporting/index.js';
import { summary24h } from '../../../lib/reporting/summary.js';
import {
  createPublisherSchema, updatePublisherSchema, createPostbackSchema,
  updatePostbackSchema, postbackTestSchema,
  type CreatePublisher, type UpdatePublisher, type CreatePostback,
  type UpdatePostback, type PostbackTest,
} from './schemas.js';
import { toAdminDTO, toSelfDTO } from './dto.js';
import { attachTagRoutes } from '../tags/routes.js';
import { mergeCustomFields } from '../custom-fields/routes.js';
import { firePostbackTest, sampleMacros } from '../../../lib/postback/test.js';
import { badRequest } from '../../../lib/http/errors.js';

const TABLE = 'publishers';
const POSTBACKS = 'publisher_postbacks';

interface PostbackRow {
  id: string; url: string; method: string; offer_id: string | null; event: string | null;
  status: string; created_at: string;
}
const toPostbackDTO = (r: PostbackRow) => ({
  id: r.id, url: r.url, method: r.method, offerId: r.offer_id, event: r.event,
  status: r.status, createdAt: r.created_at,
});

export function publishersAdminRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { limit, offset } = res.locals.query as PaginationQuery;
      const db = dbForRequest(req);
      const [rows, total] = await Promise.all([
        db.selectMany<PublisherRow>(TABLE, { limit, offset, orderBy: 'created_at' }),
        db.count(TABLE),
      ]);
      sendOk(res, rows.map(toAdminDTO), { limit, offset, total });
    }),
  );

  r.get('/stats', asyncHandler(async (req, res) => {
    const { rows } = await query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text n FROM publishers WHERE network_id = $1 GROUP BY status`,
      [req.scope!.networkId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    sendOk(res, { total, active: by['active'] ?? 0, pending: by['pending'] ?? 0, suspended: by['inactive'] ?? 0 });
  }));

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await dbForRequest(req).selectOne<PublisherRow>(TABLE, { id: req.params.id });
      if (!row) throw notFound('Publisher not found');
      sendOk(res, toAdminDTO(row));
    }),
  );

  r.post(
    '/',
    requireRole('admin', 'manager'),
    validateBody(createPublisherSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as CreatePublisher;
      const row = await dbForRequest(req).insert<PublisherRow>(TABLE, {
        name: b.name,
        status: b.status,
        contact_email: b.contactEmail ?? null,
        traffic_source: b.trafficSource ?? null,
        payout_terms: b.payoutTerms ?? null,
        ...(b.defaultAttributionWindowS !== undefined ? { default_attribution_window_s: b.defaultAttributionWindowS } : {}),
        ...(b.defaultDedupWindowS !== undefined ? { default_dedup_window_s: b.defaultDedupWindowS } : {}),
        ...(b.customFields ? { metadata: mergeCustomFields(null, b.customFields) } : {}),
      });
      await writeAudit(req, { action: 'publisher.create', entityType: 'publisher', entityId: row.id, after: row });
      res.status(201);
      sendOk(res, toAdminDTO(row));
    }),
  );

  r.patch(
    '/:id',
    requireRole('admin', 'manager'),
    validateBody(updatePublisherSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<PublisherRow>(TABLE, { id: req.params.id });
      if (!before) throw notFound('Publisher not found');
      const b = req.body as UpdatePublisher;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch['name'] = b.name;
      if (b.status !== undefined) patch['status'] = b.status;
      if (b.contactEmail !== undefined) patch['contact_email'] = b.contactEmail;
      if (b.trafficSource !== undefined) patch['traffic_source'] = b.trafficSource;
      if (b.payoutTerms !== undefined) patch['payout_terms'] = b.payoutTerms;
      if (b.defaultAttributionWindowS !== undefined) patch['default_attribution_window_s'] = b.defaultAttributionWindowS;
      if (b.defaultDedupWindowS !== undefined) patch['default_dedup_window_s'] = b.defaultDedupWindowS;
      if (b.customFields !== undefined) patch['metadata'] = mergeCustomFields(before.metadata, b.customFields);

      const [row] = await db.update<PublisherRow>(TABLE, patch, { id: req.params.id });
      await writeAudit(req, { action: 'publisher.update', entityType: 'publisher', entityId: req.params.id, before, after: row });
      sendOk(res, toAdminDTO(row ?? before));
    }),
  );

  r.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<PublisherRow>(TABLE, { id: req.params.id });
      if (!before) throw notFound('Publisher not found');
      await db.delete(TABLE, { id: req.params.id });
      await writeAudit(req, { action: 'publisher.delete', entityType: 'publisher', entityId: req.params.id, before });
      sendOk(res, { deleted: true });
    }),
  );

  // --- Postbacks (admin manages a publisher's outbound postbacks) ---
  const ensurePublisher = async (db: ReturnType<typeof dbForRequest>, id: string | undefined): Promise<void> => {
    if (!id) throw notFound('Publisher not found');
    const p = await db.selectOne<PublisherRow>(TABLE, { id });
    if (!p) throw notFound('Publisher not found');
  };

  r.get('/:id/postbacks', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensurePublisher(db, req.params.id);
    const rows = await db.selectMany<PostbackRow>(POSTBACKS, { where: { publisher_id: req.params.id }, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(toPostbackDTO));
  }));

  r.post('/:id/postbacks', requireRole('admin', 'manager'), validateBody(createPostbackSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    await ensurePublisher(db, req.params.id);
    const b = req.body as CreatePostback;
    if (b.offerId) {
      const offer = await db.selectOne('offers', { id: b.offerId });
      if (!offer) throw badRequest('offerId does not belong to this network');
    }
    const row = await db.insert<PostbackRow>(POSTBACKS, {
      publisher_id: req.params.id, url: b.url, method: b.method, offer_id: b.offerId ?? null, event: b.event ?? null,
    });
    await writeAudit(req, { action: 'publisher.postback.create', entityType: 'publisher_postback', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, toPostbackDTO(row));
  }));

  r.patch('/:id/postbacks/:pbId', requireRole('admin', 'manager'), validateBody(updatePostbackSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as UpdatePostback;
    const patch: Record<string, unknown> = {};
    if (b.url !== undefined) patch['url'] = b.url;
    if (b.method !== undefined) patch['method'] = b.method;
    if (b.offerId !== undefined) patch['offer_id'] = b.offerId;
    if (b.event !== undefined) patch['event'] = b.event;
    if (b.status !== undefined) patch['status'] = b.status;
    const [row] = await db.update<PostbackRow>(POSTBACKS, patch, { id: req.params.pbId, publisher_id: req.params.id });
    if (!row) throw notFound('Postback not found');
    await writeAudit(req, { action: 'publisher.postback.update', entityType: 'publisher_postback', entityId: req.params.pbId, after: row });
    sendOk(res, toPostbackDTO(row));
  }));

  r.delete('/:id/postbacks/:pbId', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(POSTBACKS, { id: req.params.pbId, publisher_id: req.params.id });
    if (n === 0) throw notFound('Postback not found');
    await writeAudit(req, { action: 'publisher.postback.delete', entityType: 'publisher_postback', entityId: req.params.pbId });
    sendOk(res, { deleted: true });
  }));

  // --- Postback Test: fire a URL template with sample macros, report status (no conversion) ---
  r.post('/:id/postbacks/test', requireRole('admin', 'manager'), validateBody(postbackTestSchema), asyncHandler(async (req, res) => {
    const b = req.body as PostbackTest;
    const overrides: Record<string, string> = { publisher_id: req.params.id ?? 'test-publisher' };
    if (b.country) { overrides['country'] = b.country; overrides['geo'] = b.country; }
    if (b.device) overrides['device'] = b.device;
    const result = await firePostbackTest(b.url, b.method, sampleMacros(overrides));
    sendOk(res, result);
  }));

  // --- Tags (/:id/tags) ---
  attachTagRoutes(r, 'publisher');

  return r;
}

/** Publisher portal: your OWN profile + your OWN postbacks (owner-scoped by publisher_id). */
export function publisherPortalRoutes(): Router {
  const r = Router();
  r.use(requirePortal('publisher'));

  r.get(
    '/me',
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      const row = await dbForRequest(req).selectOne<PublisherRow>(TABLE, { id: ownerId });
      if (!row) throw notFound('Publisher profile not found');
      sendOk(res, toSelfDTO(row));
    }),
  );

  // Postbacks — a publisher manages only their OWN (spec §8A). Every query pins publisher_id.
  r.get(
    '/postbacks',
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      const rows = await dbForRequest(req).selectMany<PostbackRow>(POSTBACKS, {
        where: { publisher_id: ownerId }, orderBy: 'created_at', limit: 200,
      });
      sendOk(res, rows.map(toPostbackDTO));
    }),
  );

  r.post(
    '/postbacks',
    validateBody(createPostbackSchema),
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      const b = req.body as CreatePostback;
      const row = await dbForRequest(req).insert<PostbackRow>(POSTBACKS, {
        publisher_id: ownerId,
        url: b.url,
        method: b.method,
        offer_id: b.offerId ?? null,
        event: b.event ?? null,
      });
      res.status(201);
      sendOk(res, toPostbackDTO(row));
    }),
  );

  r.delete(
    '/postbacks/:id',
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      // Owner isolation: delete only if it belongs to THIS publisher.
      const n = await dbForRequest(req).delete(POSTBACKS, { id: req.params.id, publisher_id: ownerId });
      if (n === 0) throw notFound('Postback not found');
      sendOk(res, { deleted: true });
    }),
  );

  // Earnings: balance + statement (ledger entries for THIS publisher). Payout/earning only —
  // a publisher NEVER sees revenue/margin (spec §3A/§8A). Their ledger account has no revenue rows.
  r.get(
    '/earnings',
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      const networkId = req.scope!.networkId;
      const balance = await accountBalance(networkId, 'publisher', ownerId, 'approved');
      const rows = await dbForRequest(req).selectMany<{
        entry_type: string; direction: string; amount: string; currency: string;
        status: string; created_at: string;
      }>('ledger_entries', {
        where: { account_type: 'publisher', account_id: ownerId },
        orderBy: 'created_at', limit: 200,
      });
      const statement = rows.map((e) => ({
        type: e.entry_type, direction: e.direction, amount: e.amount,
        currency: e.currency, status: e.status, createdAt: e.created_at,
      }));
      sendOk(res, { balance, statement });
    }),
  );

  // Stats: reporting scoped to THIS publisher (no revenue/margin — audience 'publisher').
  r.get(
    '/stats',
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const request = buildReportRequest(req.scope!.networkId, res.locals.query, 'publisher', { publisherId: ownerIdOf(req) });
      sendOk(res, await getReportingProvider().runReport(request));
    }),
  );

  // 24h KPI summary for the publisher dashboard tiles (payout only) + payable balance.
  r.get(
    '/summary',
    asyncHandler(async (req, res) => {
      const ownerId = ownerIdOf(req);
      const networkId = req.scope!.networkId;
      const [kpi, balance] = await Promise.all([
        summary24h(networkId, 'publisher', { publisherId: ownerId }),
        accountBalance(networkId, 'publisher', ownerId, 'approved'),
      ]);
      sendOk(res, { ...kpi, balance });
    }),
  );

  return r;
}
