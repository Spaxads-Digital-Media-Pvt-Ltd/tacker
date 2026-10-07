/**
 * The ONLY way data reaches the browser (spec §0, non-negotiable #4): an authenticated HTTP
 * call to the backend. No Supabase data client, no DB access — ever.
 *
 * Attaches the current access token as a Bearer, unwraps the standard envelope, and — on a 401 —
 * transparently refreshes the token once (via the httpOnly refresh cookie) and retries. If the
 * refresh fails the session is cleared and the user is sent to login.
 */
import { getToken } from '../auth/session';
import { refreshToken } from '../auth/authClient';

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
    let res = await doFetch(path, init, getToken());
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
};

/** Network-level error types so callers can distinguish them from HTTP errors. */
export type NetworkErrorKind = 'timeout' | 'network';
export class NetworkError extends Error {
  constructor(public readonly kind: NetworkErrorKind, message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}
