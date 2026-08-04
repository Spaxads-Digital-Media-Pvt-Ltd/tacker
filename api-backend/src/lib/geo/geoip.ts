/**
 * In-process GeoIP lookup (spec §2 — MaxMind local DB, NEVER a per-click API call). Loads a
 * GeoLite2/GeoIP2 City .mmdb once at startup and does synchronous in-memory lookups on the hot
 * path. Also exposes an optional ISP/ASN db for datacenter detection (fraud signals, §10).
 *
 * FAIL-OPEN when no DB is present (dev without a MAXMIND license): lookups return null and
 * `available` is false, so the geo-rule engine knows to skip geo denial rather than block all
 * traffic. In prod with the DB loaded, an unknown IP is a real "unknown country".
 *
 * Download the DB with scripts/download-geoip.sh (needs MAXMIND_LICENSE_KEY). Path override:
 * MAXMIND_CITY_DB / MAXMIND_ASN_DB env, else data/geoip/*.mmdb.
 */
import { existsSync } from 'node:fs';
import { open, type Reader, type CityResponse, type AsnResponse } from 'maxmind';
import { logger } from '../logger.js';

export interface GeoResult {
  country: string | null; // ISO alpha-2
  region: string | null;
  city: string | null;
  isp: string | null;
  isDatacenter: boolean;
}

const CITY_PATHS = [process.env.MAXMIND_CITY_DB, 'data/geoip/GeoLite2-City.mmdb'].filter(Boolean) as string[];
const ASN_PATHS = [process.env.MAXMIND_ASN_DB, 'data/geoip/GeoLite2-ASN.mmdb'].filter(Boolean) as string[];

let cityReader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;
let loaded = false;

export async function initGeoIp(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const cityPath = CITY_PATHS.find((p) => existsSync(p));
  if (cityPath) {
    cityReader = await open<CityResponse>(cityPath);
    logger.info({ cityPath }, 'geoip city db loaded');
  } else {
    logger.warn('geoip city db not found — geo enrichment disabled (fail-open). See scripts/download-geoip.sh');
  }
  const asnPath = ASN_PATHS.find((p) => existsSync(p));
  if (asnPath) {
    asnReader = await open<AsnResponse>(asnPath);
    logger.info({ asnPath }, 'geoip asn db loaded');
  }
}

/** Whether a geo database is loaded. When false, callers should fail-open on geo rules. */
export function geoAvailable(): boolean {
  return cityReader !== null;
}

export function lookupGeo(ip: string): GeoResult | null {
  if (!cityReader) return null;
  let city: CityResponse | null = null;
  try {
    city = cityReader.get(ip);
  } catch {
    return null; // invalid/private IP
  }
  const asn = asnReader?.get(ip) ?? null;
  const org = asn?.autonomous_system_organization ?? null;
  return {
    country: city?.country?.iso_code ?? null,
    region: city?.subdivisions?.[0]?.iso_code ?? null,
    city: city?.city?.names?.en ?? null,
    isp: org,
    // Cheap heuristic; a proper datacenter list is a Phase 6/10 refinement.
    isDatacenter: /hosting|cloud|amazon|google|microsoft|digitalocean|ovh|linode|hetzner/i.test(org ?? ''),
  };
}
