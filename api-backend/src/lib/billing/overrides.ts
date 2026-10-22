/**
 * A network's plan overrides (network_plan_overrides) — a deal that differs from its plan: a custom price,
 * billing exempt, and limits merged over the plan's (a number replaces the plan's limit, null = unlimited, a
 * key left out keeps the plan's). Applied wherever the plan is priced or limited: the billing engine's
 * renewals and assignPlan (effectivePlan), usage vs limits (lib/usage/meter.ts) and MRR (revenue.ts).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db/pool.js';

type Db = Pick<PoolClient, 'query'>;

export const OVERRIDE_LIMIT_KEYS = ['clicks', 'conversions', 'events', 'offers', 'seats'] as const;

export interface NetworkOverrides {
  priceCents: number | null; billingExempt: boolean; limits: Partial<Record<(typeof OVERRIDE_LIMIT_KEYS)[number], number | null>>;
  note: string | null; updatedAt: string | null; updatedBy: string | null;
}

export const overridesSchema = z.object({
  price: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be an amount like 499 or 499.50').nullable(),
  billingExempt: z.boolean(),
  limits: z.object(Object.fromEntries(OVERRIDE_LIMIT_KEYS.map((k) => [k, z.number().int().min(1).max(1e12).nullable()]))).partial().strict(),
  note: z.string().trim().max(500).transform((v) => v || null).nullable().optional(),
}).strict();

export async function networkOverrides(networkId: string, db: Db = pool): Promise<NetworkOverrides | null> {
  const r = (await db.query<{ price_cents: number | null; billing_exempt: boolean; limits: NetworkOverrides['limits']; note: string | null; updated_at: string; updated_by: string | null }>(
    'SELECT price_cents, billing_exempt, limits, note, updated_at, updated_by FROM network_plan_overrides WHERE network_id = $1', [networkId])).rows[0];
  return r ? { priceCents: r.price_cents, billingExempt: r.billing_exempt, limits: r.limits ?? {}, note: r.note, updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
}

/** Plan limits with the overrides merged in (null = no limit, so the key is dropped). */
export function mergeLimits(planLimits: Record<string, unknown> | null | undefined, o: NetworkOverrides | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(planLimits ?? {}) };
  for (const [k, v] of Object.entries(o?.limits ?? {})) {
    if (v === null) delete out[k]; else out[k] = v;
  }
  return out;
}

/** The plan as this network pays for it and is limited by it, and whether it's billed at all. */
export function effectivePlan<P extends { price_cents: number; limits: Record<string, unknown> }>(plan: P, o: NetworkOverrides | null): P & { billable: boolean } {
  const price = o?.priceCents ?? plan.price_cents;
  return { ...plan, price_cents: price, limits: mergeLimits(plan.limits, o), billable: !o?.billingExempt && price > 0 };
}
