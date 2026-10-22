/**
 * Super Admin › Sales › Team — quotas and commissions (lib/platform/sales-comp.ts).
 *
 * - GET /sales/team?month=YYYY-MM: the sales team for a month — quota, won, commission earned. Members who
 *   can see the team (team:read, an 'all' role) see everyone; everyone else sees their own row.
 * - PUT /sales/quotas { adminId, month, currency, target } (team:full): set a month's quota; target null
 *   removes it.
 * - PUT /sales/comp-plans/:adminId { commissionPct, commissionMonths } (team:full).
 * - GET /sales/commissions/:adminId (12 months) and /sales/commissions/:adminId/:month (the invoices):
 *   your own, or anyone's with team:read.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { badRequest, forbidden, notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { commissionInvoices, commissionStatement, currentMonth, monthStart, salesTeam } from '../../lib/platform/sales-comp.js';
import { requirePerm, can, isAssignedScope } from './auth.js';
import { UUID_RE, moneyText, meId } from './fields.js';

const monthText = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month, like 2026-10');
const pct = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'must be a percentage like 10 or 12.5').refine((v) => Number(v) <= 100, 'must be at most 100');

/** Whether the caller sees the whole team (else only themselves). */
const seesTeam = (req: Request) => can(req, 'team', 'read') && !isAssignedScope(req);

async function activeMember(id: string): Promise<void> {
  if (!UUID_RE.test(id) || !(await query('SELECT 1 FROM platform_admins WHERE id = $1', [id])).rows.length) throw notFound('Member not found');
}

export function salesTeamRoutes(): Router {
  const r = Router();

  r.get('/sales/team', requirePerm('sales', 'read'), validateQuery(z.object({ month: monthText.optional() })), asyncHandler(async (req, res) => {
    const month = (res.locals.query as { month?: string }).month ?? currentMonth();
    sendOk(res, { month, canManage: can(req, 'team', 'full'), members: await salesTeam(month, seesTeam(req) ? undefined : meId(req)) });
  }));

  r.put('/sales/quotas', requirePerm('team', 'full'), validateBody(z.object({
    adminId: z.string().regex(UUID_RE, 'must be a member id'),
    month: monthText,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code, like USD'),
    target: moneyText.nullable(),
  }).strict()), asyncHandler(async (req, res) => {
    const b = req.body as { adminId: string; month: string; currency: string; target: string | null };
    await activeMember(b.adminId);
    const start = monthStart(b.month)!;
    if (b.target === null) {
      await query('DELETE FROM sales_quotas WHERE admin_id = $1 AND month = $2 AND currency = $3', [b.adminId, start, b.currency]);
    } else {
      await query(
        `INSERT INTO sales_quotas (admin_id, month, currency, target, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (admin_id, month, currency) DO UPDATE SET target = EXCLUDED.target, updated_by = EXCLUDED.updated_by`,
        [b.adminId, start, b.currency, b.target, meId(req)]);
    }
    await writePlatformAudit(req, null, { action: 'sales.quota', entityType: 'platform_admin', entityId: b.adminId, after: b });
    sendOk(res, (await salesTeam(b.month, b.adminId))[0] ?? null);
  }));

  r.put('/sales/comp-plans/:adminId', requirePerm('team', 'full'), validateBody(z.object({
    commissionPct: pct,
    commissionMonths: z.coerce.number().int().min(1).max(120).nullable(),
  }).strict()), asyncHandler(async (req, res) => {
    const id = req.params.adminId!;
    await activeMember(id);
    const b = req.body as { commissionPct: string; commissionMonths: number | null };
    await query(
      `INSERT INTO sales_comp_plans (admin_id, commission_pct, commission_months, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (admin_id) DO UPDATE SET commission_pct = EXCLUDED.commission_pct, commission_months = EXCLUDED.commission_months,
         updated_by = EXCLUDED.updated_by, updated_at = now()`, [id, b.commissionPct, b.commissionMonths, meId(req)]);
    await writePlatformAudit(req, null, { action: 'sales.comp_plan', entityType: 'platform_admin', entityId: id, after: b });
    sendOk(res, { commissionPct: b.commissionPct, commissionMonths: b.commissionMonths });
  }));

  const ownOrTeam = (req: Request, id: string) => {
    if (id !== meId(req) && !seesTeam(req)) throw forbidden('You can see your own commissions only.');
  };
  r.get('/sales/commissions/:adminId', requirePerm('sales', 'read'), asyncHandler(async (req, res) => {
    const id = req.params.adminId!;
    ownOrTeam(req, id);
    await activeMember(id);
    const comp = (await query<{ commission_pct: string; commission_months: number | null }>(
      'SELECT commission_pct::text, commission_months FROM sales_comp_plans WHERE admin_id = $1', [id])).rows[0];
    sendOk(res, {
      comp: comp ? { commissionPct: comp.commission_pct, commissionMonths: comp.commission_months } : null,
      statement: await commissionStatement(id),
    });
  }));
  r.get('/sales/commissions/:adminId/:month', requirePerm('sales', 'read'), asyncHandler(async (req, res) => {
    const id = req.params.adminId!;
    ownOrTeam(req, id);
    if (!monthStart(req.params.month!)) throw badRequest('The month must look like 2026-10.');
    await activeMember(id);
    sendOk(res, await commissionInvoices(id, req.params.month!));
  }));

  return r;
}
