/**
 * Auth client — talks ONLY to the backend auth endpoints (spec §0). The refresh token lives in
 * an httpOnly cookie the browser sends automatically (credentials: 'include'); JS never sees it.
 */
import { ApiError, NetworkError } from '../lib/api.js';
import { NETWORK_ERROR_MESSAGE, httpFailureMessage } from '../lib/errorMessages';
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

/** fetch, with "the server can't be reached" said in words (a bare fetch rejects with "Failed to fetch"). */
async function authFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new NetworkError('network', NETWORK_ERROR_MESSAGE);
  }
}

/**
 * A refused auth request as an ApiError the page can show as is: the server's own message; for a
 * validation failure the field's reason ("Password must be at least 12 characters."); and when no
 * API answered at all (a gateway, the dev proxy with the backend down), what that means.
 */
function authError(body: { error?: { code?: string; message?: string; details?: unknown } }, res: Response): ApiError {
  const details = body.error?.details;
  const reasons = details && typeof details === 'object' ? Object.values(details as Record<string, unknown>).flat() : [];
  const reason = res.status === 422 ? reasons.find((r): r is string => typeof r === 'string' && r.length > 0) : undefined;
  const message = body.error?.message ? (reason && /failed validation$/.test(body.error.message) ? reason : body.error.message)
    : httpFailureMessage(res.status, res.statusText);
  return new ApiError(body.error?.code ?? (res.status >= 500 ? 'unavailable' : 'request_failed'), message, res.status, details);
}

/** POST to an unauthenticated /api/auth endpoint; throws ApiError with the server's message. */
async function authPost(path: string, body: unknown): Promise<void> {
  const res = await authFetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw authError(json, res);
}

/** "Request a demo" (signed out): a lead for the platform's sales team. `website_url` is the bots' honeypot. */
export const requestDemo = (body: {
  name: string; email: string; company: string; phone?: string; website?: string; country?: string; monthlyClicks?: number; message?: string; website_url?: string;
}): Promise<void> => authPost('/api/signup/demo', body);

/** "Forgot password?" — the server answers the same for any address (it never says which exist). */
export const requestPasswordReset = (email: string): Promise<void> => authPost('/api/auth/forgot-password', { email });

/** Redeem the emailed link's token with the new password. */
export const resetPassword = (token: string, password: string): Promise<void> => authPost('/api/auth/reset-password', { token, password });

/** changeInitialPassword's error code when the password IS saved but this sign-in is over — sign in with it. */
export const PASSWORD_SAVED_SIGN_IN_AGAIN = 'password_saved_sign_in_again';

/**
 * First sign-in with a temporary password (O1): set the new password. Supabase ends every session of
 * a login whose password changes (the refresh cookie dies with it), so the API signs in again with the
 * new password and answers with that session — no longer "must change password" — which is saved here.
 * Without one (an older API), the refresh cookie is tried; if that's gone too, sign in again (401).
 */
export async function changeInitialPassword(password: string): Promise<void> {
  const token = loadSession()?.token;
  if (!token) throw new ApiError('unauthorized', 'You are no longer signed in — sign in again.', 401);
  const res = await authFetch('/api/me/password', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'include', body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw authError(json, res);
  const fresh = json.data as Partial<AuthPayload> | undefined;
  if (fresh?.accessToken && fresh.identity) { saveSession(toSession(fresh as AuthPayload)); return; }
  if (!(await refreshToken())) throw new ApiError(PASSWORD_SAVED_SIGN_IN_AGAIN, 'Your password was updated — sign in again with it.', 401);
  markPasswordChanged();
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await authFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw authError(body, res);
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
/** The password was right but two-factor is on: the code step comes next (POST /platform/login/2fa). */
export interface TwoFactorChallenge { twoFactorRequired: true; challenge: string; email: string }

export async function loginPlatform(email: string, password: string): Promise<Session | TwoFactorChallenge> {
  const res = await authFetch('/platform/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw authError(body, res);
  if (body.data?.twoFactorRequired) return { twoFactorRequired: true, challenge: body.data.challenge as string, email };
  return platformSession(body.data as { token: string; admin: { id: string; email: string } });
}

/** The second step: the challenge and a 6-digit code (or a recovery code). */
export async function loginPlatformCode(challenge: string, code: string): Promise<Session & { recoveryCodesLeft?: number; usedRecoveryCode?: boolean }> {
  const res = await authFetch('/platform/login/2fa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge, code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw authError(body, res);
  const d = body.data as { token: string; admin: { id: string; email: string }; recoveryCodesLeft: number; usedRecoveryCode: boolean };
  return { ...platformSession(d), recoveryCodesLeft: d.recoveryCodesLeft, usedRecoveryCode: d.usedRecoveryCode };
}

function platformSession({ token, admin }: { token: string; admin: { id: string; email: string } }): Session {
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
