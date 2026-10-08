/**
 * Every tenant network for the super-admin pages. `/platform/networks` is paged (default 50, max
 * 200) with a `total` in its pagination meta, so walk the pages instead of silently showing only
 * the newest 50.
 */
import { useAllPages } from '../../hooks/useAllPages';
import type { NetworkRow } from '../../types';

export function useAllNetworks() {
  return useAllPages<NetworkRow>('/platform/networks');
}
