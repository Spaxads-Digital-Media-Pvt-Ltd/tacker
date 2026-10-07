/**
 * Bounded pagination (spec §3B — no unbounded result sets). Shared query schema; enforces
 * default/max page sizes. Reuse across every list endpoint.
 */
import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/**
 * Whole-entity lists (offers / advertisers / publishers) feed client-side search and every picker
 * in the SPA. A caller that doesn't ask for a page gets the entire list up to this bounded cap
 * (instead of silently the newest 50); an explicit ?limit keeps the normal page rules. `total` is
 * always returned so a capped list is detectable.
 */
export const ENTITY_LIST_CAP = 2000;

export function entityListLimit(rawQuery: Record<string, unknown>, parsed: PaginationQuery): number {
  return rawQuery['limit'] === undefined ? ENTITY_LIST_CAP : parsed.limit;
}
