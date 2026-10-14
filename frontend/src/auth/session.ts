/**
 * Client session persistence. Holds the Supabase-issued JWT (obtained via the backend
 * /api/auth/login exchange — the browser never talks to Supabase directly) plus the identity the
 * SPA renders from. The backend re-verifies the token and enforces authorization independently
 * (spec §3A).
 *
 * An admin impersonating a portal account (F-10) gets a session for THIS TAB only, kept in
 * sessionStorage: while it exists it is the tab's session, and clearing it ends the impersonation —
 * the admin's own sign-in (localStorage, shared by every tab) is never replaced, refreshed or
 * signed out from that tab.
 */
import type { Role } from './roles';

export interface Session {
  token: string;
  role: Role;
  displayName: string;
  email: string;
  networkId: string | null;
  ownerId: string | null;
  /** Unix seconds when the access token expires (from Supabase). */
  expiresAt: number | null;
  /** Set on an impersonation session: the id of the admin viewing this portal account. */
  impersonatedBy?: string;
}

/** Update just the access token + expiry after a silent refresh, keeping identity fields. */
export function updateToken(token: string, expiresAt: number | null): void {
  if (isImpersonating()) return; // an impersonation token is never refreshed
  const s = loadSession();
  if (s) saveSession({ ...s, token, expiresAt });
}

// Bumped to v2 with the role rename (network admin + super admin) so any stale cached session is
// dropped and the user re-logs in cleanly with the current role values.
export const SESSION_KEY = 'tracker.session.v2';
const KEY = SESSION_KEY;
const IMPERSONATION_KEY = 'tracker.impersonation.v1';

function loadImpersonation(): Session | null {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return loadImpersonation() !== null;
}

/** Make `session` this tab's impersonation session (see the header). */
export function startImpersonation(session: Session): void {
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const impersonation = loadImpersonation();
  if (impersonation) return impersonation;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  // In an impersonation tab this ends the impersonation — never the admin's own session.
  if (isImpersonating()) {
    try { sessionStorage.removeItem(IMPERSONATION_KEY); } catch { /* storage unavailable */ }
    return;
  }
  localStorage.removeItem(KEY);
}

export function getToken(): string | null {
  return loadSession()?.token ?? null;
}
