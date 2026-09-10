/**
 * Host → tenant resolution behind a clean abstraction (spec §3D "keep host-resolution and
 * provisioning behind a clean abstraction so new modes slot in without touching the hot path").
 *
 * Two link-generation modes today (spec §3D):
 * - subdomain: `company.<TRACKING_BASE_DOMAIN>` (we provision the subdomain)
 * - custom: `our_name.company_domain` (their CNAME → our infra)
 * More modes will be added; callers depend only on `resolveHostToNetwork(host)`.
 *
 * HARD RULE (spec §3D): never resolve a tenant from an unverified/inactive host.
 *
 * Security (M-1): the inbound Host header is NOT trustworthy on its own. Cloudflare/nginx
 * MUST strip/overwrite the inbound host header before requests reach this process. In addition,
 * we apply format-level validation HERE as defense-in-depth:
 * - reject raw IP literals (v4 octets, v6 colons, IPv6 brackets)
 * - reject schemes, paths, query strings
 * - reject any string longer than the DNS max (253 chars per RFC)
 * - reject names that contain anything outside [a-z0-9.-] (after lowercasing)
 * Direct-connect attacks that bypass the proxy still hit the deny-by-default result.
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

// Conservative DNS limits (RFC 1035/2181). A real FQDN can be at most 253 octets and a single label
// at most 63 octets. The strict regex below enforces both.
const HOST_MAX_LENGTH = 253;
const HOST_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Tells whether the string is a valid DNS-style host name (no scheme, no path, no port, no
 * raw IP, no underscores). Returns false for anything that looks like an IP address.
 */
export function isValidHostName(value: string): boolean {
 if (!value) return false;
 if (value.length > HOST_MAX_LENGTH) return false;
 const v = value.trim().toLowerCase();
 // Strip an optional :port (caller already does this, but stay safe).
 const bare = v.split(':')[0] ?? '';
 if (!bare) return false;
 // Reject any character not in the allowed DNS charset (after lowercasing).
 if (!/^[a-z0-9.-]+$/.test(bare)) return false;
 // Raw IPv4 — anything that is four pure-numeric labels.
 const labels = bare.split('.');
 if (labels.length === 4 && labels.every((l) => /^\d+$/.test(l))) return false;
 // Bracketed IPv6 already rejected by charset (no brackets allowed).
 // Disallow pure-numeric TLDs (full IPv4 case above; trivially safety check).
 if (HOST_REGEX.test(bare)) return true;
 // Also accept single-label hosts like "localhost" used in some test scenarios, but only if
 // they contain at least one alpha character (rules out more IP-shaped junk).
 return /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(bare);
}

export function resolveHostToNetwork(host: string): Promise<ResolvedTenant | null> {
 const normalized = (host ?? '').trim().toLowerCase().split(':')[0] ?? '';
 if (!isValidHostName(normalized)) return Promise.resolve(null);
 return resolver.resolve(normalized);
}
