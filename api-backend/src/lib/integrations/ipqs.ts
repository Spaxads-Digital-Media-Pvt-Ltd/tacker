/**
 * IPQualityScore IP reputation lookup. Called from the click-persist worker (never the /click hot
 * path) for offers with "Enable IPQualityScore Fraud Detection" on, using the network's API key from
 * Integrations. Fail-open: no key / timeout / API error → null, click persists unchanged.
 *
 * Verdicts are cached per network + IP in Redis for a day (F-23): the worker looks an IP up once
 * instead of on every click, and /click folds the cached verdict into the score of the IP's later
 * clicks (one Redis GET — the hot path never calls IPQS itself).
 */
import { createHash } from 'node:crypto';
import { loadIntegrations, secretValue } from './settings.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';

const KEY_TTL_MS = 60_000;
const keyCache = new Map<string, { key: string | null; at: number }>();

async function apiKeyFor(networkId: string): Promise<string | null> {
  const hit = keyCache.get(networkId);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.key;
  const cfg = await loadIntegrations(networkId);
  let key: string | null = null;
  try {
    key = secretValue(cfg, 'ipQualityScoreApiKey'); // stored encrypted (F-07)
  } catch (err) {
    logger.warn({ err, networkId }, 'IPQS API key could not be decrypted — lookups skipped');
  }
  keyCache.set(networkId, { key, at: Date.now() });
  return key;
}

export interface IpqsResult { score: number; flags: string[] }

export async function ipqsLookup(networkId: string, ip: string): Promise<IpqsResult | null> {
  const key = await apiKeyFor(networkId);
  if (!key) return null;
  try {
    const res = await fetch(
      `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(key)}/${encodeURIComponent(ip)}?strictness=1`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    if (j['success'] !== true) return null;
    const flags: string[] = [];
    if (j['proxy'] === true) flags.push('ipqs_proxy');
    if (j['vpn'] === true) flags.push('ipqs_vpn');
    if (j['tor'] === true) flags.push('ipqs_tor');
    if (j['bot_status'] === true) flags.push('ipqs_bot');
    const score = Number(j['fraud_score']);
    return { score: Number.isFinite(score) ? score : 0, flags };
  } catch {
    return null;
  }
}

const VERDICT_TTL_S = 24 * 3600;

/** Per network: a lookup is paid for with that network's own key, so its verdicts stay its own. */
export const ipqsCacheKey = (networkId: string, ip: string): string =>
  `ipqs:${networkId}:${createHash('sha1').update(ip).digest('hex').slice(0, 16)}`;

export function parseIpqsVerdict(raw: string | null | undefined): IpqsResult | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<IpqsResult>;
    return typeof v.score === 'number' && Array.isArray(v.flags) ? { score: v.score, flags: v.flags } : null;
  } catch {
    return null;
  }
}

/** The IP's verdict: from the cache, else looked up (and cached — failures aren't). */
export async function ipqsVerdict(networkId: string, ip: string): Promise<IpqsResult | null> {
  const key = ipqsCacheKey(networkId, ip);
  const cached = parseIpqsVerdict(await getRedis().get(key).catch(() => null));
  if (cached) return cached;
  const fresh = await ipqsLookup(networkId, ip);
  if (fresh) await getRedis().set(key, JSON.stringify(fresh), 'EX', VERDICT_TTL_S).catch(() => undefined);
  return fresh;
}
