/**
 * Shared tracking-link helpers so every link generator builds the same URL:
 * - host = the offer's own assigned tracking domain (network primary only if the offer has none)
 * - local hosts (localhost / 127.0.0.1) point at the dev tracking server on :4002 over http
 * - offer_id / pub_id use the short numeric ref when available (/click resolves both forms)
 */
import type { TrackingDomain } from '../types';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/i;
// Same set Vite's own dev server trusts (vite.config.ts `allowedHosts`) — local machine addresses
// and tunnel hosts used to preview the app during development, never a real production domain.
const DEV_ONLY_HOST = /^(localhost|127\.0\.0\.1|.+\.ngrok-free\.(app|dev)|.+\.ngrok\.(io|app))$/i;

/** True for localhost/127.0.0.1/ngrok tunnel hosts — dev/testing domains, never a real production one. */
export function isDevOnlyHost(host: string): boolean {
  return DEV_ONLY_HOST.test(host);
}

/** Split a domain list into real (production) domains and dev-only ones, each in their original order. */
export function groupTrackingDomains(domains: TrackingDomain[] | null | undefined): { production: TrackingDomain[]; devOnly: TrackingDomain[] } {
  const production: TrackingDomain[] = [];
  const devOnly: TrackingDomain[] = [];
  for (const d of domains ?? []) (isDevOnlyHost(d.host) ? devOnly : production).push(d);
  return { production, devOnly };
}

export function resolveTrackingHost(domains: TrackingDomain[] | null | undefined, trackingDomainId?: string | null): string | null {
  const all = domains ?? [];
  if (trackingDomainId) {
    const own = all.find((d) => d.id === trackingDomainId);
    if (own) return own.host;
  }
  const active = all.filter((d) => d.status === 'active');
  return (active.find((d) => d.isPrimary) ?? active[0])?.host ?? null;
}

export function trackingBase(host: string | null): string {
  if (!host) return '';
  return LOCAL_HOST.test(host) ? `http://${host}:4002` : `https://${host}`;
}

export function linkId(entity: { id: string; ref?: number | null } | null | undefined): string {
  if (!entity) return '';
  return entity.ref != null ? String(entity.ref) : entity.id;
}
