/**
 * Express Request augmentation for the resolved caller identity and scope (spec §3A).
 *
 * Every authenticated request carries exactly one `Identity` describing WHO is calling and
 * WHICH surface/audience they belong to, plus the `RequestScope` (network_id + optional
 * owner_id) that the ScopedDb requires. Handlers read `req.identity` / `req.scope`; they never
 * re-derive tenancy themselves.
 */
import type { RequestScope } from '../lib/db/scoped-db.js';

/** Which backend surface authenticated this request. Enforces surface segregation (spec §2.1). */
export type Surface = 'dashboard' | 'public-api' | 'platform-admin';

/** Public REST API audiences (spec §8A). */
export type ApiAudience = 'advertiser' | 'publisher' | 'network';

/** Admin (network staff) RBAC roles (spec §4 users). */
export type AdminRole = 'admin' | 'manager' | 'finance' | 'read_only';

/**
 * The Dashboard surface serves THREE kinds of human logins (spec §0): the network admin and
 * the two owner-scoped portals. All carry `networkId`; the portals additionally carry `ownerId`
 * (their own publisher_id / advertiser_id) so every read is owner-isolated (spec §3A).
 */
export type DashboardKind = 'admin' | 'publisher' | 'advertiser';

interface DashboardBase {
  surface: 'dashboard';
  userId: string;
  networkId: string;
}

export interface AdminIdentity extends DashboardBase {
  kind: 'admin';
  role: AdminRole;
}

export interface PublisherPortalIdentity extends DashboardBase {
  kind: 'publisher';
  /** publisher_id — this user may only ever see their own data. */
  ownerId: string;
}

export interface AdvertiserPortalIdentity extends DashboardBase {
  kind: 'advertiser';
  /** advertiser_id — this user may only ever see their own data. */
  ownerId: string;
}

export type DashboardIdentity =
  | AdminIdentity
  | PublisherPortalIdentity
  | AdvertiserPortalIdentity;

export interface ApiKeyIdentity {
  surface: 'public-api';
  audience: ApiAudience;
  networkId: string;
  /** advertiser_id / publisher_id / user_id the key acts as. */
  ownerId: string;
  keyId: string;
  scopes: string[];
}

export interface PlatformAdminIdentity {
  surface: 'platform-admin';
  platformAdminId: string;
}

export type Identity = DashboardIdentity | ApiKeyIdentity | PlatformAdminIdentity;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: Identity;
      scope?: RequestScope;
    }
  }
}

export {};
