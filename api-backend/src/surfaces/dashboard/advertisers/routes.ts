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
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest, ownerIdOf } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { getSupabaseAdmin } from '../../../lib/supabase.js';
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

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'advertiser', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

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

  // Marketplace listing (Discover Advertisers) — per-advertiser aggregates real enough to power the
  // reference's own filter taxonomy: Categories (offer.category), Payout Types Available
  // (offer.payout_model), Conversion Funnel (an offer with >1 goal — spec feature-depth multi-goal
  // offers, offer_goals). Promotional Methods/Payment Methods/Geo/Device targeting have no equivalent
  // stored field anywhere in this schema (offers carry no country/device targeting config — the only
  // `countries` column in the whole schema belongs to offer_forwarding_rules, which is never enforced
  // — spec RedirectReport.tsx) so the frontend shows those filter categories as real-but-inert rather
  // than fabricating values.
  r.get('/marketplace', asyncHandler(async (req, res) => {
    const { rows } = await query<{
      id: string; name: string; status: string; created_at: string; contact_email: string | null;
      categories: (string | null)[]; payout_models: string[]; offer_count: number; has_funnel: boolean;
    }>(
      `SELECT a.id, a.name, a.status, a.created_at, a.contact_email,
              COALESCE(array_agg(DISTINCT o.category) FILTER (WHERE o.category IS NOT NULL), '{}') AS categories,
              COALESCE(array_agg(DISTINCT o.payout_model) FILTER (WHERE o.id IS NOT NULL), '{}') AS payout_models,
              COUNT(DISTINCT o.id)::int AS offer_count,
              COALESCE(BOOL_OR(gc.n > 1), false) AS has_funnel
         FROM advertisers a
         LEFT JOIN offers o ON o.advertiser_id = a.id AND o.network_id = a.network_id
         LEFT JOIN (SELECT offer_id, COUNT(*) AS n FROM offer_goals GROUP BY offer_id) gc ON gc.offer_id = o.id
        WHERE a.network_id = $1
        GROUP BY a.id
        ORDER BY a.created_at DESC`,
      [req.scope!.networkId],
    );
    sendOk(res, rows.map((r) => ({
      id: r.id, name: r.name, status: r.status, createdAt: r.created_at, contactEmail: r.contact_email,
      categories: r.categories.filter((c): c is string => c != null), payoutModels: r.payout_models,
      offerCount: r.offer_count, hasFunnel: r.has_funnel,
    })));
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
        account_manager_id: b.accountManagerId ?? null,
        sales_manager_id: b.salesManagerId ?? null,
        billing_frequency: b.billingFrequency ?? null,
        verification_token: b.verificationToken ?? null,
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
      if (b.accountManagerId !== undefined) patch['account_manager_id'] = b.accountManagerId;
      if (b.salesManagerId !== undefined) patch['sales_manager_id'] = b.salesManagerId;
      if (b.billingFrequency !== undefined) patch['billing_frequency'] = b.billingFrequency;
      if (b.verificationToken !== undefined) patch['verification_token'] = b.verificationToken;
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

  // "Impersonate" (row menu) — mints a real Supabase magic-link for the advertiser's OWN linked
  // portal account (never a forged/self-signed token), mirroring the same publisher pattern. Only
  // advertisers with a linked portal account (hasPortalAccount) can be impersonated.
  r.post('/:id/impersonate', requireRole('admin'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const adv = await db.selectOne<AdvertiserRow>(TABLE, { id: req.params.id });
    if (!adv) throw notFound('Advertiser not found');
    if (!adv.auth_user_id || !adv.contact_email) {
      throw badRequest('This advertiser has no linked portal account to impersonate.');
    }
    const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
      type: 'magiclink', email: adv.contact_email,
    });
    if (error || !data?.properties?.action_link) throw badRequest('Could not generate an impersonation link.');
    await writeAudit(req, { action: 'advertiser.impersonate', entityType: 'advertiser', entityId: adv.id });
    sendOk(res, { link: data.properties.action_link });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Advertiser not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'advertiser' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

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
