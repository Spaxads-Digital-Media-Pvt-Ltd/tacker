/**
 * Auth client — talks ONLY to the backend auth endpoints (spec §0). The refresh token lives in
 * an httpOnly cookie the browser sends automatically (credentials: 'include'); JS never sees it.
 */
import { ApiError } from '../lib/api.js';
import { saveSession, clearSession, updateToken, isImpersonating, loadSession, markPasswordChanged, type Session } from './session';
import type { Role } from './roles';

interface Identity {
  kind: string;
  networkId: string | null;
  role: string | null;
  ownerId: string | null;
  email: string;
  name?: string;
  mustChangePassword?: boolean;
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
    ...(p.identity.mustChangePassword ? { mustChangePassword: true } : {}),
  };
}

/** POST to an unauthenticated /api/auth endpoint; throws ApiError with the server's message. */
async function authPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new ApiError(json.error?.code ?? 'request_failed', json.error?.message ?? 'Something went wrong', res.status, json.error?.details);
}

/** "Forgot password?" — the server answers the same for any address (it never says which exist). */
export const requestPasswordReset = (email: string): Promise<void> => authPost('/api/auth/forgot-password', { email });

/** Redeem the emailed link's token with the new password. */
export const resetPassword = (token: string, password: string): Promise<void> => authPost('/api/auth/reset-password', { token, password });

/**
 * First sign-in with a temporary password (O1): set the new password, then trade the refresh cookie
 * for a token that no longer carries "must change password".
 */
export async function changeInitialPassword(password: string): Promise<void> {
  const token = loadSession()?.token;
  const res = await fetch('/api/me/password', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'include', body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new ApiError(json.error?.code ?? 'request_failed', json.error?.message ?? 'Could not update the password', res.status, json.error?.details);
  if (!(await refreshToken())) throw new ApiError('unauthorized', 'Your password was updated — sign in again with it.', 401);
  markPasswordChanged();
}

/**
 * A refused sign-in as an ApiError the login page can show: a validation failure says what's wrong
 * ("Password must be at least 12 characters.") instead of "Request body failed validation".
 */
function signInError(body: { error?: { code?: string; message?: string; details?: unknown } }, status: number, fallback: string): ApiError {
  const details = body.error?.details;
  const reasons = details && typeof details === 'object' ? Object.values(details as Record<string, unknown>).flat() : [];
  const reason = status === 422 ? reasons.find((r): r is string => typeof r === 'string' && r.length > 0) : undefined;
  return new ApiError(body.error?.code ?? 'login_failed', reason ?? body.error?.message ?? fallback, status, details);
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw signInError(body, res.status, 'Login failed');
  const session = toSession(body.data as AuthPayload);
  saveSession(session);
  return session;
}

/** Unix seconds from a JWT's `exp` (read-only decode — the backend verifies the signature). */
function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Super Admin sign-in (audit F-05). Platform admins aren't Supabase users: the platform-admin
 * surface checks their own credentials at POST /platform/login and returns its own short-lived
 * token (1 h, no refresh cookie). Stored like any session, so the api client sends it on /platform/*.
 */
export async function loginPlatform(email: string, password: string): Promise<Session> {
  const res = await fetch('/platform/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw signInError(body, res.status, 'Login failed');
  const { token, admin } = body.data as { token: string; admin: { id: string; email: string } };
  const session: Session = {
    token,
    role: 'super_admin',
    displayName: admin.email.split('@')[0] ?? admin.email,
    email: admin.email,
    networkId: null,
    ownerId: null,
    expiresAt: tokenExpiry(token),
  };
  saveSession(session);
  return session;
}

/**
 * Exchange the httpOnly refresh cookie for a fresh access token. Returns the new token, or null
 * if the session is gone (caller should send the user back to login). Deduped so concurrent 401s
 * trigger a single refresh.
 */
let inflight: Promise<string | null> | null = null;
/** Why the last refresh was refused, when the API said (e.g. `network_deleted`) — the login page explains it. */
let refusedReason: string | null = null;
export const lastRefreshRefusal = (): string | null => refusedReason;
export function refreshToken(): Promise<string | null> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          const reason = body?.error?.details?.reason;
          refusedReason = typeof reason === 'string' ? reason : null;
          clearSession();
          return null;
        }
        refusedReason = null;
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
  // An impersonation tab only ends the impersonation: the refresh cookie is the admin's own.
  if (isImpersonating()) { clearSession(); return; }
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    /* ignore network errors on logout */
  }
  clearSession();
}
