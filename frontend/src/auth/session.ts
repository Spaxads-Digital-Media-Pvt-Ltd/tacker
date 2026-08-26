/**
 * Client session persistence. Holds the Supabase-issued JWT (obtained via the backend
 * /api/auth/login exchange — the browser never talks to Supabase directly) plus the identity the
 * SPA renders from. The backend re-verifies the token and enforces authorization independently
 * (spec §3A).
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
}

/** Update just the access token + expiry after a silent refresh, keeping identity fields. */
export function updateToken(token: string, expiresAt: number | null): void {
  const s = loadSession();
  if (s) saveSession({ ...s, token, expiresAt });
}

// Bumped to v2 with the role rename (network admin + super admin) so any stale cached session is
// dropped and the user re-logs in cleanly with the current role values.
export const SESSION_KEY = 'tracker.session.v2';
const KEY = SESSION_KEY;

export function loadSession(): Session | null {
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
  localStorage.removeItem(KEY);
}

export function getToken(): string | null {
  return loadSession()?.token ?? null;
}
