/**
 * Offer settings that contradict each other, so the offer can't get traffic — returned with the offer
 * (GET /api/offers/:id → configWarnings) for the UI to show. Countries are set in two places (Offer › GEO rules
 * with their payouts / landing pages, and Edit Offer › Targeting); a click must pass both, so e.g. GEO "allow
 * US, CA" with Targeting "include IN" lets no click through at all. Pure.
 */
import type { OfferTargeting } from './index.js';

export interface WarningInput {
  status: string;
  visibility: string | null;
  approvedPartners: number;
  allowedTrafficTypes: string[] | null;
  targeting: OfferTargeting | null | undefined;
  geoRules: { country: string; region: string | null; action: string }[];
  /** The GeoIP databases on this server (lib/geo/geoip.ts geoFiles) — absent = don't check. */
  geo?: { city: 'maxmind' | 'dbip' | null; isp: boolean };
}

const GEO_TARGETING = ['country', 'region', 'city', 'dma', 'zip', 'isp', 'mobileCarrier'] as const;

const MOBILE_OS = ['ios', 'android', 'ipados'];
const DESKTOP_OS = ['windows', 'mac os', 'macos', 'linux', 'ubuntu', 'chrome os', 'chromium os'];
const up = (v: string) => v.trim().toUpperCase();
const list = (xs: string[]) => xs.join(', ');

export function offerConfigWarnings(o: WarningInput): string[] {
  const out: string[] = [];
  if (o.status !== 'active') out.push(`The offer is ${o.status} — every click goes to the fallback URL until it is active.`);
  if ((o.visibility === 'private' || o.visibility === 'ask') && o.approvedPartners === 0) {
    out.push('No partner is approved for this offer yet — every click is rejected until one is (Offer › Partners).');
  }

  // Countries: GEO rules (country-level) vs Targeting › Country.
  const allows = o.geoRules.filter((r) => r.action === 'allow');
  const allowAll = allows.some((r) => r.country === '*');
  const allowCountries = [...new Set(allows.filter((r) => r.country !== '*').map((r) => up(r.country)))].sort();
  const denyCountries = new Set(o.geoRules.filter((r) => r.action === 'deny' && !r.region && r.country !== '*').map((r) => up(r.country)));
  const denyAll = o.geoRules.some((r) => r.action === 'deny' && r.country === '*');
  const t = o.targeting?.country;
  const include = t?.mode === 'include' ? [...new Set(t.values.map(up))].sort() : [];
  const exclude = t?.mode === 'exclude' ? new Set(t.values.map(up)) : new Set<string>();
  if (allowCountries.length && !allowAll && include.length && !include.some((c) => allowCountries.includes(c))) {
    out.push(`No country can get through: Offer › GEO allows only ${list(allowCountries)}, but Targeting › Country includes only ${list(include)}.`);
  } else if (include.length && include.every((c) => denyCountries.has(c) || (denyAll && !allowCountries.includes(c)))) {
    out.push(`No country can get through: Targeting › Country includes only ${list(include)}, which Offer › GEO blocks.`);
  }
  if (allowCountries.length && !allowAll && allowCountries.every((c) => exclude.has(c))) {
    out.push(`No country can get through: Offer › GEO allows only ${list(allowCountries)}, and Targeting › Country excludes them all.`);
  }
  if (denyAll && !allowCountries.length) out.push('Offer › GEO blocks every country ("*" deny) and allows none.');

  // Devices vs operating systems.
  const types = o.allowedTrafficTypes ?? [];
  const p = o.targeting?.platform;
  const os = p?.mode === 'include' ? p.values.map((v) => v.trim().toLowerCase()) : [];
  if (types.length && os.length) {
    const desktopOnly = types.every((x) => x === 'desktop');
    const handheldOnly = types.every((x) => x === 'mobile' || x === 'tablet');
    if (desktopOnly && os.every((v) => MOBILE_OS.includes(v))) out.push(`No click can get through: the offer allows desktop only, but Targeting › OS includes only ${list(p!.values)}.`);
    if (handheldOnly && os.every((v) => DESKTOP_OS.includes(v))) out.push(`No click can get through: the offer allows ${list(types)} only, but Targeting › OS includes only ${list(p!.values)}.`);
  }
  // GeoIP: what the tracking server can actually evaluate.
  if (o.geo) {
    const t2 = o.targeting as Record<string, { values?: string[] } | undefined> | null | undefined;
    const uses = (k: string) => (t2?.[k]?.values?.length ?? 0) > 0;
    if (!o.geo.city && (o.geoRules.length || GEO_TARGETING.some(uses))) {
      out.push('GEO is not enforced: this server has no GeoIP database, so country / region / city rules and geo targeting let every visitor through. Run `npm run geoip:download` (set MAXMIND_LICENSE_KEY for MaxMind GeoLite2).');
    }
    if (o.geo.city === 'dbip' && (uses('zip') || uses('dma'))) {
      out.push('Targeting › Zip / DMA rejects every click: the free DB-IP database has no postal or DMA codes. Use MaxMind GeoLite2 (free — set MAXMIND_LICENSE_KEY and run `npm run geoip:download`).');
    }
    if (!o.geo.isp && uses('mobileCarrier')) {
      out.push('Targeting › Mobile Carrier is ignored: it needs the paid MaxMind GeoIP2-ISP database (data/geoip/GeoIP2-ISP.mmdb).');
    }
  }
  return out;
}
