import { describe, it, expect } from 'vitest';
import { evaluateTargeting, primaryLanguage, type TargetingContext } from '../../src/surfaces/tracking/targeting-eval.js';
import { isValidPostal } from '../../src/lib/offer-settings/postal.js';
import { ipInRange, isValidIpRange, isValidExactIp } from '../../src/lib/offer-settings/ip-match.js';
import { targetingSchema, attributionSettingsSchema, revenueSettingsSchema, mergeOfferMetadata, readAttribution } from '../../src/lib/offer-settings/index.js';

const ctx = (over: Partial<TargetingContext> = {}): TargetingContext => ({
  platform: 'iOS', browser: 'Mobile Safari', deviceBrand: 'Apple', osVersion: '17.4.1', language: 'en-us',
  country: 'US', region: 'CA', city: 'San Jose', dma: '807', mobileCarrier: null, isp: 'Comcast Cable',
  zip: '95112', ip: '203.0.113.20', ...over,
});
const allAvail = { geo: true, country: true, carrier: true };

describe('evaluateTargeting', () => {
  it('allows when no rules', () => {
    expect(evaluateTargeting({}, ctx(), allAvail).allowed).toBe(true);
    expect(evaluateTargeting(undefined, ctx(), allAvail).allowed).toBe(true);
  });

  it('include rule blocks a non-matching value and names the dimension', () => {
    const d = evaluateTargeting({ platform: { mode: 'include', values: ['Android'] } }, ctx(), allAvail);
    expect(d).toEqual({ allowed: false, failedOn: 'platform' });
  });

  it('exclude rule blocks a matching value (case-insensitive)', () => {
    expect(evaluateTargeting({ browser: { mode: 'exclude', values: ['mobile safari'] } }, ctx(), allAvail).allowed).toBe(false);
    expect(evaluateTargeting({ browser: { mode: 'exclude', values: ['Chrome'] } }, ctx(), allAvail).allowed).toBe(true);
  });

  it('OS version matches by prefix segment', () => {
    expect(evaluateTargeting({ osVersion: { mode: 'include', values: ['17'] } }, ctx(), allAvail).allowed).toBe(true);
    expect(evaluateTargeting({ osVersion: { mode: 'include', values: ['1'] } }, ctx(), allAvail).allowed).toBe(false);
  });

  it('language matches primary subtag or full tag', () => {
    expect(evaluateTargeting({ language: { mode: 'include', values: ['en'] } }, ctx(), allAvail).allowed).toBe(true);
    expect(evaluateTargeting({ language: { mode: 'include', values: ['en-GB'] } }, ctx(), allAvail).allowed).toBe(false);
    expect(primaryLanguage('fr-CA,fr;q=0.9')).toBe('fr-ca');
  });

  it('region accepts bare or country-prefixed codes', () => {
    expect(evaluateTargeting({ region: { mode: 'include', values: ['US-CA'] } }, ctx(), allAvail).allowed).toBe(true);
    expect(evaluateTargeting({ region: { mode: 'include', values: ['NY'] } }, ctx(), allAvail).allowed).toBe(false);
  });

  it('ZIP+4 rule matches 5-digit geo postal', () => {
    expect(evaluateTargeting({ zip: { mode: 'include', values: ['95112-1234'] } }, ctx(), allAvail).allowed).toBe(true);
  });

  it('IP exact and range rules', () => {
    expect(evaluateTargeting({ ipRange: { mode: 'include', values: ['203.0.113.0/24'] } }, ctx(), allAvail).allowed).toBe(true);
    expect(evaluateTargeting({ ipRange: { mode: 'exclude', values: ['203.0.113.10-203.0.113.30'] } }, ctx(), allAvail).allowed).toBe(false);
    expect(evaluateTargeting({ ipExact: { mode: 'include', values: ['198.51.100.1'] } }, ctx(), allAvail).allowed).toBe(false);
    expect(evaluateTargeting({ ipExact: { mode: 'include', values: ['203.0.113.20'] } }, ctx({ ip: '::ffff:203.0.113.20' }), allAvail).allowed).toBe(true);
  });

  it('geo dimensions fail open when the geo db is not loaded', () => {
    const noGeo = { geo: false, country: false, carrier: false };
    expect(evaluateTargeting({ country: { mode: 'include', values: ['GB'] } }, ctx({ country: null }), noGeo).allowed).toBe(true);
    expect(evaluateTargeting({ zip: { mode: 'include', values: ['10001'] } }, ctx({ zip: null }), noGeo).allowed).toBe(true);
    // UA-sourced dimensions still enforce.
    expect(evaluateTargeting({ platform: { mode: 'include', values: ['Android'] } }, ctx(), noGeo).allowed).toBe(false);
  });

  it('forced country is enforced even without a geo db', () => {
    const forced = { geo: false, country: true, carrier: false };
    expect(evaluateTargeting({ country: { mode: 'include', values: ['GB'] } }, ctx({ country: 'US' }), forced).allowed).toBe(false);
  });

  it('missing UA value never satisfies an include', () => {
    expect(evaluateTargeting({ browser: { mode: 'include', values: ['Chrome'] } }, ctx({ browser: null }), allAvail).allowed).toBe(false);
  });
});

