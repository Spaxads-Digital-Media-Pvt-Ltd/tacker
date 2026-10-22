/**
 * Super Admin › Resellers & white-label (resellers:read sees, resellers:full changes).
 *
 * - /resellers: agencies / partners who sell the platform for a commission (platform_resellers). Each has
 *   its networks (networks.reseller_id) and a monthly commission statement — what those networks PAID
 *   (paid platform invoices, per currency, the last 12 UTC months) × the reseller's commission %
 *   (the current %, rounded to cents).
 * - /networks/:id/reseller: give a network a reseller (or none).
 * - /networks/:id/white-label: grant white-label to a network (`enabled`) and see / edit its settings
 *   (lib/white-label.ts); the network's admin sets it up from Control Center too.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody } from '../../lib/http/validate.js';
import { notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { saveWhiteLabel, verifyWhiteLabelDomain, whiteLabelDto, whiteLabelFor, whiteLabelPatchSchema } from '../../lib/white-label.js';
import { requirePerm, assertNetworkInScope } from './auth.js';
import { optEmail, optText } from './fields.js';

const pct = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'must be a percentage like 15 or 12.5')
  .refine((v) => Number(v) <= 100, 'must be at most 100');
const resellerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: optText(200),
  contactEmail: optEmail,
  commissionPct: pct.default('0'),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: optText(5000),
}).strict();
const resellerPatchSchema = resellerSchema.partial().strict();

interface ResellerRow {
  id: string; name: string; contact_name: string | null; contact_email: string | null; commission_pct: string;
  status: string; notes: string | null; created_at: string; updated_at: string; networks?: number;
}
const dto = (r: ResellerRow) => ({
  id: r.id, name: r.name, contactName: r.contact_name, contactEmail: r.contact_email, commissionPct: r.commission_pct,
  status: r.status, notes: r.notes, networks: r.networks ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** The reseller's commission per month and currency, the last 12 UTC months (newest first). Money as text. */
export async function resellerStatement(resellerId: string): Promise<{ month: string; currency: string; paid: string; invoices: number; commission: string }[]> {
  const { rows } = await query<{ month: string; currency: string; paid: string; invoices: number; commission: string }>(
    `SELECT to_char(i.paid_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, i.currency,
            SUM(i.paid_amount)::numeric(14,2)::text AS paid, COUNT(*)::int AS invoices,
            ROUND(SUM(i.paid_amount) * r.commission_pct / 100, 2)::numeric(14,2)::text AS commission
       FROM platform_invoices i
       JOIN networks n ON n.id = i.network_id
       JOIN platform_resellers r ON r.id = n.reseller_id
      WHERE r.id = $1 AND i.status = 'paid' AND i.paid_amount IS NOT NULL
        AND i.paid_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') - interval '11 months') AT TIME ZONE 'UTC'
      GROUP BY 1, i.currency, r.commission_pct
      ORDER BY 1 DESC, i.currency`, [resellerId]);
  return rows;
}

