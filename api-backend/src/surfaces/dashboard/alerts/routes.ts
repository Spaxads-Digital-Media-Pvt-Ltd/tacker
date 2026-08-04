/**
 * Admin alerts + fraud-rules (spec §10). Alerts list/acknowledge/resolve; per-network fraud
 * thresholds get/update. RBAC: reads for any admin; changing rules requires admin/manager.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../../lib/http/pagination.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { getFraudConfig, setFraudConfig } from '../../../lib/fraud/rules.js';
import { requireRole } from '../auth.js';

interface AlertRow {
  id: string; type: string; severity: string; entity_type: string | null; entity_id: string | null;
  title: string; description: string | null; status: string; metadata: Record<string, unknown>; created_at: string;
}
const toDTO = (a: AlertRow) => ({
  id: a.id, type: a.type, severity: a.severity, entityType: a.entity_type, entityId: a.entity_id,
  title: a.title, description: a.description, status: a.status, metadata: a.metadata, createdAt: a.created_at,
});

const listQuery = paginationSchema.extend({ status: z.enum(['open', 'acknowledged', 'resolved']).optional() });
const patchSchema = z.object({ status: z.enum(['acknowledged', 'resolved']) });
const rulesSchema = z.object({
  enabled: z.boolean().optional(),
  velocityPerMinute: z.number().int().min(1).optional(),
  datacenterRatioThreshold: z.number().min(0).max(1).optional(),
  minClickToConversionSeconds: z.number().int().min(0).optional(),
  crSpikeThreshold: z.number().min(0).max(1).optional(),
  minClicksForCrAlert: z.number().int().min(1).optional(),
  scanWindowHours: z.number().int().min(1).max(720).optional(),
});

/** Mounted at /api/alerts. */
export function alertsRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    validateQuery(listQuery),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as PaginationQuery & { status?: string };
      const where = q.status ? { status: q.status } : {};
      const rows = await dbForRequest(req).selectMany<AlertRow>('alerts', {
        where, limit: q.limit, offset: q.offset, orderBy: 'created_at',
      });
      sendOk(res, rows.map(toDTO), { limit: q.limit, offset: q.offset });
    }),
  );

  r.patch(
    '/:id',
    validateBody(patchSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof patchSchema>;
      const rows = await dbForRequest(req).update<AlertRow>('alerts', { status: b.status }, { id: req.params.id });
      if (rows.length === 0) throw notFound('Alert not found');
      await writeAudit(req, { action: `alert.${b.status}`, entityType: 'alert', entityId: req.params.id });
      sendOk(res, toDTO(rows[0]!));
    }),
  );

  return r;
}

/** Mounted at /api/fraud-rules. */
export function fraudRulesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    sendOk(res, await getFraudConfig(req.scope!.networkId));
  }));

  r.put(
    '/',
    requireRole('admin', 'manager'),
    validateBody(rulesSchema),
    asyncHandler(async (req, res) => {
      const updated = await setFraudConfig(req.scope!.networkId, req.body as z.infer<typeof rulesSchema>);
      await writeAudit(req, { action: 'fraud_rules.update', entityType: 'fraud_rules', entityId: req.scope!.networkId, after: updated });
      sendOk(res, updated);
    }),
  );

  return r;
}
