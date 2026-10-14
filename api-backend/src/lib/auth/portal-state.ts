/**
 * A partner's / advertiser's portal access, for dashboardAuth and API-key auth. The account row is
 * the source of truth: once an account is deleted, or set inactive, its portal sessions and API keys
 * stop working on their next request — not whenever the login token happens to expire. Pending
 * accounts keep access (they sign in to follow their application). Kept in process for 15 s per
 * account; the routes that change an account's status or delete it forget it at once on their own
 * process.
 */
import { query } from '../db/pool.js';

export type PortalKind = 'publisher' | 'advertiser';

const TABLE: Record<PortalKind, string> = { publisher: 'publishers', advertiser: 'advertisers' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 15_000;
const MAX_ENTRIES = 10_000;
const cache = new Map<string, { at: number; status: string | null }>();

/** The account's status, or null when it no longer exists in this network. */
export async function portalAccountStatus(networkId: string, kind: PortalKind, ownerId: string): Promise<string | null> {
  if (!UUID_RE.test(ownerId)) return null;
  const key = `${networkId}:${kind}:${ownerId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  const { rows } = await query<{ status: string }>(
    `SELECT status FROM ${TABLE[kind]} WHERE network_id = $1 AND id = $2`, [networkId, ownerId]);
  const status = rows[0]?.status ?? null;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), status });
  return status;
}

export function forgetPortalAccount(networkId: string, kind: PortalKind, ownerId: string): void {
  cache.delete(`${networkId}:${kind}:${ownerId}`);
}

/** Inactive accounts have no portal or API access; active and pending ones do. */
export const portalAccessAllowed = (status: string): boolean => status !== 'inactive';

export const portalLabel = (kind: PortalKind): string => (kind === 'publisher' ? 'partner' : 'advertiser');

export const inactiveAccountMessage = (kind: PortalKind): string =>
  `This ${portalLabel(kind)} account is inactive, so its portal and API access are off. Contact the network to re-enable it.`;

export const deletedAccountMessage = (kind: PortalKind): string =>
  `This ${portalLabel(kind)} account no longer exists.`;
