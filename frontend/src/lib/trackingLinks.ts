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

/**
 * The S2S postback URL handed to an advertiser. {click_id} / {txn_id} are the advertiser's own
 * fill-ins; the secure code is the real value (it's our secret, so it can't be a placeholder they
 * fill). status=approved is included because a postback without a status is recorded as pending,
 * which earns nothing and fires no partner postback until someone approves it.
 */
export function advertiserPostbackUrl(host: string | null, secureCode: string | null | undefined): string {
  if (!host) return '';
  const code = secureCode ? `&secure_code=${encodeURIComponent(secureCode)}` : '';
  return `${trackingBase(host)}/postback?click_id={click_id}&txn_id={txn_id}&status=approved${code}`;
}

/** What the /postback endpoint actually reads — shown next to the advertiser postback URL. */
export const POSTBACK_PARAMS: [string, string][] = [
  ['click_id', 'Required. The click id the landing page received in the redirect.'],
  ['txn_id', 'Your order / transaction id. Re-sending the same txn_id is ignored, so retries never double-count.'],
  ['status', 'approved, pending or rejected. If omitted the conversion is recorded as pending and earns nothing until approved.'],
  ['secure_code', 'Pre-filled above with this offer\'s code (or the network default). Postbacks with a wrong or missing code are rejected.'],
  ['event', 'Goal / event name, when the offer has more than one goal.'],
  ['payout', 'Optional. Overrides the partner payout for this conversion.'],
  ['revenue', 'Optional. Overrides the advertiser revenue for this conversion.'],
  ['sale_amount', 'Sale value — used when the offer\'s revenue type is Percentage or Mixed.'],
];

export function linkId(entity: { id: string; ref?: number | null } | null | undefined): string {
  if (!entity) return '';
  return entity.ref != null ? String(entity.ref) : entity.id;
}
