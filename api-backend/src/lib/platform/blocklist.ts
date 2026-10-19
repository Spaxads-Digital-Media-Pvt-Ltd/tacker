/**
 * The platform blocklist (Super Admin › Trust & safety): addresses, user agents and referrer domains blocked
 * for EVERY network — /click rejects a match ('platform_blocked') before the network's own rules.
 *
 * Like the network IP lists (lib/net/ip-lists.ts): the live entries are cached in Redis (load-through, busted
 * by every change, 5-minute TTL so an expiry takes effect within minutes) and the compiled matcher is memoized
 * in-process per cached value — the click path pays one Redis GET, fetched in parallel with the offer config,
 * then in-memory checks. A Redis or database hiccup fails OPEN (nothing blocked), as the rate limiters do.
 * Each block counts a hit (Redis hash, fire-and-forget) for the page.
 */
import { query } from '../db/pool.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import { compileIpMatcher, validIpEntry, type IpMatcher } from '../net/ip-lists.js';

const KEY = 'platform:blocklist';
const HITS = 'platform:blocklist:hits';
const TTL = 300;
const EMPTY = ' ';

export type BlockKind = 'ip' | 'user_agent' | 'referrer';
interface CachedEntry { id: string; kind: BlockKind; value: string; to: string | null }

export interface PlatformBlocklist {
  /** The first entry the click matches (its id, for the hit count), or null. */
  match(c: { ip: string | null; userAgent: string | null; referrer: string | null }): { id: string; kind: BlockKind } | null;
}

/** "Example.COM." / "https://www.example.com/x" → "www.example.com" (null when there is no host). */
export function hostOf(referrer: string | null): string | null {
  if (!referrer) return null;
  const raw = referrer.trim().toLowerCase();
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

/** Is `host` this domain or one of its subdomains? */
const underDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function compile(entries: CachedEntry[]): PlatformBlocklist {
  const ips = entries.filter((e) => e.kind === 'ip').map((e) => ({ from: e.value, to: e.to ?? e.value, id: e.id }));
  // One native list for the common "no match" answer; the entry that matched is looked up only on a block.
  const anyIp: IpMatcher | null = ips.length ? compileIpMatcher(ips) : null;
  const agents = entries.filter((e) => e.kind === 'user_agent').map((e) => ({ id: e.id, phrase: e.value.toLowerCase() }));
  const domains = entries.filter((e) => e.kind === 'referrer').map((e) => ({ id: e.id, domain: e.value.toLowerCase() }));
  return {
    match({ ip, userAgent, referrer }) {
      if (ip && anyIp?.check(ip)) {
        const hit = ips.find((e) => compileIpMatcher([e]).check(ip));
        return { id: hit?.id ?? ips[0]!.id, kind: 'ip' };
      }
      if (userAgent && agents.length) {
        const ua = userAgent.toLowerCase();
        for (const e of agents) if (ua.includes(e.phrase)) return { id: e.id, kind: 'user_agent' };
      }
      const host = domains.length ? hostOf(referrer) : null;
      if (host) for (const e of domains) if (underDomain(host, e.domain)) return { id: e.id, kind: 'referrer' };
      return null;
    },
  };
}

let memo: { raw: string; list: PlatformBlocklist } | null = null;

/** The live platform blocklist, or null when it is empty (or unavailable — fail open). */
export async function getPlatformBlocklist(): Promise<PlatformBlocklist | null> {
  try {
    const redis = getRedis();
    let raw = await redis.get(KEY);
    if (raw === null) {
      const { rows } = await query<CachedEntry>(
        `SELECT id, kind, value, value_to AS "to" FROM platform_blocklist WHERE expires_at IS NULL OR expires_at > now() ORDER BY created_at`);
      raw = rows.length ? JSON.stringify(rows) : EMPTY;
      await redis.set(KEY, raw, 'EX', TTL);
    }
    if (raw === EMPTY) return null;
    if (memo?.raw === raw) return memo.list;
    const list = compile(JSON.parse(raw) as CachedEntry[]);
    memo = { raw, list };
    return list;
  } catch (err) {
    logger.warn({ err }, 'platform blocklist unavailable — failing open');
    return null;
  }
}

export async function invalidatePlatformBlocklist(): Promise<void> {
  await getRedis().del(KEY);
}

/** Count a block (never awaited on the click path; a lost count is fine). */
export function recordBlocklistHit(id: string): void {
  void getRedis().hincrby(HITS, id, 1).catch(() => undefined);
}

/** Blocks per entry since it was added. */
export async function blocklistHits(): Promise<Record<string, number>> {
  const raw = await getRedis().hgetall(HITS).catch(() => ({} as Record<string, string>));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v) || 0]));
}

export async function forgetBlocklistHits(id: string): Promise<void> {
  await getRedis().hdel(HITS, id).catch(() => undefined);
}

/** Validates an entry before it is saved: the reason it can't be, or null. */
export function blocklistEntryError(kind: BlockKind, value: string, to?: string | null): string | null {
  const v = value.trim();
  if (!v) return 'Enter a value.';
  if (kind === 'ip') {
    if (!validIpEntry(v, to ?? null)) return 'Enter an IP address, a CIDR (e.g. 203.0.113.0/24) or a range of the same family.';
    return null;
  }
  if (to) return 'Only IP entries take a range.';
  if (kind === 'user_agent') return v.length < 3 ? 'A user-agent phrase needs at least 3 characters — shorter ones would block real visitors.' : null;
  const host = hostOf(v);
  return host && host.includes('.') ? null : 'Enter a domain, e.g. spam-traffic.example.';
}

/** The domain an entry for a referrer is stored as (scheme, path and "www." are dropped). */
export const normalizeReferrerDomain = (v: string): string => (hostOf(v) ?? v.trim().toLowerCase()).replace(/^www\./, '');
