/**
 * Offer category options. The Control Center › Segmentation › Categories catalog is the source of
 * truth (migration 065 seeded it with every name offers already used); `offers.category` itself
 * stays a free-text name. Options = active catalog names ∪ names still on offers (so an offer
 * whose category was later deactivated still shows its value), de-duplicated case-insensitively
 * with the catalog's spelling winning.
 */
import { useMemo } from 'react';
import { api } from './api';
import { useQuery } from './useApi';

interface CatalogCategory { id: string; name: string; status: string }

export function useOfferCategories(inUse: (string | null | undefined)[] = []) {
  const { data: catalog, refetch } = useQuery<CatalogCategory[]>('/api/control-center/categories?status=active');
  const inUseKey = inUse.filter(Boolean).join('\u0000');
  const options = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const c of catalog ?? []) byKey.set(c.name.trim().toLowerCase(), c.name.trim());
    for (const n of inUseKey ? inUseKey.split('\u0000') : []) {
      const k = n.trim().toLowerCase();
      if (k && !byKey.has(k)) byKey.set(k, n.trim());
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [catalog, inUseKey]);

  /**
   * Make sure a (new) category name exists in the catalog before an offer is saved with it. A name
   * that already exists (any case) is a no-op; the API's 409 for a racing duplicate is ignored.
   */
  const ensureCategory = async (name: string): Promise<void> => {
    const n = name.trim();
    if (!n || (catalog ?? []).some((c) => c.name.trim().toLowerCase() === n.toLowerCase())) return;
    try { await api.post('/api/control-center/categories', { name: n, status: 'active' }); refetch(); } catch { /* exists already / not permitted — the offer still saves its name */ }
  };

  return { options, ensureCategory };
}
