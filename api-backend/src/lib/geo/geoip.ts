/**
 * In-process GeoIP lookup (spec §2 — MaxMind local DB, NEVER a per-click API call). Loads a
 * GeoLite2/GeoIP2 City .mmdb once at startup and does synchronous in-memory lookups on the hot
 * path. Also exposes an optional ISP/ASN db for datacenter detection (fraud signals, §10).
 *
 * FAIL-OPEN when no DB is present (dev without a database): lookups return null and `available` is
 * false, so the geo-rule engine knows to skip geo denial rather than block all traffic — which also
 * means country allow / block rules do NOTHING until a database is loaded. In prod with the DB loaded,
 * an unknown IP is a real "unknown country".
 *
 * Get a database with `npm run geoip:download` (scripts/download-geoip.sh): MaxMind GeoLite2 with
 * MAXMIND_LICENSE_KEY (free account), else DB-IP Lite (no account). Path override: MAXMIND_CITY_DB /
 * MAXMIND_ASN_DB env, else data/geoip/*.mmdb (GeoLite2-City.mmdb, or dbip-city-lite.mmdb).
 * refreshGeoIp() re-opens a database whose file appeared or changed — the tracking surface runs it
 * every 10 minutes, so a downloaded or updated database is picked up without a restart.
 */
import { existsSync, statSync } from 'node:fs';
import { env } from '../../config/env.js';
import { open, type Reader, type CityResponse, type AsnResponse, type IspResponse } from 'maxmind';
import { logger } from '../logger.js';

export interface GeoResult {
  country: string | null; // ISO alpha-2
  /** The region as stored on the click: its ISO subdivision code (MaxMind: "CA", "ENG"), else its name (DB-IP: "California"). */
  region: string | null;
  /** Both forms when known — region rules / targeting match either ("CA" or "California"). */
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  isp: string | null;
  isDatacenter: boolean;
  postal: string | null;
  /** US DMA (Nielsen metro) code, e.g. "501". */
  dma: string | null;
  /** Mobile carrier name — only when the (paid) GeoIP2-ISP db is present and the IP is mobile. */
  carrier: string | null;
}

const CITY_PATHS = [env.MAXMIND_CITY_DB, 'data/geoip/GeoLite2-City.mmdb', 'data/geoip/dbip-city-lite.mmdb'].filter(Boolean) as string[];
const ASN_PATHS = [env.MAXMIND_ASN_DB, 'data/geoip/GeoLite2-ASN.mmdb', 'data/geoip/dbip-asn-lite.mmdb'].filter(Boolean) as string[];
const ISP_PATHS = ['data/geoip/GeoIP2-ISP.mmdb'];

let city: { reader: Reader<CityResponse>; path: string; mtimeMs: number } | null = null;
let asn: { reader: Reader<AsnResponse>; path: string; mtimeMs: number } | null = null;
let isp: { reader: Reader<IspResponse>; path: string; mtimeMs: number } | null = null;
let loaded = false;

const firstExisting = (paths: string[]) => paths.find((p) => existsSync(p)) ?? null;
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

/** Opens these databases (any omitted kind stays as it is). Exported for tests, which load the fixtures. */
export async function loadGeoIp(paths: { city?: string | null; asn?: string | null; isp?: string | null }): Promise<void> {
  if (paths.city) city = { reader: await open<CityResponse>(paths.city), path: paths.city, mtimeMs: mtime(paths.city) };
  if (paths.asn) asn = { reader: await open<AsnResponse>(paths.asn), path: paths.asn, mtimeMs: mtime(paths.asn) };
  if (paths.isp) isp = { reader: await open<IspResponse>(paths.isp), path: paths.isp, mtimeMs: mtime(paths.isp) };
}

/** Forgets every database (tests). */
export function unloadGeoIp(): void { city = null; asn = null; isp = null; loaded = false; }

export async function initGeoIp(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await refreshGeoIp();
  if (!city) logger.warn('geoip city db not found — country / region / city rules are NOT enforced (fail-open). Run: npm run geoip:download');
}

/** (Re)opens a database whose file appeared or changed since it was loaded. */
export async function refreshGeoIp(): Promise<void> {
  const want = { city: firstExisting(CITY_PATHS), asn: firstExisting(ASN_PATHS), isp: firstExisting(ISP_PATHS) };
  const stale = <T extends { path: string; mtimeMs: number } | null>(cur: T, path: string | null) =>
    path !== null && (!cur || cur.path !== path || cur.mtimeMs !== mtime(path));
  try {
    const next = {
      city: stale(city, want.city) ? want.city : null,
      asn: stale(asn, want.asn) ? want.asn : null,
      isp: stale(isp, want.isp) ? want.isp : null,
    };
    if (next.city || next.asn || next.isp) {
      await loadGeoIp(next);
      logger.info({ city: city?.path ?? null, asn: asn?.path ?? null, isp: isp?.path ?? null }, 'geoip databases loaded');
    }
  } catch (err) {
    logger.error({ err }, 'geoip database could not be opened — keeping the previous one');
  }
}

/** Which databases are loaded (for /health and the docs' "is GEO working?" check). */
export function geoStatus(): { city: string | null; asn: string | null; isp: string | null } {
  return { city: city?.path ?? null, asn: asn?.path ?? null, isp: isp?.path ?? null };
}

/** Whether a geo database is loaded. When false, callers should fail-open on geo rules. */
export function geoAvailable(): boolean {
  return city !== null;
}

/** Whether mobile-carrier data is available (GeoIP2-ISP db). */
export function carrierAvailable(): boolean {
  return isp !== null;
}

export function lookupGeo(ip: string): GeoResult | null {
  if (!city) return null;
  let c: CityResponse | null = null;
  try {
    c = city.reader.get(ip);
  } catch {
    return null; // invalid/private IP
  }
  let a: AsnResponse | null = null;
  try { a = asn?.reader.get(ip) ?? null; } catch { a = null; }
  let i: IspResponse | null = null;
  try { i = isp?.reader.get(ip) ?? null; } catch { i = null; }
  const org = i?.isp ?? a?.autonomous_system_organization ?? null;
  return {
    country: c?.country?.iso_code ?? null,
    region: c?.subdivisions?.[0]?.iso_code ?? c?.subdivisions?.[0]?.names?.en ?? null,
    regionCode: c?.subdivisions?.[0]?.iso_code ?? null,
    regionName: c?.subdivisions?.[0]?.names?.en ?? null,
    city: c?.city?.names?.en ?? null,
    isp: org,
    // Cheap heuristic; a proper datacenter list is a Phase 6/10 refinement.
    isDatacenter: /hosting|cloud|amazon|google|microsoft|digitalocean|ovh|linode|hetzner/i.test(org ?? ''),
    postal: c?.postal?.code ?? null,
    dma: c?.location?.metro_code != null ? String(c.location.metro_code) : null,
    carrier: i?.mobile_network_code ? (i.isp ?? null) : null,
  };
}

