/**
 * Host → tenant resolution behind a clean abstraction (spec §3D "keep host-resolution and
 * provisioning behind a clean abstraction so new modes slot in without touching the hot path").
 *
 * Two link-generation modes today (spec §3D):
 *   - subdomain: `company.<TRACKING_BASE_DOMAIN>`   (we provision the subdomain)
 *   - custom:    `our_name.company_domain`          (their CNAME → our infra)
 * More modes will be added; callers depend only on `resolveHostToNetwork(host)`.
 *
 * HARD RULE (spec §3D): never resolve a tenant from an unverified/inactive host.
 *
 * Phase 0: interface + in-memory stub. Phase 1A backs this with the `tracking_domains` table
 * (mode, ssl/cert status, verification state) + a Redis cache for the hot path.
 */

export interface ResolvedTenant {
  networkId: string;
  host: string;
  mode: 'subdomain' | 'custom';
}

export interface HostResolver {
  resolve(host: string): Promise<ResolvedTenant | null>;
}

/**
 * Phase 0 stub resolver. Returns null for everything (deny-by-default) until Phase 1A wires the
 * `tracking_domains` table. Exists so the hot path and middleware can be built against the
 * interface now without depending on a table that doesn't exist yet.
 */
export class StubHostResolver implements HostResolver {
  async resolve(_host: string): Promise<ResolvedTenant | null> {
    return null;
  }
}

let resolver: HostResolver = new StubHostResolver();

/** Swap the implementation (Phase 1A installs the DB-backed, cached resolver). */
export function setHostResolver(next: HostResolver): void {
  resolver = next;
}

export function resolveHostToNetwork(host: string): Promise<ResolvedTenant | null> {
  const normalized = host.trim().toLowerCase().split(':')[0] ?? '';
  return resolver.resolve(normalized);
}
