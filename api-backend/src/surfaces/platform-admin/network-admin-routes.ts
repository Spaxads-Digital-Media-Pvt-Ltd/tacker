/**
 * Super Admin › Networks — plan overrides and bulk actions.
 *
 * - GET / PUT /networks/:id/overrides — a network's deal when it differs from its plan (lib/billing/overrides.ts):
 *   a custom price, billing exempt, limit overrides (a number, or null = unlimited), a note. Read with
 *   networks:read, changed with plans:full. Saving nothing (plan price, billed, no limits, no note) removes it.
 * - POST /networks/bulk { ids (≤ 200), action, … } — the same change to many networks: suspend / activate
 *   (networks:full), account manager / seller (success:full), plan (plans:full), reseller (resellers:full),
 *   add a tag (success:full). Each network is done on its own (in scope, audited as the single action is);
 *   the answer lists which ones failed and why.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody } from '../../lib/http/validate.js';
import { AppError, badRequest, forbidden, notFound } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { setNetworkStatus } from '../../lib/networks/lifecycle.js';
import { assignPlan } from '../../lib/billing/subscriptions.js';
import { centsToDecimal } from '../../lib/billing/invoices.js';
import { networkOverrides, overridesSchema } from '../../lib/billing/overrides.js';
import { toCents } from '../../lib/billing/charges.js';
import { notifyInvoiceIssued } from '../../lib/platform/notify.js';
import type { Section } from '../../lib/platform/permissions.js';
import { requirePerm, can, assertNetworkInScope } from './auth.js';
import { UUID_RE, meId } from './fields.js';

const BULK_ACTIONS = ['suspend', 'activate', 'account_manager', 'sales_owner', 'plan', 'reseller', 'add_tag'] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];
const SECTION: Record<BulkAction, Section> = {
  suspend: 'networks', activate: 'networks', account_manager: 'success', sales_owner: 'success', plan: 'plans', reseller: 'resellers', add_tag: 'success',
};

const bulkSchema = z.object({
  ids: z.array(z.string().regex(UUID_RE, 'must be network ids')).min(1).max(200),
  action: z.enum(BULK_ACTIONS),
  memberId: z.string().regex(UUID_RE).nullable().optional(),
  planId: z.string().regex(UUID_RE).optional(),
  resellerId: z.string().regex(UUID_RE).nullable().optional(),
  tag: z.string().trim().min(1).max(40).optional(),
}).strict();

async function loadInScope(req: Request, id: string): Promise<{ id: string; name: string; status: string }> {
  if (!UUID_RE.test(id)) throw notFound('Network not found');
  await assertNetworkInScope(req, id);
  const n = (await query<{ id: string; name: string; status: string }>('SELECT id, name, status FROM networks WHERE id = $1', [id])).rows[0];
  if (!n) throw notFound('Network not found');
  return n;
}

const overridesView = async (networkId: string) => {
  const o = await networkOverrides(networkId);
  const by = o?.updatedBy ? (await query<{ name: string }>('SELECT COALESCE(name, email) AS name FROM platform_admins WHERE id = $1', [o.updatedBy])).rows[0]?.name ?? null : null;
  return o ? { price: o.priceCents === null ? null : centsToDecimal(o.priceCents), billingExempt: o.billingExempt, limits: o.limits, note: o.note, updatedAt: o.updatedAt, updatedBy: by } : null;
};

export function networkAdminRoutes(): Router {
  const r = Router();

  r.get('/networks/:id/overrides', requirePerm('networks', 'read'), asyncHandler(async (req, res) => {
    await loadInScope(req, req.params.id!);
    sendOk(res, await overridesView(req.params.id!));
  }));

  r.put('/networks/:id/overrides', requirePerm('plans', 'full'), validateBody(overridesSchema), asyncHandler(async (req, res) => {
    const n = await loadInScope(req, req.params.id!);
    const b = req.body as z.infer<typeof overridesSchema>;
    const before = await overridesView(n.id);
    const empty = b.price === null && !b.billingExempt && Object.keys(b.limits).length === 0 && !b.note;
    if (empty) {
      await query('DELETE FROM network_plan_overrides WHERE network_id = $1', [n.id]);
    } else {
      await query(
        `INSERT INTO network_plan_overrides (network_id, price_cents, billing_exempt, limits, note, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (network_id) DO UPDATE SET price_cents = EXCLUDED.price_cents, billing_exempt = EXCLUDED.billing_exempt, limits = EXCLUDED.limits,
           note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [n.id, b.price === null ? null : toCents(b.price), b.billingExempt, JSON.stringify(b.limits), b.note ?? null, meId(req)]);
    }
    const after = await overridesView(n.id);
    await writePlatformAudit(req, n.id, { action: 'network.overrides', entityType: 'network', entityId: n.id, before, after });
    sendOk(res, after);
  }));

  r.post('/networks/bulk', validateBody(bulkSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof bulkSchema>;
    if (!can(req, SECTION[b.action], 'full')) throw forbidden('Your role can’t make this change.');
    // What the action needs, checked once.
    if (b.action === 'account_manager' || b.action === 'sales_owner') {
      if (b.memberId === undefined) throw badRequest('Choose a member (or none).');
      if (b.memberId) {
        const m = (await query<{ status: string }>('SELECT status FROM platform_admins WHERE id = $1', [b.memberId])).rows[0];
        if (!m || m.status !== 'active') throw badRequest('Choose an active member of the platform team.');
      }
    }
    if (b.action === 'plan' && !b.planId) throw badRequest('Choose a plan.');
    if (b.action === 'reseller') {
      if (b.resellerId === undefined) throw badRequest('Choose a reseller (or none).');
      if (b.resellerId && !(await query('SELECT 1 FROM platform_resellers WHERE id = $1', [b.resellerId])).rows.length) throw badRequest('That reseller doesn’t exist.');
    }
    if (b.action === 'add_tag' && !b.tag) throw badRequest('Enter a tag.');

    const failed: { id: string; name: string | null; error: string }[] = [];
    let done = 0;
    for (const id of [...new Set(b.ids)]) {
      let name: string | null = null;
      try {
        const n = await loadInScope(req, id);
        name = n.name;
        switch (b.action) {
          case 'suspend':
          case 'activate': {
            if (n.status === 'deleted') throw badRequest('It’s deleted — restore it from its own page.');
            const to = b.action === 'suspend' ? 'suspended' : 'active';
            if (n.status === to) break;
            const { before, after } = await setNetworkStatus(id, to);
            await writePlatformAudit(req, id, { action: 'network.update', entityType: 'network', entityId: id, before, after: { ...after, bulk: true } });
            break;
          }
          case 'account_manager':
          case 'sales_owner': {
            const col = b.action === 'account_manager' ? 'account_manager_id' : 'sales_owner_id';
            await query(`UPDATE networks SET ${col} = $2 WHERE id = $1`, [id, b.memberId]);
            await writePlatformAudit(req, id, { action: 'network.account', entityType: 'network', entityId: id, after: { [b.action === 'account_manager' ? 'accountManagerId' : 'salesOwnerId']: b.memberId, bulk: true } });
            break;
          }
          case 'plan': {
            const out = await assignPlan(id, b.planId!, {}, meId(req));
            if (out.invoice) await notifyInvoiceIssued(out.invoice.id);
            await writePlatformAudit(req, id, { action: out.changed ? 'subscription.change_plan' : 'subscription.assign', entityType: 'subscription', entityId: out.subscription.id, before: out.before, after: { ...out.subscription, bulk: true } });
            break;
          }
          case 'reseller':
            await query('UPDATE networks SET reseller_id = $2 WHERE id = $1', [id, b.resellerId]);
            await writePlatformAudit(req, id, { action: 'platform.network.reseller', entityType: 'network', entityId: id, after: { resellerId: b.resellerId, bulk: true } });
            break;
          case 'add_tag':
            await query(
              `INSERT INTO network_accounts (network_id, tags) VALUES ($1, ARRAY[$2]::text[])
               ON CONFLICT (network_id) DO UPDATE SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(network_accounts.tags || ARRAY[$2]::text[]) ORDER BY 1))`,
              [id, b.tag!.toLowerCase()]);
            await writePlatformAudit(req, id, { action: 'network.account', entityType: 'network', entityId: id, after: { addTag: b.tag!.toLowerCase(), bulk: true } });
            break;
        }
        done++;
      } catch (err) {
        failed.push({ id, name, error: err instanceof AppError ? err.message : 'Something went wrong' });
      }
    }
    sendOk(res, { done, failed });
  }));

  return r;
}
