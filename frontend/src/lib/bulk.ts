import { api } from './api';

/**
 * PATCH every selected record, continuing past failures, and throw one error naming exactly which
 * records failed (and why) — so a bulk edit never silently half-applies and navigates away.
 */
export async function patchEach(
  ids: Iterable<string>, urlFor: (id: string) => string, patch: Record<string, unknown>, nameOf: (id: string) => string,
): Promise<number> {
  const all = [...ids];
  const failed: string[] = [];
  for (const id of all) {
    try { await api.patch(urlFor(id), patch); }
    catch (e) { failed.push(`${nameOf(id)} — ${e instanceof Error ? e.message : 'failed'}`); }
  }
  if (failed.length) throw new Error(`Updated ${all.length - failed.length} of ${all.length}. Not updated: ${failed.join('; ')}`);
  return all.length;
}
