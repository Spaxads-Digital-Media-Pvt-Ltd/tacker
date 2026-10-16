/**
 * The ONLY way data reaches the browser (spec §0, non-negotiable #4): an authenticated HTTP
 * call to the backend. No Supabase data client, no DB access — ever.
 *
 * Attaches the current access token as a Bearer, unwraps the standard envelope, and — on a 401 —
 * transparently refreshes the token once (via the httpOnly refresh cookie) and retries. If the
 * refresh fails the session is cleared and the user is sent to login.
 */
import { loadSession, clearSession, type Session } from '../auth/session';
import { refreshToken, logout, lastRefreshRefusal } from '../auth/authClient';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const REQUEST_TIMEOUT = 30_000;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Refusals that mean the account itself was switched off — a partner / advertiser set inactive or
 * deleted, a team member disabled (the API tags them with `details.reason`). The session can't
 * recover, so it's ended (refresh cookie too) and the login page says why.
 */
const ENDED_REASONS = new Set(['account_inactive', 'account_disabled', 'account_deleted', 'network_suspended', 'network_deleted', 'network_purged']);
let ending = false;
function endSession(reason: string): void {
  if (ending) return;
  ending = true;
  void logout().finally(() => {
    if (!location.pathname.startsWith('/login')) location.href = `/login?ended=${encodeURIComponent(reason)}`;
    else ending = false;
  });
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

async function doFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const session = loadSession();
    let res = await doFetch(path, init, session?.token ?? null);
    if (res.status === 401) {
      // An impersonation tab (F-10): its short-lived token can't be refreshed — the refresh cookie
      // is the admin's own. End the impersonation in this tab only.
      if (session?.impersonatedBy) {
        clearSession();
        if (!location.pathname.startsWith('/impersonate')) location.href = '/impersonate?ended=expired';
        throw new ApiError('unauthorized', 'The impersonation session has ended', 401);
      }
      // A Super Admin session holds the platform surface's own short-lived token, which no refresh
      // cookie backs — never trade it in at /api/auth/refresh (a leftover tenant cookie would swap
      // in a tenant token). A /platform/* 401 means it expired → sign in again; a 401 from a tenant
      // endpoint only means that endpoint isn't for Super Admin. Decided by the session the
      // request was SENT with, so a concurrent request can't fall through to a refresh.
      const platformPath = path.startsWith('/platform/');
      if (session?.role === 'super_admin' || platformPath) {
        if (session?.role === 'super_admin' && platformPath) {
          clearSession();
          if (!location.pathname.startsWith('/login')) location.href = '/login';
        }
        throw new ApiError('unauthorized', platformPath ? 'Session expired' : 'Not available to Super Admin', 401);
      }
      const fresh = await refreshToken();
      if (fresh) {
        res = await doFetch(path, init, fresh);
      } else {
        // A network that was suspended / deleted / purged refuses the refresh with its reason — say why.
        const why = lastRefreshRefusal();
        if (!location.pathname.startsWith('/login')) location.href = why && ENDED_REASONS.has(why) ? `/login?ended=${encodeURIComponent(why)}` : '/login';
        throw new ApiError('unauthorized', 'Session expired', 401);
      }
    }

    const body = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (!res.ok || body.ok === false) {
      const err = body.error ?? { code: 'unknown', message: res.statusText };
      const reason = (err.details as { reason?: unknown } | undefined)?.reason;
      if (typeof reason === 'string' && ENDED_REASONS.has(reason) && isOwnSession(session)) endSession(reason);
      if (reason === 'password_change_required' && !location.pathname.startsWith('/change-password')) location.href = '/change-password';
      throw new ApiError(err.code, err.message, res.status, err.details);
    }
    const data = body.data as T;
    // Keep server pagination (limit/offset/total) reachable on list responses without changing
    // their shape: non-enumerable, so spreads / JSON / .map() never see it.
    const pagination = (body as { pagination?: unknown }).pagination;
    if (pagination && Array.isArray(data)) Object.defineProperty(data, 'pagination', { value: pagination, enumerable: false });
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof NetworkError) throw e;
    if (e instanceof DOMException) {
      if (e.name === 'AbortError') throw new NetworkError('timeout', `Request timed out after ${REQUEST_TIMEOUT}ms`);
    }
    throw new NetworkError('network', e instanceof Error ? e.message : 'Network error');
  }
}

/** A signed-in person's own session (not an admin's impersonation tab, which ends on its own). */
const isOwnSession = (s: Session | null): boolean => !!s && !s.impersonatedBy && s.role !== 'super_admin';

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** `headers` is for extras such as `Idempotency-Key`; Content-Type/Authorization are set for you. */
  post: <T>(path: string, data?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined, headers }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** POST a raw file body (e.g. an image) with its own Content-Type. */
  upload: <T>(path: string, file: Blob) =>
    request<T>(path, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
  /** GET a file (an export, a CSV) and save it as `filename`. No time limit — a big export streams for a while. */
  download: async (path: string, filename: string): Promise<void> => {
    const token = loadSession()?.token ?? null;
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    } catch (e) {
      throw new NetworkError('network', e instanceof Error ? e.message : 'Network error');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Envelope<unknown>;
      throw new ApiError(body.error?.code ?? 'unknown', body.error?.message ?? res.statusText, res.status, body.error?.details);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

/** Network-level error types so callers can distinguish them from HTTP errors. */
export type NetworkErrorKind = 'timeout' | 'network';
export class NetworkError extends Error {
  constructor(public readonly kind: NetworkErrorKind, message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}
