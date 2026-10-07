/**
 * Minimal data-fetching hooks over the backend HTTP client (spec §0 — all data via the API).
 * No external query library; just enough for list/create/delete with loading + error + refetch.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, NetworkError } from './api';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refetch: () => void;
}

function classifyError(e: unknown): { message: string; code: string } {
  if (e instanceof ApiError) {
    return { message: e.message, code: e.code };
  }
  if (e instanceof NetworkError) {
    return { message: e.message, code: e.kind === 'timeout' ? 'timeout' : 'network' };
  }
  return { message: 'Request failed', code: 'unknown' };
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Append `params` to `path` as a query string. `null`/`undefined`/'' values are dropped, so optional
 * filters can be passed as-is; joins with `&` if `path` already has a query; no params → `path`.
 */
export function withQueryParams(path: string, params?: QueryParams): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}

/**
 * Pass `null` for `path` to skip fetching (e.g. a dependent query waiting on an id). Optional
 * `params` are URL-encoded onto the path (see `withQueryParams`); the request refetches whenever the
 * resulting URL changes, so passing a fresh object each render is fine.
 */
export function useQuery<T>(rawPath: string | null, params?: QueryParams): QueryState<T> {
  const path = rawPath === null ? null : withQueryParams(rawPath, params);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) { setData(null); setLoading(false); setError(null); setErrorCode(null); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    api
      .get<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return;
        const { message, code } = classifyError(e);
        setError(message);
        setErrorCode(code);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [path, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, errorCode, refetch };
}

/** Imperative mutation helper with busy/error state for forms. */
export function useMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const run = useCallback(
    async (args: TArgs): Promise<TResult | null> => {
      setBusy(true);
      setError(null);
      setErrorCode(null);
      try {
        return await fn(args);
      } catch (e) {
        const { message, code } = classifyError(e);
        setError(message);
        setErrorCode(code);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, errorCode };
}
