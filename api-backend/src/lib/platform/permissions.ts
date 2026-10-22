/**
 * Platform staff permissions (Super Admin › Team › Roles). A role grants each SECTION a level — 'none'
 * (hidden), 'read' (view) or 'full' (view + change) — like Everflow's per-section Full Access / Read Only.
 * A role's scope 'assigned' limits network data to the networks a member manages (account_manager_id)
 * or sold (sales_owner_id) — Everflow's "Limited Access: only assigned".
 *
 * Roles live in platform_roles (system roles seeded by migration 085); this module is the catalog the
 * API validates against and the SPA renders, and the checks every platform route runs.
 */
export const LEVELS = ['none', 'read', 'full'] as const;
export type Level = (typeof LEVELS)[number];

export const SECTIONS = [
  { key: 'dashboard', name: 'Overview', description: 'The platform overview and its numbers.' },
  { key: 'networks', name: 'Networks', description: 'Tenant networks: create, edit, suspend, delete, export, purge.' },
  { key: 'access', name: 'Tenant access', description: 'Open a network’s dashboard (support session); temporary passwords for its team.' },
  { key: 'sales', name: 'Sales', description: 'Leads, pipeline, sales tasks; convert a lead into a network.' },
  { key: 'success', name: 'Customer success', description: 'Health scores, account managers, notes and tasks.' },
  { key: 'support', name: 'Support', description: 'The ticket queue, replies and saved replies.' },
  { key: 'billing', name: 'Billing', description: 'Invoices, payments, credit notes, coupons; run billing.' },
  { key: 'plans', name: 'Plans & subscriptions', description: 'The plan catalog and each network’s subscription.' },
  { key: 'revenue', name: 'Revenue', description: 'MRR, churn, ARPA and the other revenue numbers.' },
  { key: 'comms', name: 'Announcements', description: 'Banners and news shown in tenant dashboards.' },
  { key: 'platform', name: 'Platform', description: 'Feature flags and system health.' },
  { key: 'trust', name: 'Trust & safety', description: 'Fraud across networks, the platform blocklist and privacy (GDPR / CCPA) requests.' },
  { key: 'resellers', name: 'Resellers & white-label', description: 'Resellers and their commission; networks’ own brand and dashboard domain.' },
  { key: 'team', name: 'Team & roles', description: 'Staff accounts and what each role may do.' },
  { key: 'settings', name: 'Settings', description: 'Billing, email and platform settings.' },
  { key: 'activity', name: 'Activity', description: 'The platform activity log.' },
] as const;
export type Section = (typeof SECTIONS)[number]['key'];
export const SECTION_KEYS = SECTIONS.map((s) => s.key) as readonly Section[];

export type Permissions = Partial<Record<Section, Level>>;

const RANK: Record<Level, number> = { none: 0, read: 1, full: 2 };

/** Does `permissions` grant `section` at least `level`? */
export function allows(permissions: Permissions | undefined, section: Section, level: Exclude<Level, 'none'>): boolean {
  return RANK[permissions?.[section] ?? 'none'] >= RANK[level];
}

/** Every section present, unknown keys dropped, missing ones 'none'. */
export function normalizePermissions(raw: unknown): Record<Section, Level> {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as Record<Section, Level>;
  for (const k of SECTION_KEYS) {
    const v = src[k];
    out[k] = (LEVELS as readonly string[]).includes(String(v)) ? (v as Level) : 'none';
  }
  return out;
}

export const sectionName = (s: Section): string => SECTIONS.find((x) => x.key === s)?.name ?? s;
