/**
 * SINGLE SOURCE OF TRUTH for the product name (spec §14 / non-negotiable #14).
 *
 * "Tracker" is a working name and WILL be renamed. Change `name` here and everywhere
 * else derives from it — no brand string should be hardcoded elsewhere in the backend.
 */
export const BRAND = {
  /** Human-facing product name. Rename here. */
  name: 'Tracker',
  /** Lowercase slug used in identifiers, prefixes, headers, log fields. Derived. */
  get slug(): string {
    return this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  },
  /** Support / from-address domain placeholder (overridable via env later). */
  supportEmailDomain: 'example.com',
} as const;

export type Brand = typeof BRAND;
