/**
 * API key generation + hashing (spec §8A). Prefix encodes audience + environment
 * (adv_live_… / pub_live_… / net_live_…). We store only the sha256 HASH of the full secret; the
 * full key is returned to the caller exactly once at creation and never again. The prefix alone
 * tells you the audience, but the audience is ALWAYS re-verified server-side against the stored
 * record — the prefix is never trusted as authority.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { ApiAudience } from '../../middleware/types.js';

const ABBR: Record<ApiAudience, string> = { advertiser: 'adv', publisher: 'pub', network: 'net' };

/** Full permission ceiling per audience. Minted keys can narrow this, never exceed it (spec §8A). */
export const AUDIENCE_SCOPES: Record<ApiAudience, string[]> = {
  advertiser: ['offers:read', 'conversions:read', 'conversions:write', 'stats:read', 'settings:manage'],
  publisher: ['offers:read', 'clicks:read', 'conversions:read', 'earnings:read', 'stats:read', 'postbacks:manage', 'links:generate'],
  network: ['offers:read', 'offers:write', 'publishers:read', 'advertisers:read', 'reports:read', 'payouts:write'],
};

export interface GeneratedKey {
  prefix: string;   // public, safe to display/store
  fullKey: string;  // returned ONCE to the user
  keyHash: string;  // stored
}

export function hashKey(fullKey: string): string {
  return createHash('sha256').update(fullKey).digest('hex');
}

export function generateApiKey(audience: ApiAudience, env: 'live' | 'test' = 'live'): GeneratedKey {
  const publicId = randomBytes(4).toString('hex'); // 8 chars, shown in UI
  const prefix = `${ABBR[audience]}_${env}_${publicId}`;
  const secret = randomBytes(24).toString('base64url');
  const fullKey = `${prefix}_${secret}`;
  return { prefix, fullKey, keyHash: hashKey(fullKey) };
}

/** Validate requested scopes stay within the audience ceiling (narrow-only). */
export function sanitizeScopes(audience: ApiAudience, requested?: string[]): string[] {
  const ceiling = new Set(AUDIENCE_SCOPES[audience]);
  if (!requested || requested.length === 0) return [...ceiling]; // default: full ceiling
  return requested.filter((s) => ceiling.has(s));
}
