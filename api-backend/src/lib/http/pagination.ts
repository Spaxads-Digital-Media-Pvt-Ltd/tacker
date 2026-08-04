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
