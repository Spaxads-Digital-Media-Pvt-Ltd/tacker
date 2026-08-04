/**
 * The four login surfaces (spec §0). Role-gating in the SPA is UX ONLY — the backend enforces
 * every access server-side (spec §3A). Hiding a route here never substitutes for authorization.
 */
export type Role = 'super_admin' | 'admin' | 'publisher' | 'advertiser';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  publisher: 'Publisher',
  advertiser: 'Advertiser',
};

/** Landing route for each role after login. */
export const ROLE_HOME: Record<Role, string> = {
  super_admin: '/admin',
  admin: '/app',
  publisher: '/publisher',
  advertiser: '/advertiser',
};
