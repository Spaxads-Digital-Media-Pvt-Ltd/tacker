/**
 * Which socket peers every HTTP surface trusts to report the client address (X-Forwarded-For) — the
 * tracking surface (Fastify `trustProxy`) and the Express surfaces (dashboard, public API, platform
 * admin: `trust proxy` in lib/http/express-app.ts). One rule everywhere (O2), so behind Cloudflare →
 * a load balancer → us, the click IP, login rate limits, the API IP whitelist, audit logs and login
 * history all see the real visitor — not the proxy (which put every user in one rate-limit bucket).
 *
 * X-Forwarded-For is walked from the RIGHT and only hops from a trusted proxy are skipped, so `req.ip`
 * is the first address that is NOT a trusted proxy — the real client. A header written by the client
 * itself sits to the left of that and is never reached, so spoofing it changes nothing — even if the
 * origin is reachable directly. The same check backs the tracking surface's production guard that
 * rejects direct (non-proxied) connections.
 *
 * Trusted:
 *  - Loopback (127.0.0.1, ::1): a proxy on the same host. This also means a client connecting over
 *    loopback in LOCAL DEV can set X-Forwarded-For; a plain local request keeps 127.0.0.1.
 *  - Cloudflare's published edge ranges (below) — always.
 *  - TRUSTED_PROXIES (and the older TRACKING_TRUSTED_PROXIES, merged): comma-separated IPs / CIDRs
 *    (IPv4 or IPv6), and the keyword `private` = the private ranges (10/8, 172.16/12, 192.168/16,
 *    fc00::/7) — e.g. an AWS load balancer inside the VPC. Any hop that isn't covered makes req.ip
 *    that hop's address.
 *
 * AWS + Cloudflare: TRUSTED_PROXIES=private (or the VPC CIDR). Also allow only Cloudflare's ranges to
 * reach the load balancer (security group), so nobody can bypass Cloudflare.
 */
import { BlockList, isIP } from 'node:net';

/**
 * Cloudflare edge ranges — copied verbatim from Cloudflare's official sources
 * https://www.cloudflare.com/ips-v4/ and https://www.cloudflare.com/ips-v6/ (identical to
 * https://api.cloudflare.com/client/v4/ips, etag 38f79d050aa027e3be3865e495dcc9bc), fetched
 * 2026-10-12. Cloudflare changes these rarely; re-check those URLs when updating.
 */
export const CLOUDFLARE_IPV4: readonly string[] = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
export const CLOUDFLARE_IPV6: readonly string[] = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

const family = (addr: string): 'ipv4' | 'ipv6' | null => {
  const v = isIP(addr);
  return v === 4 ? 'ipv4' : v === 6 ? 'ipv6' : null;
};

/** `private` in TRUSTED_PROXIES: RFC 1918 + IPv6 unique-local — load balancers inside a VPC. */
export const PRIVATE_RANGES: readonly string[] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];

function addEntry(list: BlockList, entry: string): boolean {
  if (entry.toLowerCase() === 'private') { for (const cidr of PRIVATE_RANGES) addEntry(list, cidr); return true; }
  if (entry.toLowerCase() === 'cloudflare') return true; // always trusted (below)
  const [addr, bits, extra] = entry.split('/');
  const type = family(addr ?? '');
  if (!type || extra !== undefined) return false;
  if (bits === undefined) { list.addAddress(addr!, type); return true; }
  const prefix = Number(bits);
  if (!/^\d+$/.test(bits) || prefix > (type === 'ipv4' ? 32 : 128)) return false;
  list.addSubnet(addr!, prefix, type);
  return true;
}

/**
 * Build the trust check. `extra` is the configured list; malformed entries are reported via
 * `onInvalid` and ignored (never widened into "trust everything").
 */
export function buildTrustedProxyCheck(extra?: string, onInvalid?: (entry: string) => void): (ip: string) => boolean {
  const list = new BlockList();
  list.addAddress('127.0.0.1', 'ipv4');
  list.addAddress('::1', 'ipv6');
  for (const cidr of CLOUDFLARE_IPV4) addEntry(list, cidr);
  for (const cidr of CLOUDFLARE_IPV6) addEntry(list, cidr);
  for (const entry of (extra ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!addEntry(list, entry)) onInvalid?.(entry);
  }
  return (ip: string) => {
    const type = family(ip ?? '');
    // IPv4-mapped IPv6 ("::ffff:104.16.0.1") matches IPv4 rules too (BlockList handles the mapping).
    return type !== null && list.check(ip, type);
  };
}

/** The configured list: TRUSTED_PROXIES plus the older TRACKING_TRUSTED_PROXIES. */
export const configuredProxies = (env: { TRUSTED_PROXIES?: string; TRACKING_TRUSTED_PROXIES?: string }): string =>
  [env.TRUSTED_PROXIES, env.TRACKING_TRUSTED_PROXIES].filter((v) => v?.trim()).join(',');

let cloudflare: BlockList | null = null;
/** Did this connection come from Cloudflare's edge (so its CF-* headers can be trusted)? */
export function isCloudflareAddress(ip: string | null | undefined): boolean {
  if (!ip) return false;
  if (!cloudflare) {
    cloudflare = new BlockList();
    for (const cidr of [...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6]) addEntry(cloudflare, cidr);
  }
  const type = family(ip);
  return type !== null && cloudflare.check(ip, type);
}
