/**
 * A network's lifecycle state (audit F-26): 'active' | 'suspended' | 'deleted' (soft-deleted), or
 * null when there is no such network. Only an active network tracks, serves its dashboard / portals
 * and answers its API keys.
 *
 * Request paths ask `networkState()`: an 'active' answer is kept in process for 15 s (one primary-key
 * read per network per 15 s), anything else is re-read every time. A status change calls
 * `networkStateChanged()`, which forgets the state here and drops the network's tracking hosts from
 * the host cache — tracking stops / resumes at once everywhere; another dashboard process follows
 * within 15 s.
 */
import { query } from '../db/pool.js';

export type NetworkState = 'active' | 'suspended' | 'deleted';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_TTL_MS = 15_000;
const activeUntil = new Map<string, number>();

export async function networkState(networkId: string): Promise<NetworkState | null> {
  if (!UUID_RE.test(networkId)) return null;
  const until = activeUntil.get(networkId);
  if (until && until > Date.now()) return 'active';
  const { rows } = await query<{ status: NetworkState }>('SELECT status FROM networks WHERE id = $1', [networkId]);
  const state = rows[0]?.status ?? null;
  if (state === 'active') activeUntil.set(networkId, Date.now() + ACTIVE_TTL_MS);
  else activeUntil.delete(networkId);
  return state;
}

/** Call after a network's status changes (or the network is purged). */
export async function networkStateChanged(networkId: string): Promise<void> {
  activeUntil.delete(networkId);
  // Loaded here, not at the top: the request paths that read the state never need the host cache.
  const { invalidateHost } = await import('../../surfaces/tracking/host-resolver-db.js');
  const { rows } = await query<{ host: string }>('SELECT host FROM tracking_domains WHERE network_id = $1', [networkId]);
  await Promise.all(rows.map((r) => invalidateHost(r.host).catch(() => undefined)));
}

/** The 403 message for a network that isn't active. */
export const inactiveNetworkMessage = (state: Exclude<NetworkState, 'active'>): string =>
  `This network is ${state === 'deleted' ? 'deleted' : 'suspended'} — tracking, the dashboard and the API are off. Contact the platform administrator.`;
