/**
 * Auth client — talks ONLY to the backend auth endpoints (spec §0). The refresh token lives in
 * an httpOnly cookie the browser sends automatically (credentials: 'include'); JS never sees it.
 */
import { saveSession, clearSession, updateToken, type Session } from '../auth/session';
import type { Role } from '../auth/roles';

interface Identity {
  kind: string;
  networkId: string | null;
  role: string | null;
  ownerId: string | null;
  email: string;
  name?: string;
}
interface AuthPayload {
  accessToken: string;
  expiresAt: number | null;
  identity: Identity;
}

const KIND_TO_ROLE: Record<string, Role> = {
  platform_admin: 'super_admin',
  admin: 'admin',
  publisher: 'publisher',
  advertiser: 'advertiser',
};

function toSession(p: AuthPayload): Session {
  const role = KIND_TO_ROLE[p.identity.kind];
  if (!role) throw new Error(`Unknown account kind: ${p.identity.kind}`);
  return {
    token: p.accessToken,
    role,
    displayName: p.identity.name ?? p.identity.email.split('@')[0] ?? p.identity.email,
    email: p.identity.email,
    networkId: p.identity.networkId,
    ownerId: p.identity.ownerId,
    expiresAt: p.expiresAt,
  };
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error?.message ?? 'Login failed');
  const session = toSession(body.data as AuthPayload);
  saveSession(session);
  return session;
}

/**
 * Exchange the httpOnly refresh cookie for a fresh access token. Returns the new token, or null
 * if the session is gone (caller should send the user back to login). Deduped so concurrent 401s
 * trigger a single refresh.
 */
let inflight: Promise<string | null> | null = null;
export function refreshToken(): Promise<string | null> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          clearSession();
          return null;
        }
        const p = body.data as AuthPayload;
        updateToken(p.accessToken, p.expiresAt);
        return p.accessToken;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    /* ignore network errors on logout */
  }
  clearSession();
}
