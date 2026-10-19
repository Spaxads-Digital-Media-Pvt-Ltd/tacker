/**
 * Where the visitor is, for /click and /sl — one answer for both:
 *
 * 1. the dev / test override `geo=XX` or `geo=XX-RR` (country, region) — never in production (A-5);
 * 2. the GeoIP database (lib/geo/geoip.ts) for the visitor's IP;
 * 3. on a request that came through Cloudflare, its `CF-IPCountry` header (country only; "XX" unknown and
 *    "T1" Tor ignored) — so country rules still work behind Cloudflare without a database.
 *
 * `known` says whether country rules can be judged: a country was found, or the database is loaded (then an
 * IP it doesn't know is a real "unknown country", which an allow-list denies). Without any of the three,
 * rules fail open — which is why a missing GeoIP database makes allow / block lists do nothing.
 */
import { env } from '../../config/env.js';
import { geoAvailable, lookupGeo, type GeoResult } from '../../lib/geo/geoip.js';
import { isCloudflareAddress } from '../../lib/net/trusted-proxy.js';
import { resolveForcedGeo, resolveForcedRegion } from './geo-rules.js';

export interface VisitorGeo {
  geo: GeoResult | null;
  country: string | null;
  /** Stored on the click: the region code, else its name. */
  region: string | null;
  /** Every form of the region the rules may name (code, name). */
  regionKeys: string[];
  known: boolean;
  source: 'override' | 'database' | 'cloudflare' | null;
}

/** Cloudflare's country for a request from its edge, or null. */
export function cloudflareCountry(socketAddress: string | null | undefined, header: unknown): string | null {
  if (!isCloudflareAddress(socketAddress)) return null;
  const v = (Array.isArray(header) ? header[0] : header)?.toString().trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null;
}

export function visitorGeo(input: {
  ip: string | null; socketAddress: string | null | undefined; cfCountry: unknown; geoParam: string | null; testGeoParam: string | null;
}): VisitorGeo {
  const geo = input.ip ? lookupGeo(input.ip) : null;
  const forced = resolveForcedGeo(env.NODE_ENV, input.geoParam, input.testGeoParam);
  const keysOf = (g: GeoResult | null) => [g?.regionCode, g?.regionName].filter((x): x is string => !!x);
  if (forced) {
    const forcedRegion = resolveForcedRegion(env.NODE_ENV, input.geoParam, input.testGeoParam);
    if (forcedRegion) return { geo, country: forced, region: forcedRegion, regionKeys: [forcedRegion], known: true, source: 'override' };
    const same = geo?.country === forced;
    return { geo, country: forced, region: same ? geo!.region : null, regionKeys: same ? keysOf(geo) : [], known: true, source: 'override' };
  }
  if (geo?.country) return { geo, country: geo.country, region: geo.region, regionKeys: keysOf(geo), known: true, source: 'database' };
  const cf = cloudflareCountry(input.socketAddress, input.cfCountry);
  if (cf) return { geo, country: cf, region: null, regionKeys: [], known: true, source: 'cloudflare' };
  return { geo, country: null, region: null, regionKeys: [], known: geoAvailable(), source: null };
}
