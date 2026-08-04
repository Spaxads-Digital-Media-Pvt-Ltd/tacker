/**
 * The ONLY way data reaches the browser (spec §0, non-negotiable #4): an authenticated HTTP
 * call to the backend. No Supabase data client, no DB access — ever.
 *
 * Attaches the current access token as a Bearer, unwraps the standard envelope, and — on a 401 —
 * transparently refreshes the token once (via the httpOnly refresh cookie) and retries. If the
 * refresh fails the session is cleared and the user is sent to login.
 */
import { getToken } from '../auth/session';
import { refreshToken } from './authClient';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function doFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await doFetch(path, init, getToken());

  // Transparent one-shot refresh on expiry.
  if (res.status === 401) {
    const fresh = await refreshToken();
    if (fresh) {
      res = await doFetch(path, init, fresh);
    } else {
      if (!location.pathname.startsWith('/login')) location.href = '/login';
      throw new ApiError('unauthorized', 'Session expired', 401);
    }
  }

  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || body.ok === false) {
    const err = body.error ?? { code: 'unknown', message: res.statusText };
    throw new ApiError(err.code, err.message, res.status);
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
