/**
 * A team member's current role and status, for dashboardAuth. The users table is the source of
 * truth for dashboard permissions, so an admin's edit — a role change, disabling someone — applies
 * on that person's next request, not whenever their login token next refreshes (the token's role
 * claim is only the fallback for logins with no users row). Kept in process for 15 s per login;
 * the edit route forgets it at once on its own process.
 */
import { query } from '../db/pool.js';

export interface StaffState { role: string; status: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 15_000;
const MAX_ENTRIES = 10_000;
const cache = new Map<string, { at: number; state: StaffState | null }>();

export async function staffState(networkId: string, authUserId: string): Promise<StaffState | null> {
  if (!UUID_RE.test(authUserId)) return null;
  const key = `${networkId}:${authUserId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
  const { rows } = await query<StaffState>(
    'SELECT role, status FROM users WHERE network_id = $1 AND auth_user_id = $2', [networkId, authUserId]);
  const state = rows[0] ?? null;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), state });
  return state;
}

export function forgetStaffState(networkId: string, authUserId: string | null | undefined): void {
  if (authUserId) cache.delete(`${networkId}:${authUserId}`);
}
