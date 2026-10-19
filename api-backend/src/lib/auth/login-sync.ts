/**
 * Keep a person's Supabase login in step with what the dashboard enforces — for team members
 * (users rows) and partner / advertiser portal accounts alike. The database row is what each request
 * is checked against (lib/auth/staff-state.ts, lib/auth/portal-state.ts); the login is updated too so
 * a blocked person can't sign in or refresh a session at all, and a new role shows in their next token.
 * Best effort: Supabase being unconfigured or failing never fails the edit that triggered it — the
 * outcome is reported back (shown as `loginSync` by the routes).
 */
import { getSupabaseAdmin } from '../supabase.js';
import { logger } from '../logger.js';
import { forgetPortalAccount, portalAccessAllowed, type PortalKind } from './portal-state.js';

export type LoginSync = 'synced' | 'no_change' | 'no_login' | 'not_configured' | 'failed';

/** Supabase's longest practical ban (100 years) = "blocked until unblocked". */
const BLOCKED = '876000h';

export async function syncLogin(
  authUserId: string | null | undefined,
  change: { role?: string; blocked?: boolean },
): Promise<LoginSync> {
  if (change.role === undefined && change.blocked === undefined) return 'no_change';
  if (!authUserId) return 'no_login';
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try { sb = getSupabaseAdmin(); } catch { return 'not_configured'; }
  const { error } = await sb.auth.admin.updateUserById(authUserId, {
    ...(change.role !== undefined ? { app_metadata: { role: change.role } } : {}),
    ...(change.blocked !== undefined ? { ban_duration: change.blocked ? BLOCKED : 'none' } : {}),
  });
  if (error) {
    logger.warn({ err: error.message, authUserId }, 'login sync failed');
    return 'failed';
  }
  return 'synced';
}

/**
 * Delete a login whose account is gone (a deleted partner / advertiser): its refresh tokens die with
 * it, and the email is free to be invited again. A login that's already gone counts as removed.
 */
export async function removeLogin(authUserId: string | null | undefined): Promise<'removed' | 'no_login' | 'not_configured' | 'failed'> {
  if (!authUserId) return 'no_login';
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try { sb = getSupabaseAdmin(); } catch { return 'not_configured'; }
  const { error } = await sb.auth.admin.deleteUser(authUserId);
  if (error && !(error.status === 404 || error.code === 'user_not_found')) {
    logger.warn({ err: error.message, authUserId }, 'login removal failed');
    return 'failed';
  }
  return 'removed';
}

/**
 * After an account's status changed: forget the cached state (this process applies it at once,
 * others within 15 s) and block / unblock its login, so an inactive account can't sign in or refresh
 * a session either. Returns what happened to the login.
 */
export async function applyPortalStatusChange(
  networkId: string, kind: PortalKind, account: { id: string; auth_user_id: string | null }, before: string, after: string,
): Promise<LoginSync> {
  forgetPortalAccount(networkId, kind, account.id);
  const wasAllowed = portalAccessAllowed(before);
  const isAllowed = portalAccessAllowed(after);
  if (wasAllowed === isAllowed) return 'no_change';
  return syncLogin(account.auth_user_id, { blocked: !isAllowed });
}
