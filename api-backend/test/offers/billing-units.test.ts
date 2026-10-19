/**
 * The pure pieces behind CPC / CPM billing, price per product, email ownership, view-through cookies, direct
 * linking and 24metrics (no database).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { scaleMoney } from '../../src/lib/money.js';
import { actionPricing, actionOfModel, billingRowSql } from '../../src/lib/offer-settings/billing.js';
import { parseProductLines, priceProducts, type ProductPrice } from '../../src/lib/offer-settings/products.js';
import { emailHashOf } from '../../src/surfaces/tracking/conversions/email-ownership.js';
import { parseCookies, vtCookieName } from '../../src/surfaces/tracking/conversions/view-through.js';
import { sdkOrigin } from '../../src/surfaces/tracking/conversions/origin.js';
import { gatewayBase, validTrackerId, verdictFlags } from '../../src/lib/integrations/tracker24.js';
import { SDK_JS } from '../../src/surfaces/tracking/sdk.js';
import type { CustomSettingConfig } from '../../src/lib/offer-settings/custom-settings.js';

describe('scaleMoney', () => {
  it('multiplies and divides exactly, rounding half away from zero', () => {
    expect(scaleMoney('2.5000', 3)).toBe('7.5000');
    expect(scaleMoney('2.0000', 3, 1000)).toBe('0.0060');
    expect(scaleMoney('0.0700', 5, 1000)).toBe('0.0004'); // 0.00035 → 0.0004
    expect(scaleMoney('0.0700', 7, 1000)).toBe('0.0005');
    expect(scaleMoney('1.5000', 10_000_000n, 1000)).toBe('15000.0000');
    expect(() => scaleMoney('1', 1, 0)).toThrow();
  });
});

describe('what an offer is priced on', () => {
  const setting = (over: Partial<CustomSettingConfig>): CustomSettingConfig => ({
    id: 's', category: 'revenue_payout', allPartners: false, partnerIds: ['p1'], effectiveFrom: null, effectiveTo: null, targeting: {},
    payoutModel: null, payout: null, revenueModel: null, revenue: null, goalId: null, firePartnerPostback: true, caps: {},
    throttleRate: null, conversionStatus: null, landingPageUrl: null, ...over,
  });
  const attrs = { country: 'US', device: 'desktop', os: null, browser: null };
  const resolved = { payout: '0.3000', revenue: '0.5000' };
  it('the payout model and Revenue Action decide; the rate is the click’s (impression’s) frozen rate', () => {
    expect(actionOfModel('CPC')).toBe('click');
    expect(actionOfModel('CPM')).toBe('impression');
    expect(actionOfModel('CPA')).toBe('conversion');
    expect(actionPricing({ payoutModel: 'CPC', revenue: { revenueAction: 'click' } }, 'p1', attrs, new Date(), resolved))
      .toEqual({ payout: { action: 'click', rate: '0.3000' }, revenue: { action: 'click', rate: '0.5000' } });
    expect(actionPricing({ payoutModel: 'CPA', revenue: { revenueAction: 'impression' } }, null, attrs, new Date(), resolved))
      .toEqual({ payout: { action: 'conversion', rate: null }, revenue: { action: 'impression', rate: '0.5000' } });
  });
  it('a partner’s own custom setting decides for that partner — its model and its amount', () => {
    const cpc = setting({ payoutModel: 'CPC', payout: '0.2500' });
    expect(actionPricing({ payoutModel: 'CPA', customSettings: [cpc] }, 'p1', attrs, new Date(), resolved).payout).toEqual({ action: 'click', rate: '0.2500' });
    expect(actionPricing({ payoutModel: 'CPA', customSettings: [cpc] }, 'p2', attrs, new Date(), resolved).payout).toEqual({ action: 'conversion', rate: null });
    const cpa = setting({ payoutModel: 'CPA', payout: '4.0000' });
    expect(actionPricing({ payoutModel: 'CPC', customSettings: [cpa] }, 'p1', attrs, new Date(), resolved).payout.action).toBe('conversion');
    // A goal's setting prices that goal's conversions — never the click.
    expect(actionPricing({ payoutModel: 'CPA', customSettings: [setting({ payoutModel: 'CPC', payout: '1.0000', goalId: 'g' })] }, 'p1', attrs, new Date(), resolved).payout.action).toBe('conversion');
  });
  it('billing rows are matched in SQL by their source', () => {
    expect(billingRowSql('c')).toBe("(c.source IN ('click', 'impression'))");
    expect(billingRowSql()).toBe("(source IN ('click', 'impression'))");
  });
});

describe('price per product', () => {
  const rules: ProductPrice[] = [
    { id: 'r-a1', sku: 'A1', category: null, payoutType: 'fixed', payoutValue: '5.0000', revenueType: 'percent', revenueValue: '20.0000' },
    { id: 'r-shoes', sku: null, category: 'shoes', payoutType: 'percent', payoutValue: '10.0000', revenueType: 'fixed', revenueValue: null },
  ];
  it('reads a JSON list, or one product from plain parameters (its sale amount when it has no price)', () => {
    expect(parseProductLines({ products: '[{"sku":"A1","price":"50","quantity":2},{"category":"shoes","amount":"30"},{"name":"no id"}]' }, null)).toEqual([
      { sku: 'A1', category: null, quantity: 2, amount: '100.0000' },
      { sku: null, category: 'shoes', quantity: 1, amount: '30.0000' },
    ]);
    expect(parseProductLines({ products: [{ product_id: 'B', qty: '3', unit_price: '1.5' }] }, null)).toEqual([{ sku: 'B', category: null, quantity: 3, amount: '4.5000' }]);
    expect(parseProductLines({ sku: 'A1', qty: '2' }, '40.00')).toEqual([{ sku: 'A1', category: null, quantity: 2, amount: '40.0000' }]);
    expect(parseProductLines({ products: 'not json' }, null)).toBeNull();
    expect(parseProductLines({ event: 'sale' }, '10')).toBeNull();
    // Nonsense quantities and prices don't break pricing: quantity 1, no amount.
    expect(parseProductLines({ products: [{ sku: 'X', quantity: '-4', price: '-2' }] }, null)).toEqual([{ sku: 'X', category: null, quantity: 1, amount: null }]);
  });
  it('prices by SKU, else category, else the base rate per unit (revenue by the offer’s Revenue Type)', () => {
    const lines = parseProductLines({ products: JSON.stringify([
      { sku: 'a1', price: '50', quantity: 2 }, { sku: 'S9', category: 'SHOES', price: '30', quantity: 1 }, { sku: 'Z', price: '10', quantity: 3 },
    ]) }, null)!;
    const p = priceProducts(lines, rules, { payout: '2.0000', revenue: '1.0000', revenueType: 'mixed', revenuePct: 10 });
    expect(p.lines.map((l) => [l.productId, l.payout, l.revenue])).toEqual([
      ['r-a1', '10.0000', '20.0000'],        // 5 × 2 · 20 % of 100
      ['r-shoes', '3.0000', '4.0000'],       // 10 % of 30 · mixed: 1 × 1 + 10 % of 30
      [null, '6.0000', '6.0000'],            // 2 × 3 · mixed: 1 × 3 + 10 % of 30
    ]);
    expect(p).toMatchObject({ payout: '19.0000', revenue: '30.0000', units: 6, total: '160.0000' });
    // A percentage rule on a line with no amount prices it at nothing; the total is then unknown.
    const blind = priceProducts([{ sku: 'X', category: 'shoes', quantity: 1, amount: null }], rules, { payout: null, revenue: null, revenueType: 'fixed', revenuePct: null });
    expect(blind).toMatchObject({ payout: '0.0000', revenue: null, total: null });
  });
});

describe('email ownership', () => {
  it('hashes the normalised address — or takes the advertiser’s hash — and nothing else', () => {
    const h = createHash('sha256').update('jane@example.com').digest('hex');
    expect(emailHashOf({ email: '  Jane@Example.COM ' })).toBe(h);
    expect(emailHashOf({ customer_email: ['jane@example.com'] })).toBe(h);
    expect(emailHashOf({ email_sha256: h.toUpperCase() })).toBe(h);
    expect(emailHashOf({ email: 'not-an-email' })).toBeNull();
    expect(emailHashOf({ email_hash: 'abc' })).toBeNull();
    expect(emailHashOf({})).toBeNull();
  });
});

describe('view-through cookies and direct-link origins', () => {
  it('parses the Cookie header; the cookie name is per offer', () => {
    expect(parseCookies('a=1; _trkvt_abc=def; a=2')).toEqual({ a: '1', _trkvt_abc: 'def' });
    expect(parseCookies(undefined)).toEqual({});
    expect(vtCookieName('12345678-aaaa-bbbb-cccc-1234567890ab')).toBe('_trkvt_12345678aaaabbbbcccc1234567890ab');
  });
  it('a direct-link click must come from the offer’s own site', () => {
    const offer = { destinationUrl: 'https://www.shop.example.com/lp?cid={click_id}', geoRules: [] };
    expect(sdkOrigin('https://www.shop.example.com', offer)).toBe('https://www.shop.example.com');
    expect(sdkOrigin('https://checkout.shop.example.com/thanks?x=1', offer)).toBe('https://checkout.shop.example.com');
    expect(sdkOrigin('https://evil.example.org', offer)).toBeNull();
    expect(sdkOrigin('javascript:alert(1)', offer)).toBeNull();
    expect(sdkOrigin(null, offer)).toBeNull();
  });
});

describe('24metrics', () => {
  it('the tracker ID must be a host-name label; a rejection becomes flags', () => {
    expect(validTrackerId('abc-123')).toBe(true);
    expect(validTrackerId('evil.com/x?')).toBe(false);
    expect(validTrackerId('')).toBe(false);
    expect(gatewayBase('abc-123')).toBe('https://abc-123.gateway.go2link.co');
    expect(gatewayBase('a.b')).toBeNull();
    expect(verdictFlags({ status: 'rejected', reason: 'VPN', transactionId: null })).toEqual(['24metrics', '24metrics:VPN']);
    expect(verdictFlags({ status: 'approved', reason: null, transactionId: 't' })).toEqual([]);
  });
});

describe('/sdk.js', () => {
  it('is valid JavaScript that defines window.trk', () => {
    expect(() => new Function(SDK_JS)).not.toThrow();
    expect(SDK_JS).toContain('window.trk = trk');
  });
});
