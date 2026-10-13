import type { Router } from 'express';
import { MALFORMED_VALUE_MESSAGE, validationFailed } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path ids on this router are UUIDs. A malformed one is a caller mistake: answer with the standard
 * 422 validation envelope before any lookup, so every route on the router responds the same way —
 * previously some pre-checked with a regex and said 404 while others let Postgres reject the cast
 * (also 422). A well-formed id is untouched and keeps the existing not-found / tenant policy (a
 * missing or other-network record is still a plain 404, never revealing which).
 */
export function rejectMalformedIdParams(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => {
      next(UUID_RE.test(value) ? undefined : validationFailed(MALFORMED_VALUE_MESSAGE));
    });
  }
}
