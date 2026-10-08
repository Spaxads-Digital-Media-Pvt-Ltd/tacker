/**
 * Load EVERY row of a limit/offset-paged list endpoint by walking its pages, using the `total` from
 * the response's pagination meta (exposed by lib/api.ts as a non-enumerable `pagination` property
 * on the array). For lists that are small in practice but must never be silently truncated at the
 * endpoint's default page size (tracking domains, platform networks). Bounded by `maxPages`.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { withQueryParams } from '../lib/useApi';

export function useAllPages<T>(path: string, pageSize = 200, maxPages = 50) {
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      const all: T[] = [];
      for (let i = 0; i < maxPages; i++) {
        const batch = await api.get<T[]>(withQueryParams(path, { limit: pageSize, offset: i * pageSize }));
        all.push(...batch);
        const total = (batch as { pagination?: { total?: number } }).pagination?.total;
        if (batch.length < pageSize || (total !== undefined && all.length >= total)) break;
      }
      if (alive) setData(all);
    })()
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Request failed'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, pageSize, maxPages, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch };
}
