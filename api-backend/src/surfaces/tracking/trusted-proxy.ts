/**
 * Which socket peers the tracking surface trusts to report the client address (X-Forwarded-For).
 *
 * Deployment: Cloudflare → Nginx → tracking. Fastify's `trustProxy` calls the check per hop while
 * walking X-Forwarded-For from the RIGHT, so `req.ip` is the first address that is NOT a trusted
 * proxy — the real client. A header written by the client itself sits to the left of that and is
 * never reached. The same check backs the production guard that rejects direct (non-proxied)
 * connections (tracking/app.ts).
 *
 * Trusted:
 *  - Loopback (127.0.0.1, ::1): Nginx on the same host. This also means a client connecting over
 *    loopback in LOCAL DEV can set X-Forwarded-For; a plain local request keeps 127.0.0.1.
 *  - Cloudflare's published edge ranges (below).
 *  - TRACKING_TRUSTED_PROXIES: comma-separated IPs / CIDRs (IPv4 or IPv6) — e.g. an Nginx or load
 *    balancer that is NOT on the same host. Must be set for any such hop, or the click IP is that
 *    proxy's address.
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

function addEntry(list: BlockList, entry: string): boolean {
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
 * Build the trust check. `extra` is TRACKING_TRUSTED_PROXIES; malformed entries are reported via
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
