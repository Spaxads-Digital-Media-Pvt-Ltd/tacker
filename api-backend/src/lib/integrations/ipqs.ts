/**
 * IPQualityScore IP reputation lookup. Called from the click-persist worker (never the /click hot
 * path) for offers with "Enable IPQualityScore Fraud Detection" on, using the network's API key from
 * Integrations. Fail-open: no key / timeout / API error → null, click persists unchanged.
 */
import { loadIntegrations } from './settings.js';

const KEY_TTL_MS = 60_000;
const keyCache = new Map<string, { key: string | null; at: number }>();

async function apiKeyFor(networkId: string): Promise<string | null> {
  const hit = keyCache.get(networkId);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.key;
  const cfg = await loadIntegrations(networkId);
  const key = typeof cfg['ipQualityScoreApiKey'] === 'string' && cfg['ipQualityScoreApiKey'] ? (cfg['ipQualityScoreApiKey'] as string) : null;
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