export function resellerRoutes(): Router {
  const r = Router();

  r.get('/resellers', requirePerm('resellers', 'read'), asyncHandler(async (_req, res) => {
    const { rows } = await query<ResellerRow>(
      `SELECT r.*, (SELECT COUNT(*)::int FROM networks n WHERE n.reseller_id = r.id AND n.status <> 'deleted') AS networks
         FROM platform_resellers r ORDER BY r.status, r.name`);
    sendOk(res, rows.map(dto));
  }));

  r.post('/resellers', requirePerm('resellers', 'full'), validateBody(resellerSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof resellerSchema>;
    const { rows } = await query<ResellerRow>(
      `INSERT INTO platform_resellers (name, contact_name, contact_email, commission_pct, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.name, b.contactName ?? null, b.contactEmail ?? null, b.commissionPct, b.status, b.notes ?? null]);
    await writePlatformAudit(req, null, { action: 'platform.reseller.create', entityType: 'platform_reseller', entityId: rows[0]!.id, after: rows[0] });
    sendOk(res, dto(rows[0]!), undefined, 201);
  }));

  r.get('/resellers/:id', requirePerm('resellers', 'read'), asyncHandler(async (req, res) => {
    const { rows } = await query<ResellerRow>('SELECT * FROM platform_resellers WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('Reseller not found');
    const { rows: nets } = await query<{ id: string; name: string; slug: string; status: string; plan_name: string | null; created_at: string }>(
      `SELECT n.id, n.name, n.slug, n.status, p.name AS plan_name, n.created_at
         FROM networks n
         LEFT JOIN subscriptions s ON s.network_id = n.id
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE n.reseller_id = $1 AND n.status <> 'deleted' ORDER BY n.name`, [rows[0].id]);
    sendOk(res, {
      ...dto({ ...rows[0], networks: nets.length }),
      networkList: nets.map((n) => ({ id: n.id, name: n.name, slug: n.slug, status: n.status, plan: n.plan_name, createdAt: n.created_at })),
      statement: await resellerStatement(rows[0].id),
    });
  }));

  r.patch('/resellers/:id', requirePerm('resellers', 'full'), validateBody(resellerPatchSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof resellerPatchSchema>;
    const { rows: before } = await query<ResellerRow>('SELECT * FROM platform_resellers WHERE id = $1', [req.params.id]);
    if (!before[0]) throw notFound('Reseller not found');
    const cols: Record<string, unknown> = {
      name: b.name, contact_name: b.contactName, contact_email: b.contactEmail, commission_pct: b.commissionPct, status: b.status, notes: b.notes,
    };
    const sets: string[] = []; const params: unknown[] = [req.params.id];
    for (const [c, v] of Object.entries(cols)) if (v !== undefined) { params.push(v); sets.push(`${c} = $${params.length}`); }
    const { rows } = sets.length
      ? await query<ResellerRow>(`UPDATE platform_resellers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)
      : { rows: before };
    await writePlatformAudit(req, null, { action: 'platform.reseller.update', entityType: 'platform_reseller', entityId: req.params.id, before: before[0], after: rows[0] });
    sendOk(res, dto(rows[0]!));
  }));

  r.delete('/resellers/:id', requirePerm('resellers', 'full'), asyncHandler(async (req, res) => {
    const { rows } = await query<ResellerRow>('DELETE FROM platform_resellers WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) throw notFound('Reseller not found');
    // Its networks keep running — they just have no reseller now (ON DELETE SET NULL).
    await writePlatformAudit(req, null, { action: 'platform.reseller.delete', entityType: 'platform_reseller', entityId: req.params.id, before: rows[0] });
    sendOk(res, { deleted: true });
  }));

  r.put('/networks/:id/reseller', requirePerm('resellers', 'full'), validateBody(z.object({ resellerId: z.string().uuid().nullable() }).strict()),
    asyncHandler(async (req, res) => {
      const networkId = req.params.id!;
      await assertNetworkInScope(req, networkId);
      const { resellerId } = req.body as { resellerId: string | null };
      if (resellerId && !(await query('SELECT 1 FROM platform_resellers WHERE id = $1', [resellerId])).rows.length) throw notFound('Reseller not found');
      const { rows } = await query<{ reseller_id: string | null }>('UPDATE networks SET reseller_id = $2 WHERE id = $1 RETURNING reseller_id', [networkId, resellerId]);
      if (!rows[0]) throw notFound('Network not found');
      await writePlatformAudit(req, networkId, { action: 'platform.network.reseller', entityType: 'network', entityId: networkId, after: { resellerId } });
      sendOk(res, { resellerId: rows[0].reseller_id });
    }));

  r.get('/networks/:id/white-label', requirePerm('networks', 'read'), asyncHandler(async (req, res) => {
    await assertNetworkInScope(req, req.params.id!);
    sendOk(res, whiteLabelDto(await whiteLabelFor(req.params.id!)));
  }));

  const wlPlatformSchema = whiteLabelPatchSchema.extend({ enabled: z.boolean().optional() }).strict();
  r.put('/networks/:id/white-label', requirePerm('resellers', 'full'), validateBody(wlPlatformSchema), asyncHandler(async (req, res) => {
    const networkId = req.params.id!;
    await assertNetworkInScope(req, networkId);
    if (!(await query('SELECT 1 FROM networks WHERE id = $1', [networkId])).rows.length) throw notFound('Network not found');
    const before = await whiteLabelFor(networkId);
    const saved = await saveWhiteLabel(networkId, req.body as z.infer<typeof wlPlatformSchema>);
    await writePlatformAudit(req, networkId, { action: 'platform.network.white_label', entityType: 'network', entityId: networkId, before: whiteLabelDto(before), after: whiteLabelDto(saved) });
    sendOk(res, whiteLabelDto(saved));
  }));

  r.post('/networks/:id/white-label/verify', requirePerm('resellers', 'full'), asyncHandler(async (req, res) => {
    await assertNetworkInScope(req, req.params.id!);
    sendOk(res, whiteLabelDto(await verifyWhiteLabelDomain(req.params.id!)));
  }));

  return r;
}
