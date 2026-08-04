/**
 * Minimal data-fetching hooks over the backend HTTP client (spec §0 — all data via the API).
 * No external query library; just enough for list/create/delete with loading + error + refetch.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useQuery<T>(path: string): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Request failed'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch };
}

/** Imperative mutation helper with busy/error state for forms. */
export function useMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: TArgs): Promise<TResult | null> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(args);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Request failed');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error };
}