describe('postal validation', () => {
  it('is country-aware', () => {
    expect(isValidPostal('12345', ['US'])).toBe(true);
    expect(isValidPostal('12345-6789', ['US'])).toBe(true);
    expect(isValidPostal('1234', ['US'])).toBe(false);
    expect(isValidPostal('SW1A 1AA', ['GB'])).toBe(true);
    expect(isValidPostal('12345', ['GB'])).toBe(false);
    expect(isValidPostal('K1A 0B1', ['CA'])).toBe(true);
    expect(isValidPostal('110001', ['IN'])).toBe(true);
    expect(isValidPostal('012345', ['IN'])).toBe(false);
  });
  it('accepts a code valid for any targeted country', () => {
    expect(isValidPostal('2000', ['US', 'AU'])).toBe(true);
  });
  it('falls back to a generic format with no country', () => {
    expect(isValidPostal('AB-123')).toBe(true);
    expect(isValidPostal('x')).toBe(false);
    expect(isValidPostal('!!!!')).toBe(false);
  });
});

describe('ip helpers', () => {
  it('validates exact IPs and ranges', () => {
    expect(isValidExactIp('10.0.0.1')).toBe(true);
    expect(isValidExactIp('2001:db8::1')).toBe(true);
    expect(isValidExactIp('10.0.0.256')).toBe(false);
    expect(isValidIpRange('10.0.0.0/8')).toBe(true);
    expect(isValidIpRange('10.0.0.9-10.0.0.1')).toBe(false);
    expect(isValidIpRange('10.0.0.0/33')).toBe(false);
  });
  it('matches ranges inclusively', () => {
    expect(ipInRange('10.255.255.255', '10.0.0.0/8')).toBe(true);
    expect(ipInRange('11.0.0.0', '10.0.0.0/8')).toBe(false);
    expect(ipInRange('0.0.0.1', '0.0.0.0/0')).toBe(true);
  });
});

describe('offer settings schemas', () => {
  it('rejects a ZIP that does not fit the included countries, with the line index', () => {
    const r = targetingSchema.safeParse({ country: { mode: 'include', values: ['us'] }, zip: { mode: 'include', values: ['12345', 'SW1A 1AA'] } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['zip', 'values', 1]);
  });

  it('normalises and dedupes targeting values and drops empty rules', () => {
    const r = targetingSchema.parse({
      country: { mode: 'include', values: ['gb', 'GB'] },
      zip: { mode: 'include', values: ['sw1a  1aa'] },
      browser: { mode: 'exclude', values: [] },
    });
    expect(r).toEqual({ country: { mode: 'include', values: ['GB'] }, zip: { mode: 'include', values: ['SW1A 1AA'] } });
  });

  it('rejects invalid IPs, countries and DMA codes', () => {
    expect(targetingSchema.safeParse({ ipExact: { mode: 'include', values: ['nope'] } }).success).toBe(false);
    expect(targetingSchema.safeParse({ country: { mode: 'include', values: ['USA'] } }).success).toBe(false);
    expect(targetingSchema.safeParse({ dma: { mode: 'include', values: ['5011'] } }).success).toBe(false);
  });

  it('requires max click-to-conversion time > min', () => {
    const base = readAttribution({});
    expect(attributionSettingsSchema.safeParse({ ...base, clickToConversion: { enabled: true, minSeconds: 60, maxSeconds: 30 } }).success).toBe(false);
    expect(attributionSettingsSchema.safeParse({ ...base, clickToConversion: { enabled: true, minSeconds: 5, maxSeconds: 3600 } }).success).toBe(true);
  });

  it('requires a percentage for percentage/mixed revenue', () => {
    const base = { baseEventName: null, manualApproval: false, allowDuplicates: true, revenueAction: 'conversion', pricePerProduct: false } as const;
    expect(revenueSettingsSchema.safeParse({ ...base, revenueType: 'percentage', revenuePct: null }).success).toBe(false);
    expect(revenueSettingsSchema.safeParse({ ...base, revenueType: 'percentage', revenuePct: 12.5 }).success).toBe(true);
  });

  it('merges metadata fields without clobbering unrelated keys', () => {
    const merged = mergeOfferMetadata({ notes: ['keep'], linking_type: 'redirect' }, { appIdentifier: 'com.acme.app', targeting: {} });
    expect(merged).toEqual({ notes: ['keep'], linking_type: 'redirect', app_identifier: 'com.acme.app', targeting: {} });
    expect(mergeOfferMetadata({ a: 1 }, { name: 'x' })).toBeNull();
  });

  it('reads stored settings over defaults (older offers get defaults)', () => {
    const a = readAttribution({ attribution_settings: { throttle: { enabled: true, ratePct: 10 } } });
    expect(a.throttle).toEqual({ enabled: true, ratePct: 10 });
    expect(a.clickToConversion.enabled).toBe(false);
  });
});
