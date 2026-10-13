/**
 * Origin binding for browser-fired conversions (audit F-01 / F-14): /pixel and /iframe only count
 * when the page that fired them belongs to the offer's own site (or the tracking domain itself).
 */
import { describe, it, expect } from 'vitest';
import {
 hostOf, registrableDomain, allowedConversionHosts, conversionOriginAllowed, conversionSourceHost,
 type RequestOrigin,
} from '../../src/surfaces/tracking/conversions/origin.js';

const offer = {
 destinationUrl: 'https://lp.acme.test/offer?cid={click_id}',
 geoRules: [{ destinationOverride: 'https://uk.acme-shop.co.uk/lp' }, { destinationOverride: null }],
} as Parameters<typeof allowedConversionHosts>[0];

const from = (referer: string | null, origin: string | null = null, host = 'track.network.test'): RequestOrigin =>
 ({ referer, origin, host });
const allowed = (o: RequestOrigin) => conversionOriginAllowed(o, allowedConversionHosts(offer, o.host));

describe('hostOf', () => {
 it('reads the hostname of a URL, a bare host or host:port', () => {
 expect(hostOf('https://Checkout.ACME.test/thank-you?x=1')).toBe('checkout.acme.test');
 expect(hostOf('track.network.test:4002')).toBe('track.network.test');
 expect(hostOf('https://acme.test./')).toBe('acme.test');
 });
 it('treats missing, opaque ("null") and unparseable values as absent', () => {
 expect(hostOf(null)).toBeNull();
 expect(hostOf('')).toBeNull();
 expect(hostOf('null')).toBeNull();
 expect(hostOf('https://{sub1}.brand.com/')).toBeNull();
 });
});

describe('registrableDomain', () => {
 it('keeps the last two labels for ordinary hosts', () => {
 expect(registrableDomain('checkout.acme.test')).toBe('acme.test');
 expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
 });
 it('keeps three labels under two-part ccTLD suffixes', () => {
 expect(registrableDomain('uk.acme-shop.co.uk')).toBe('acme-shop.co.uk');
 expect(registrableDomain('shop.brand.com.au')).toBe('brand.com.au');
 });
 it('treats shared-hosting suffixes as public: each customer subdomain is its own site', () => {
 expect(registrableDomain('brand.myshopify.com')).toBe('brand.myshopify.com');
 expect(registrableDomain('www.brand.myshopify.com')).toBe('brand.myshopify.com');
 expect(registrableDomain('team.github.io')).toBe('team.github.io');
 });
 it('returns IP literals and single-label hosts unchanged', () => {
 expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1');
 expect(registrableDomain('localhost')).toBe('localhost');
 });
});

describe('conversionOriginAllowed', () => {
 it('accepts the landing page host and its sibling subdomains (thank-you page on checkout.*)', () => {
 expect(allowed(from('https://lp.acme.test/thank-you'))).toBe(true);
 expect(allowed(from('https://checkout.acme.test/order/123'))).toBe(true);
 });
 it('accepts a geo-rule destination override site', () => {
 expect(allowed(from('https://pay.acme-shop.co.uk/done'))).toBe(true);
 });
 it('accepts the tracking domain itself, exactly', () => {
 expect(allowed(from('https://track.network.test/iframe?click_id=x'))).toBe(true);
 });
 it('rejects a sibling of the tracking domain (tenant subdomains share the tracking base domain)', () => {
 expect(allowed(from('https://other-tenant.network.test/page'))).toBe(false);
 });
 it("rejects a partner's own site (pixel stuffing)", () => {
 expect(allowed(from('https://partner-blog.example/review'))).toBe(false);
 expect(allowed(from('https://evil.co.uk/'))).toBe(false);
 });
 it('rejects a request with no Referer / Origin, or an opaque origin', () => {
 expect(allowed(from(null))).toBe(false);
 expect(allowed(from(null, 'null'))).toBe(false);
 });
 it('prefers Origin over Referer when both are present', () => {
 expect(conversionSourceHost(from('https://lp.acme.test/x', 'https://partner-blog.example'))).toBe('partner-blog.example');
 expect(allowed(from('https://lp.acme.test/x', 'https://partner-blog.example'))).toBe(false);
 });
 it('never treats two stores on a shared host as the same site', () => {
 const shop = { destinationUrl: 'https://brand.myshopify.com/lp', geoRules: [] } as Parameters<typeof allowedConversionHosts>[0];
 const ok = (ref: string) => conversionOriginAllowed(from(ref), allowedConversionHosts(shop, 'track.network.test'));
 expect(ok('https://brand.myshopify.com/thanks')).toBe(true);
 expect(ok('https://partner-store.myshopify.com/thanks')).toBe(false);
 });
 it('a landing page with a templated host still names its site; a templated site names nothing', () => {
 const sub = { destinationUrl: 'https://{sub1}.brand.com/lp?cid={click_id}', geoRules: [] } as Parameters<typeof allowedConversionHosts>[0];
 const okSub = (ref: string) => conversionOriginAllowed(from(ref), allowedConversionHosts(sub, 'track.network.test'));
 expect(okSub('https://us.brand.com/thanks')).toBe(true);
 expect(okSub('https://brand-lookalike.com/')).toBe(false);
 const site = { destinationUrl: 'https://lp.{brand}.com/', geoRules: [] } as Parameters<typeof allowedConversionHosts>[0];
 expect(conversionOriginAllowed(from('https://lp.anything.com/'), allowedConversionHosts(site, 'track.network.test'))).toBe(false);
 expect(allowedConversionHosts(site, null)).toEqual({ exact: [], site: [] });
 });
 it('without an offer config only the tracking domain itself is allowed', () => {
 expect(conversionOriginAllowed(from('https://lp.acme.test/'), allowedConversionHosts(null, 'track.network.test'))).toBe(false);
 expect(conversionOriginAllowed(from('https://track.network.test/'), allowedConversionHosts(null, 'track.network.test'))).toBe(true);
 });
});
