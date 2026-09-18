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

/** Pass `null` for `path` to skip fetching (e.g. a dependent query waiting on an id). */
export function useQuery<T>(path: string | null): QueryState<T> {
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
