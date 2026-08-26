/**
 * Manage Custom Metrics (Reporting › Custom Reporting Metrics) — user-defined derived metrics built
 * from a whitelisted set of this app's real base report metrics, validated server-side so a formula
 * can never reference a metric this schema doesn't have. Tenant-scoped by network_id (spec §3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'custom_metrics';

/** The only base metrics a custom-metric formula may reference — matches lib/reporting/types.ts's
 * real `Metric` union, so every formula token is guaranteed to be a genuinely computable value. */
export const CUSTOM_METRIC_BASE_KEYS = [
  'clicks', 'unique_clicks', 'invalid_clicks', 'conversions', 'total_conversions',
  'payout', 'revenue', 'margin', 'avg_fraud_score',
] as const;

const tokenSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('metric'), key: z.enum(CUSTOM_METRIC_BASE_KEYS) }),
  z.object({ type: z.literal('op'), value: z.enum(['+', '-', '*', '/', '(', ')']) }),
  z.object({ type: z.literal('const'), value: z.number() }),
]);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  formula: z.array(tokenSchema).min(1).max(50),
  format: z.enum(['number', 'percentage', 'currency']).default('number'),
});
const updateSchema = createSchema.partial();

interface Row { id: string; ref: string; name: string; formula: unknown; format: string; created_at: string; updated_at: string }
const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), name: r.name, formula: r.formula, format: r.format,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function customMetricsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where: {}, orderBy: 'ref', limit: 500 });
    sendOk(res, rows.map(dto));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<Row>(TABLE, {
      name: b.name, formula: JSON.stringify(b.formula), format: b.format,
    });
    await writeAudit(req, { action: 'custom_metric.create', entityType: 'custom_metric', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.formula !== undefined) patch['formula'] = JSON.stringify(b.formula);
    if (b.format !== undefined) patch['format'] = b.format;
    const [row] = await db.update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Custom metric not found');
    await writeAudit(req, { action: 'custom_metric.update', entityType: 'custom_metric', entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Custom metric not found');
    await writeAudit(req, { action: 'custom_metric.delete', entityType: 'custom_metric', entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}
