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
import { env } from '../../config/env.js';
import { AppError } from '../http/errors.js';

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

const DAY_MS = 86_400_000;

/**
 * Why a network's logins are refused, or null when it is active — one answer for the dashboard / portal
 * auth, sign-in and session refresh, each with a `reason` the SPA ends the session on and explains:
 * - `network_suspended` (403);
 * - `network_deleted` (403) — soft-deleted: restorable until `purgeAfter` (the grace period), then the
 *   platform administrator can purge it for good;
 * - `network_purged` (401) — gone: its logins' tokens still name it, but nothing is left behind them.
 */
export async function networkAccessError(networkId: string): Promise<AppError | null> {
  const state = await networkState(networkId);
  if (state === 'active') return null;
  if (state === null) {
    return new AppError('unauthorized', 'This login belongs to a network that no longer exists — it was deleted and its data removed. Sign in with an account on an active network.',
      { reason: 'network_purged' });
  }
  if (state === 'suspended') {
    // Suspended for an unpaid platform invoice (billing) — say so: paying (or more time) brings it back.
    const why = (await query<{ suspended_reason: string | null }>('SELECT suspended_reason FROM networks WHERE id = $1', [networkId])).rows[0]?.suspended_reason;
    return why === 'billing'
      ? new AppError('forbidden', 'This network is suspended for an unpaid invoice — tracking, the dashboard and the API are off until it is paid. Contact the platform administrator.',
        { reason: 'network_suspended', billing: true })
      : new AppError('forbidden', inactiveNetworkMessage('suspended'), { reason: 'network_suspended' });
  }
  const { rows } = await query<{ deleted_at: Date | null }>('SELECT deleted_at FROM networks WHERE id = $1', [networkId]);
  const deletedAt = rows[0]?.deleted_at ?? null;
  const purgeAfter = deletedAt ? new Date(deletedAt.getTime() + env.NETWORK_PURGE_GRACE_DAYS * DAY_MS) : null;
  return new AppError('forbidden',
    `This network is deleted — tracking, the dashboard and the API are off.${purgeAfter ? ` It can still be restored until ${purgeAfter.toISOString().slice(0, 10)}, after which it may be removed for good.` : ''} Contact the platform administrator.`,
    { reason: 'network_deleted', deletedAt: deletedAt?.toISOString() ?? null, purgeAfter: purgeAfter?.toISOString() ?? null });
}
