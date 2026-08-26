/**
 * Offers › Traffic Controls — matches the reference's real "Manage Traffic Controls"
 * (/offers/trafficcontrols): an explicit offer scope (All / specific Offers / specific
 * Advertisers), a partner scope, an effective date range, and a real Control rule (Action +
 * Variables + Comparison Method + Values) — genuinely enforced by the tracking surface at /click
 * (see surfaces/tracking/app.ts), not just stored. Tenant-scoped by network_id (spec §3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { invalidateOfferConfig } from '../../tracking/offer-cache.js';

const TABLE = 'traffic_controls';

interface Row {
  id: string; ref: string; name: string; control_type: string; status: string;
  effective_from: string | null; effective_to: string | null;
  offer_scope: string; offer_ids: string[]; advertiser_ids: string[];
  partner_scope: string; partner_ids: string[];
  action: string; variables: string[]; comparison_method: string | null; control_values: string[];
  created_at: string; updated_at: string;
}
const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, controlType: r.control_type, status: r.status,
  effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
  offerScope: r.offer_scope, offerIds: r.offer_ids, advertiserIds: r.advertiser_ids,
  partnerScope: r.partner_scope, partnerIds: r.partner_ids,
  action: r.action, variables: r.variables, comparisonMethod: r.comparison_method, values: r.control_values,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const VARIABLES = ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'referrer', 'ip', 'country', 'device', 'os', 'browser', 'user_agent'] as const;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  controlType: z.enum(['blacklist', 'whitelist']).default('blacklist'),
  status: z.enum(['active', 'inactive']).default('active'),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  offerScope: z.enum(['all', 'offers', 'advertisers']).default('all'),
  offerIds: z.array(z.string().uuid()).default([]),
  advertiserIds: z.array(z.string().uuid()).default([]),
  partnerScope: z.enum(['all', 'specific']).default('all'),
  partnerIds: z.array(z.string().uuid()).default([]),
  action: z.enum(['block', 'fail_traffic']).default('block'),
  variables: z.array(z.enum(VARIABLES)).default([]),
  comparisonMethod: z.enum(['begins_with', 'contains', 'not_contains', 'not_match', 'ends_with', 'exact_match', 'is_empty']).nullable().optional(),
  values: z.array(z.string().max(500)).max(3000).default([]),
});
// The reference's Edit form only ever shows Active/Inactive, but its row kebab has a separate
// "Set as Deleted" quick action that PATCHes status directly — so only the update schema accepts it.
const updateSchema = createSchema.partial().extend({ status: z.enum(['active', 'inactive', 'deleted']).optional() });

export function trafficControlsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where: {}, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(dto));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Traffic control not found');
    sendOk(res, dto(row));
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Traffic control not found');
    const { rows } = await query<{ id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, TABLE, req.params.id],
    );
    sendOk(res, rows.map((h) => {
      const suffix = h.action.split('.').pop() ?? '';
      return {
        id: h.id, operationTime: h.created_at, service: 'traffic_control', changes: h.action,
        employee: h.actor_id, method: { create: 'POST', update: 'PATCH', delete: 'DELETE' }[suffix] ?? '—',
        portal: h.actor_type === 'user' ? 'Dashboard' : h.actor_type === 'api_key' ? 'API' : h.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
        userIp: h.ip, userAgent: h.user_agent,
      };
    }));
  }));

  const columns = (b: Partial<z.infer<typeof updateSchema>>) => {
    const out: Record<string, unknown> = {};
    if (b.name !== undefined) out['name'] = b.name;
    if (b.controlType !== undefined) out['control_type'] = b.controlType;
    if (b.status !== undefined) out['status'] = b.status;
    if (b.effectiveFrom !== undefined) out['effective_from'] = b.effectiveFrom;
    if (b.effectiveTo !== undefined) out['effective_to'] = b.effectiveTo;
    if (b.offerScope !== undefined) out['offer_scope'] = b.offerScope;
    if (b.offerIds !== undefined) out['offer_ids'] = JSON.stringify(b.offerIds);
    if (b.advertiserIds !== undefined) out['advertiser_ids'] = JSON.stringify(b.advertiserIds);
    if (b.partnerScope !== undefined) out['partner_scope'] = b.partnerScope;
    if (b.partnerIds !== undefined) out['partner_ids'] = JSON.stringify(b.partnerIds);
    if (b.action !== undefined) out['action'] = b.action;
    if (b.variables !== undefined) out['variables'] = JSON.stringify(b.variables);
    if (b.comparisonMethod !== undefined) out['comparison_method'] = b.comparisonMethod;
    if (b.values !== undefined) out['control_values'] = JSON.stringify(b.values);
    return out;
  };

  // Bust the cached OfferConfig for every offer this rule can affect, so /click picks up the
  // change without waiting out the cache TTL. A network-wide "All offers" rule is the one case
  // left to the TTL (spec §5's own hot-path cache, same tradeoff geo-rule edits already accept) —
  // busting every offer in the network on every edit isn't worth the write fan-out.
  async function invalidateForRule(networkId: string, row: Row | undefined): Promise<void> {
    if (!row) return;
    if (row.offer_scope === 'offers') {
      await Promise.all(row.offer_ids.map((id) => invalidateOfferConfig(networkId, id)));
    } else if (row.offer_scope === 'advertisers' && row.advertiser_ids.length) {
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM offers WHERE network_id = $1 AND advertiser_id = ANY($2::uuid[])`,
        [networkId, row.advertiser_ids],
      );
      await Promise.all(rows.map((o) => invalidateOfferConfig(networkId, o.id)));
    }
  }

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    for (const id of b.offerIds) if (!(await db.selectOne('offers', { id }))) throw badRequest('offerIds contains an offer outside this network');
    for (const id of b.advertiserIds) if (!(await db.selectOne('advertisers', { id }))) throw badRequest('advertiserIds contains an advertiser outside this network');
    for (const id of b.partnerIds) if (!(await db.selectOne('publishers', { id }))) throw badRequest('partnerIds contains a partner outside this network');
    const row = await db.insert<Row>(TABLE, columns(b));
    await writeAudit(req, { action: 'traffic_control.create', entityType: TABLE, entityId: row.id, after: row });
    if (row.status === 'active') await invalidateForRule(db.scope.networkId, row);
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateSchema>;
    for (const id of b.offerIds ?? []) if (!(await db.selectOne('offers', { id }))) throw badRequest('offerIds contains an offer outside this network');
    for (const id of b.advertiserIds ?? []) if (!(await db.selectOne('advertisers', { id }))) throw badRequest('advertiserIds contains an advertiser outside this network');
    for (const id of b.partnerIds ?? []) if (!(await db.selectOne('publishers', { id }))) throw badRequest('partnerIds contains a partner outside this network');
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    const [row] = await db.update<Row>(TABLE, columns(b), { id: req.params.id });
    if (!row) throw notFound('Traffic control not found');
    await writeAudit(req, { action: 'traffic_control.update', entityType: TABLE, entityId: req.params.id, after: row });
    await invalidateForRule(db.scope.networkId, before ?? undefined);
    await invalidateForRule(db.scope.networkId, row);
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    const n = await db.delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Traffic control not found');
    await writeAudit(req, { action: 'traffic_control.delete', entityType: TABLE, entityId: req.params.id });
    await invalidateForRule(db.scope.networkId, before ?? undefined);
    sendOk(res, { deleted: true });
  }));

  return r;
}
