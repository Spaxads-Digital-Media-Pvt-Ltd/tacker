/**
 * Single source of truth for country / region / city / timezone reference data.
 *
 * Values stay ISO codes everywhere (country = ISO 3166-1 alpha-2, region = top-level ISO 3166-2,
 * stored country-prefixed like "US-CA") — that's what the backend stores and what the tracking
 * server matches against MaxMind output. Names are display-only.
 *
 * Country names come from the browser (Intl.DisplayNames), so the only eager data is the ~1 KB
 * code list. Regions, timezones and per-country city lists are generated JSON
 * (scripts/generate-geo-data.mjs) loaded on demand via dynamic import, so they're separate chunks
 * and never in the main bundle.
 */
import { useEffect, useState } from 'react';
import COUNTRY_CODE_LIST from './generated/countries.json';

/** [code, name, primaryTz?] — tz only present when it differs from the country's primary zone. */
export type RegionRow = [code: string, name: string, tz?: string];
/** [name, regionSuffix?] — regionSuffix is the part after "CC-" (e.g. "MH" for IN-MH). */
type CityRow = [name: string, region?: string];

export const COUNTRY_CODES: readonly string[] = COUNTRY_CODE_LIST;
const COUNTRY_SET = new Set(COUNTRY_CODES);

let displayNames: Intl.DisplayNames | null | undefined;
/** Full English country name for an ISO alpha-2 code ("IN" → "India"); falls back to the code. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const cc = code.toUpperCase();
  if (displayNames === undefined) {
    try { displayNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { displayNames = null; }
  }
  try { return displayNames?.of(cc) ?? cc; } catch { return cc; }
}

/** "India (IN)" — name plus code, for pickers and chips where the stored code matters. */
export function countryLabel(code: string): string {
  const name = countryName(code);
  return name && name !== code.toUpperCase() ? `${name} (${code.toUpperCase()})` : code.toUpperCase();
}

export function isCountryCode(code: string): boolean { return COUNTRY_SET.has(code.toUpperCase()); }

/** Every country as picker options, sorted by display name. */
export function countryOptions(): { value: string; label: string }[] {
  return COUNTRY_CODES.map((c) => ({ value: c, label: countryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ── Lazy datasets ────────────────────────────────────────────────────────────

let regionsP: Promise<Record<string, RegionRow[]>> | null = null;
export function loadRegions(): Promise<Record<string, RegionRow[]>> {
  regionsP ??= import('./generated/regions.json').then((m) => m.default as unknown as Record<string, RegionRow[]>);
  return regionsP;
}

let tzP: Promise<Record<string, string[]>> | null = null;
export function loadTimezones(): Promise<Record<string, string[]>> {
  tzP ??= import('./generated/timezones.json').then((m) => m.default as Record<string, string[]>);
  return tzP;
}

const cityLoaders = import.meta.glob<{ default: CityRow[] }>('./generated/cities/*.json');
const cityCache = new Map<string, Promise<CityRow[]>>();
function loadCities(cc: string): Promise<CityRow[]> {
  const key = `./generated/cities/${cc}.json`;
  let p = cityCache.get(cc);
  if (!p) {
    const loader = cityLoaders[key];
    p = loader ? loader().then((m) => m.default) : Promise.resolve([]);
    cityCache.set(cc, p);
  }
  return p;
}

/** City names for one country (largest first). */
export function loadCityNames(cc: string): Promise<string[]> {
  return loadCities(cc.toUpperCase()).then((rows) => rows.map((r) => r[0]));
}

function useLoaded<T>(load: () => Promise<T>): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((d) => { if (alive) setV(d); }).catch(() => { /* reference data is best-effort */ });
    return () => { alive = false; };
  }, [load]);
  return v;
}

/** Top-level regions per country (null while loading). */
export function useRegions(): Record<string, RegionRow[]> | null { return useLoaded(loadRegions); }
/** Country → IANA zones, most-populated (primary) first (null while loading). */
export function useTimezones(): Record<string, string[]> | null { return useLoaded(loadTimezones); }

export interface CityOption { name: string; country: string; region: string | null }

/**
 * Cities (population ≥ 15k, largest first) for the given countries, optionally narrowed to
 * full region codes ("IN-MH"). Loads each country's file on first use.
 */
export function useCities(countries: string[], regions: string[] = []): CityOption[] {
  const [cities, setCities] = useState<CityOption[]>([]);
  const cKey = countries.map((c) => c.toUpperCase()).sort().join(',');
  const rKey = regions.map((r) => r.toUpperCase()).sort().join(',');
  useEffect(() => {
    let alive = true;
    const ccs = cKey ? cKey.split(',') : [];
    const regionSet = new Set(rKey ? rKey.split(',') : []);
    Promise.all(ccs.map((cc) => loadCities(cc).then((rows) => rows.map(([name, r]): CityOption => ({ name, country: cc, region: r ? `${cc}-${r}` : null })))))
      .then((lists) => {
        if (!alive) return;
        // Only narrow a country by region when at least one selected region belongs to it.
        const out = lists.flatMap((list) => {
          const cc = list[0]?.country;
          const own = cc ? [...regionSet].some((r) => r.startsWith(`${cc}-`)) : false;
          return own ? list.filter((c) => c.region != null && regionSet.has(c.region)) : list;
        });
        setCities(out);
      })
      .catch(() => { if (alive) setCities([]); });
    return () => { alive = false; };
  }, [cKey, rKey]);
  return cities;
}

/** Region display name for a stored value ("IN-MH" → "Maharashtra"); unprefixed codes need the country. */
export function regionName(regions: Record<string, RegionRow[]> | null, value: string, country?: string | null): string | null {
  if (!regions) return null;
  const v = value.toUpperCase();
  const full = v.includes('-') ? v : country ? `${country.toUpperCase()}-${v}` : null;
  if (!full) return null;
  return regions[full.slice(0, 2)]?.find((r) => r[0] === full)?.[1] ?? null;
}

/**
 * The timezone to use for a country: an explicit pick if it belongs to the country, else the
 * zone of the (single) selected region when it differs, else the country's primary zone.
 */
export function countryTimeZone(
  zones: Record<string, string[]> | null, regions: Record<string, RegionRow[]> | null,
  country: string, opts: { picked?: string | null; regionCodes?: string[] } = {},
): string | null {
  const cc = country.toUpperCase();
  const list = zones?.[cc] ?? [];
  if (opts.picked && list.includes(opts.picked)) return opts.picked;
  const own = (opts.regionCodes ?? []).map((r) => r.toUpperCase()).filter((r) => r.startsWith(`${cc}-`));
  if (own.length === 1) {
    const tz = regions?.[cc]?.find((r) => r[0] === own[0])?.[2];
    if (tz) return tz;
  }
  return list[0] ?? null;
}
