/** Targeting value validation (mirrors the backend's targetingSchema) — shared by the panel and the save guard. */
import { isValidPostal } from '../../../lib/postal';
import type { OfferTargeting, TargetingKey, TargetingRule } from '../../../types';

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
function isIpv6(v: string) { return v.includes(':') && /^[0-9a-f:.]+$/i.test(v); }
function validRange(v: string): boolean {
  if (v.includes('/')) { const [ip, bits] = v.split('/'); return IPV4.test(ip ?? '') && /^\d+$/.test(bits ?? '') && Number(bits) <= 32; }
  if (v.includes('-')) {
    const [a, b] = v.split('-').map((x) => x.trim());
    if (!IPV4.test(a ?? '') || !IPV4.test(b ?? '')) return false;
    const n = (ip: string) => ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
    return n(a!) <= n(b!);
  }
  return false;
}

export function validateTargetingValue(key: TargetingKey, v: string, countries: string[] = []): string | null {
  switch (key) {
    case 'country': return /^[A-Z]{2}$/i.test(v) ? null : `"${v}" is not a 2-letter ISO country code`;
    case 'dma': return /^\d{3}$/.test(v) ? null : `"${v}" is not a 3-digit DMA code`;
    case 'ipExact': return IPV4.test(v) || isIpv6(v) ? null : `"${v}" is not a valid IP address`;
    case 'ipRange': return validRange(v) ? null : `"${v}" is not a valid CIDR or start-end range`;
    case 'zip': return isValidPostal(v, countries) ? null
      : countries.length ? `"${v}" is not a valid postal code for ${Array.from(new Set(countries)).join('/')}` : `"${v}" is not a valid postal code`;
    default: return null;
  }
}

export const zipCountries = (t: OfferTargeting) => (t.country?.mode === 'include' ? t.country.values.map((c) => c.toUpperCase()) : []);

/** All validation problems across the targeting rules — used to block saving. */
export function targetingErrors(t: OfferTargeting): string[] {
  const out: string[] = [];
  for (const [key, rule] of Object.entries(t) as [TargetingKey, TargetingRule][]) {
    for (const v of rule?.values ?? []) {
      const e = validateTargetingValue(key, v, zipCountries(t));
      if (e) out.push(e);
    }
  }
  return out;
}

