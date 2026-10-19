/**
 * The tracking domain a link uses when nothing more specific was chosen (an offer's own domain wins) — ONE rule
 * for every link the product builds: offer and partner-portal links, the impression pixel, direct links, the
 * advertiser postback URL, smart links. /click finds the network from the host, so only the network's ACTIVE,
 * VERIFIED domains can be candidates; among them:
 *
 *   1. the network's primary (default) domain;
 *   2. the domain the tracking server is live on for the network — `<slug>.<TRACKING_BASE_DOMAIN>`, the
 *      subdomain every network gets on the platform's tracking domain;
 *   3. any other real domain (a verified custom domain, another subdomain) — the oldest first;
 *   4. a tunnel (ngrok) — the public address of a development machine — the newest first;
 *   5. localhost / 127.0.0.1 — local development only: never chosen while anything else is active.
 *
 * Pure ranking (pickDefaultDomain) + the network lookup (defaultTrackingHost).
 */
import { query } from '../db/pool.js';
import { env } from '../../config/env.js';

export interface DomainCandidate {
  id: string;
  host: string;
  status: string;
  verification_state: string;
  is_primary: boolean;
  created_at: string | Date;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1)$/i;
const TUNNEL = /(\.ngrok-free\.(app|dev)|\.ngrok\.(io|app))$/i;

export const isLoopbackHost = (host: string): boolean => LOOPBACK.test(host);
export const isTunnelHost = (host: string): boolean => TUNNEL.test(host);

/** The network's subdomain on the platform's tracking domain (where the tracking server is live). */
export const liveHostFor = (slug: string | null | undefined): string | null =>
  slug ? `${slug.toLowerCase()}.${env.TRACKING_BASE_DOMAIN.toLowerCase()}` : null;

const time = (v: string | Date) => new Date(v).getTime();

/** The default among a network's domains (see the header), or null when none is active and verified. */
export function pickDefaultDomain<T extends DomainCandidate>(rows: readonly T[], liveHost: string | null): T | null {
  const usable = rows.filter((d) => d.status === 'active' && d.verification_state === 'verified');
  const rank = (d: T): number => {
    const host = d.host.toLowerCase();
    if (d.is_primary) return 0;
    if (liveHost && host === liveHost) return 1;
    if (isLoopbackHost(host)) return 4;
    if (isTunnelHost(host)) return 3;
    return 2;
  };
  return [...usable].sort((a, b) => rank(a) - rank(b)
    // real domains: the oldest first; tunnels: the newest (the one running now); loopback: the oldest
    || (rank(a) === 3 ? time(b.created_at) - time(a.created_at) : time(a.created_at) - time(b.created_at))
    || a.host.localeCompare(b.host))[0] ?? null;
}

/** The network's candidates and the domain the tracking server is live on for it. */
export async function networkDomains(networkId: string): Promise<{ rows: DomainCandidate[]; liveHost: string | null }> {
  const [domains, net] = await Promise.all([
    query<DomainCandidate>(
      `SELECT id, host, status, verification_state, is_primary, created_at FROM tracking_domains WHERE network_id = $1`, [networkId]),
    query<{ slug: string | null }>('SELECT slug FROM networks WHERE id = $1', [networkId]),
  ]);
  return { rows: domains.rows, liveHost: liveHostFor(net.rows[0]?.slug) };
}

/** The host a network's links use by default (null when it has no active, verified domain). */
export async function defaultTrackingHost(networkId: string): Promise<string | null> {
  const { rows, liveHost } = await networkDomains(networkId);
  return pickDefaultDomain(rows, liveHost)?.host ?? null;
}
