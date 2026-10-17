/**
 * Network IP lists from Control Center › Security (audit F-16), enforced where they belong:
 *  - IP blacklist (network_ip_blacklist ranges) → /click diverts a click from a listed address.
 *  - API IP whitelist (network_api_whitelist) → the Public REST API refuses a network key used from
 *    anywhere else (when the network has a whitelist at all).
 *
 * Entries are single IPs, from–to ranges or CIDRs, IPv4 or IPv6; malformed ones are skipped (the
 * dashboard validates new ones). Each list is cached in Redis per network (load-through, busted by the
 * Control Center writes), and the compiled matcher — Node's native BlockList — is memoized in-process
 * per cached value, so the hot path is one Redis GET (fetched in parallel with the offer config) plus
 * an O(log n) native check. A Redis or DB hiccup fails OPEN (no blocking), like the rate limiters.
 */
import { BlockList, isIP } from 'node:net';
import { query } from '../db/pool.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';

const TTL = 300;
const EMPTY = ' ';

type Family = 'ipv4' | 'ipv6';
interface Entry { from: string; to: string }
export interface IpMatcher { check(ip: string): boolean }

const familyOf = (a: string): Family | null => (isIP(a) === 4 ? 'ipv4' : isIP(a) === 6 ? 'ipv6' : null);

/** Is this an entry a list can hold: an IP, a CIDR, or a same-family from–to range? */
export function validIpEntry(from: string, to?: string | null): boolean {
  const f = from.trim();
  if (f.includes('/')) {
    const [addr, bits] = f.split('/');
    const fam = familyOf(addr ?? '');
    return fam !== null && /^\d+$/.test(bits ?? '') && Number(bits) <= (fam === 'ipv4' ? 32 : 128) && (!to || to.trim() === f);
  }
  const fam = familyOf(f);
  return fam !== null && (!to || to.trim() === f || familyOf(to.trim()) === fam);
}

function compile(entries: Entry[]): BlockList {
  const list = new BlockList();
  for (const { from, to } of entries) {
    try {
      if (from.includes('/')) {
        const [addr, bits] = from.split('/') as [string, string];
        list.addSubnet(addr, Number(bits), familyOf(addr)!);
      } else if (to && to !== from) {
        list.addRange(from, to, familyOf(from)!);
      } else {
        list.addAddress(from, familyOf(from)!);
      }
    } catch {
      // A reversed or cross-family range: skip it rather than break enforcement for the rest.
    }
  }
  return list;
}

/** IPv4-mapped IPv6 ("::ffff:1.2.3.4") is checked as the IPv4 address it carries. */
function checkIp(list: BlockList, ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const addr = mapped ? mapped[1]! : ip;
  const fam = familyOf(addr);
  return fam !== null && list.check(addr, fam);
}

/** A matcher for these entries (IPs, CIDRs, from–to ranges; IPv4-mapped IPv6 checked as IPv4). */
export function compileIpMatcher(entries: Entry[]): IpMatcher {
  const list = compile(entries);
  return { check: (ip) => checkIp(list, ip) };
}

const memo = new Map<string, { raw: string; matcher: IpMatcher }>();

async function load(key: string, sql: string, networkId: string): Promise<IpMatcher | null> {
  try {
    const redis = getRedis();
    let raw = await redis.get(key);
    if (raw === null) {
      const { rows } = await query<{ ip_from: string; ip_to: string | null }>(sql, [networkId]);
      const entries = rows.map((r) => ({ from: r.ip_from.trim(), to: (r.ip_to ?? r.ip_from).trim() }))
        .filter((e) => validIpEntry(e.from, e.to));
      raw = entries.length ? JSON.stringify(entries) : EMPTY;
      await redis.set(key, raw, 'EX', TTL);
    }
    if (raw === EMPTY) return null;
    const hit = memo.get(key);
    if (hit && hit.raw === raw) return hit.matcher;
    const matcher = compileIpMatcher(JSON.parse(raw) as Entry[]);
    memo.set(key, { raw, matcher });
    return matcher;
  } catch (err) {
    logger.warn({ err, key }, 'ip list unavailable — failing open');
    return null;
  }
}

const blKey = (networkId: string) => `ipbl:${networkId}`;
const wlKey = (networkId: string) => `apiwl:${networkId}`;

/** The network's click IP blacklist, or null when it has none. */
export const getNetworkIpBlacklist = (networkId: string): Promise<IpMatcher | null> =>
  load(blKey(networkId), 'SELECT ip_from, ip_to FROM network_ip_blacklist WHERE network_id = $1', networkId);

/** The network's API IP whitelist, or null when it has none (= no restriction). */
export const getNetworkApiWhitelist = (networkId: string): Promise<IpMatcher | null> =>
  load(wlKey(networkId), 'SELECT ip_address AS ip_from, NULL AS ip_to FROM network_api_whitelist WHERE network_id = $1', networkId);

export async function invalidateNetworkIpBlacklist(networkId: string): Promise<void> {
  await getRedis().del(blKey(networkId));
}
export async function invalidateNetworkApiWhitelist(networkId: string): Promise<void> {
  await getRedis().del(wlKey(networkId));
}
