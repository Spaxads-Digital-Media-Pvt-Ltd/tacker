/**
 * Feature flags (Super Admin › Platform › Feature flags) — whether a tenant feature is on for a network.
 *
 * A feature with no flag is ON (flags only ever take features away from the default). With a flag, in order:
 *   kill switch → off for everyone;  listed "off" → off;  listed "on" → on;  on one of its plans → on;
 *   enabled → on;  else on for `rollout_percent` % of networks — chosen by a stable hash of the flag and the
 *   network, so the same networks stay in as the percentage grows; else off.
 *
 * GATEABLE are the features the API also refuses when off (requireFeature on their routes, 403
 * `feature_off`); any other key is a flag the SPA reads from /api/me `features` (for new work).
 * Flags and each network's plan are cached for 10 s per process.
 */
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { AppError } from '../http/errors.js';

export const GATEABLE: readonly { key: string; name: string; description: string }[] = [
  { key: 'ai_assistant', name: 'AI assistant', description: 'The AI analyst and its tools (/api/ai).' },
  { key: 'smartswitch', name: 'SmartSwitch', description: 'Automatic traffic switching rules (/api/smartswitch).' },
  { key: 'automation', name: 'Automation', description: 'Scheduled actions, alerts and webhooks (/api/automation).' },
  { key: 'fraud_investigator', name: 'Investigator', description: 'The fraud investigator (/api/investigator).' },
  { key: 'traffic_health', name: 'Traffic Health', description: 'Traffic quality reports (/api/traffic-health).' },
  { key: 'marketplace', name: 'Marketplace', description: 'The marketplace profile and connections (/api/marketplace-profile).' },
];

export interface FlagRow {
  id: string; key: string; name: string; description: string | null; enabled: boolean; rollout_percent: number;
  plan_ids: string[]; network_ids_on: string[]; network_ids_off: string[]; kill_switch: boolean;
}

/** The network's place in a flag's rollout, 0–99 (stable). */
export const rolloutBucket = (key: string, networkId: string): number =>
  createHash('sha256').update(`${key}:${networkId}`).digest().readUInt32BE(0) % 100;

/** Is `flag` on for a network on plan `planId`? (pure) */
export function evaluateFlag(flag: Pick<FlagRow, 'key' | 'enabled' | 'rollout_percent' | 'plan_ids' | 'network_ids_on' | 'network_ids_off' | 'kill_switch'>,
  networkId: string, planId: string | null): boolean {
  if (flag.kill_switch) return false;
  if (flag.network_ids_off.includes(networkId)) return false;
  if (flag.network_ids_on.includes(networkId)) return true;
  if (planId && flag.plan_ids.includes(planId)) return true;
  if (flag.enabled) return true;
  return flag.rollout_percent > 0 && rolloutBucket(flag.key, networkId) < flag.rollout_percent;
}

const TTL = 10_000;
let flagsCache: { at: number; rows: FlagRow[] } | null = null;
const planCache = new Map<string, { at: number; planId: string | null }>();

export async function allFlags(): Promise<FlagRow[]> {
  if (flagsCache && Date.now() - flagsCache.at < TTL) return flagsCache.rows;
  const rows = (await query<FlagRow>('SELECT * FROM platform_feature_flags ORDER BY key')).rows;
  flagsCache = { at: Date.now(), rows };
  return rows;
}

/** After a change on this process (other processes catch up within the TTL). */
export function forgetFlags(): void { flagsCache = null; planCache.clear(); }

async function livePlan(networkId: string): Promise<string | null> {
  const hit = planCache.get(networkId);
  if (hit && Date.now() - hit.at < TTL) return hit.planId;
  const planId = (await query<{ plan_id: string }>(
    `SELECT plan_id FROM subscriptions WHERE network_id = $1 AND status IN ('trialing', 'active', 'past_due')`, [networkId])).rows[0]?.plan_id ?? null;
  planCache.set(networkId, { at: Date.now(), planId });
  return planId;
}

/** Every flag's answer for a network ({ key: on? }); keys without a flag aren't listed (= on). */
export async function featuresFor(networkId: string): Promise<Record<string, boolean>> {
  const flags = await allFlags();
  if (!flags.length) return {};
  const planId = await livePlan(networkId);
  return Object.fromEntries(flags.map((f) => [f.key, evaluateFlag(f, networkId, planId)]));
}

/** Refuse a gateable feature's API when its flag is off for the caller's network. */
export function requireFeature(key: string) {
  const name = GATEABLE.find((g) => g.key === key)?.name ?? key;
  return (req: Request, _res: Response, next: NextFunction): void => {
    const networkId = req.scope?.networkId;
    if (!networkId) return next();
    featuresFor(networkId)
      .then((f) => (f[key] === false
        ? next(new AppError('forbidden', `${name} isn’t enabled for your network. Contact the platform team to turn it on.`, { reason: 'feature_off', feature: key }))
        : next()))
      .catch(next);
  };
}
