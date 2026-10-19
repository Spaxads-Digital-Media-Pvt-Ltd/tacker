/**
 * Offer Custom Settings runtime rules (audit F-12) — pure helpers, no DB: who a setting applies to,
 * targeting, effective windows, pricing models, goal scoping, and cap windows.
 */
import { describe, it, expect } from 'vitest';
import {
  applicableSettings, customPricing, priceFor, targetingMatches, capWindowStart, capBucket, capLimits, capTimeZoneOf,
  type CustomSettingConfig,
} from '../../src/lib/offer-settings/custom-settings.js';
import { dayStamp } from '../../src/surfaces/tracking/caps.js';

const PUB = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const at = new Date('2026-10-14T12:00:00Z'); // a Wednesday
const attrs = { country: 'US', device: 'mobile', os: 'iOS', browser: 'Safari' };

function setting(over: Partial<CustomSettingConfig>): CustomSettingConfig {
  return {
    id: over.id ?? 's', category: 'revenue_payout', allPartners: false, partnerIds: [PUB],
    effectiveFrom: null, effectiveTo: null, targeting: {}, payoutModel: 'CPA', payout: null, revenueModel: 'CPA', revenue: null,
    goalId: null, firePartnerPostback: true, caps: {}, throttleRate: null, conversionStatus: null, landingPageUrl: null,
    ...over,
  };
}

describe('who a setting applies to', () => {
  it('partner scope, effective window and targeting all have to match; partner-specific beats all-partners', () => {
    const all = setting({ id: 'all', allPartners: true, partnerIds: [] });
    const mine = setting({ id: 'mine' });
    const theirs = setting({ id: 'theirs', partnerIds: [OTHER] });
    const later = setting({ id: 'later', effectiveFrom: '2026-11-01T00:00:00Z' });
    const ended = setting({ id: 'ended', effectiveTo: '2026-10-01T00:00:00Z' });
    const caOnly = setting({ id: 'ca', targeting: { countries: ['CA'] } });
    const usMobile = setting({ id: 'usm', targeting: { countries: ['us'], devices: ['MOBILE'] } });
    const ids = applicableSettings([all, mine, theirs, later, ended, caOnly, usMobile], 'revenue_payout', PUB, attrs, at).map((s) => s.id);
    expect(ids).toEqual(['mine', 'usm', 'all']);
  });

  it('a targeting list never matches an unknown attribute', () => {
    expect(targetingMatches({ countries: ['US'] }, { ...attrs, country: null })).toBe(false);
    expect(targetingMatches({}, { country: null, device: null, os: null, browser: null })).toBe(true);
  });
});

describe('pricing models', () => {
  it('CPA (or none) is a fixed amount; CPS is a % of the sale; PRV a % of the revenue; _PPP per unit / products total', () => {
    const sale = (saleAmount: string | null) => ({ saleAmount });
    expect(priceFor('CPA', '9.0000', sale(null))).toBe('9.0000');
    expect(priceFor(null, '9.0000', sale(null))).toBe('9.0000');
    expect(priceFor('CPS', '10.0000', sale('200.0000'))).toBe('20.0000');
    expect(priceFor('CPS_PPP', '12.5000', sale('80.0000'))).toBe('10.0000');
    expect(priceFor('CPS', '10.0000', sale(null))).toBeNull();
    // Price per product: CPA per unit sold; without product lines, per conversion.
    expect(priceFor('CPA_PPP', '2.5000', { saleAmount: null, units: 3 })).toBe('7.5000');
    expect(priceFor('CPA_PPP', '2.5000', sale(null))).toBe('2.5000');
    // PRV: the payout is a share of the conversion's revenue — never a revenue model.
    expect(priceFor('PRV', '40', { saleAmount: null, revenue: '25.0000' })).toBe('10.0000');
    expect(priceFor('PRV', '40', { saleAmount: null, revenue: '25.0000' }, 'revenue')).toBeNull();
    expect(priceFor('PRV', '40', sale(null))).toBeNull();
    // Clicks / impressions are priced elsewhere (billing.ts); a mixed model needs two amounts.
    for (const m of ['CPA_CPS', 'CPC', 'CPM']) expect(priceFor(m, '5.0000', sale('100.0000'))).toBeNull();
  });

  it('a goal-scoped setting prices only that goal; an unscoped one prices the base conversion', () => {
    const base = setting({ id: 'base', payout: '9.0000' });
    const upsell = setting({ id: 'up', goalId: 'g-up', payout: '6.0000', revenue: '11.0000', firePartnerPostback: false });
    const args = { publisherId: PUB, attrs, clickAt: at, defaultGoalId: 'g-default', saleAmount: null };
    expect(customPricing([base, upsell], { ...args, eventGoalId: null })).toMatchObject({ payout: '9.0000', revenue: null, firePartnerPostback: true, settingIds: ['base'] });
    expect(customPricing([base, upsell], { ...args, eventGoalId: 'g-up' })).toMatchObject({ payout: '6.0000', revenue: '11.0000', firePartnerPostback: false });
    expect(customPricing([base], { ...args, eventGoalId: 'g-other' })).toBeNull();
    expect(customPricing([base], { ...args, publisherId: OTHER, eventGoalId: null })).toBeNull();
  });

  it('payout and revenue can come from different settings; the first that prices each wins', () => {
    const a = setting({ id: 'a', payout: '1.0000' });
    const b = setting({ id: 'b', payout: '2.0000', revenue: '3.0000' });
    expect(customPricing([a, b], { publisherId: PUB, attrs, clickAt: at, eventGoalId: null, defaultGoalId: null, saleAmount: null }))
      .toMatchObject({ payout: '1.0000', revenue: '3.0000', settingIds: ['a', 'b'] });
  });
});

describe('cap windows (UTC)', () => {
  it('day, ISO week from Monday, month, all time', () => {
    expect(capWindowStart('daily', at)?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(capWindowStart('weekly', at)?.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(capWindowStart('weekly', new Date('2026-10-18T23:00:00Z'))?.toISOString()).toBe('2026-10-12T00:00:00.000Z'); // Sunday
    expect(capWindowStart('monthly', at)?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(capWindowStart('global', at)).toBeNull();
    expect(capBucket('weekly', at)).toEqual({ bucket: 'weekly:20261012', ttl: 8 * 86400 });
    expect(capBucket('global', at)).toEqual({ bucket: 'all', ttl: 0 });
  });

  it('in a cap time zone: local midnight, the local ISO week and month (DST-safe); the bucket is the local start date', () => {
    // 2026-10-14T20:00Z = 15 Oct 01:30 in Kolkata (UTC+05:30) → its day began 14 Oct 18:30Z.
    const late = new Date('2026-10-14T20:00:00Z');
    expect(capWindowStart('daily', late, 'Asia/Kolkata')?.toISOString()).toBe('2026-10-14T18:30:00.000Z');
    expect(capBucket('daily', late, 'Asia/Kolkata')).toEqual({ bucket: 'daily:20261015', ttl: 2 * 86400 });
    expect(capBucket('daily', late)).toEqual({ bucket: 'daily:20261014', ttl: 2 * 86400 }); // UTC: still the 14th
    // Sunday 18 Oct 23:00 in New York is Monday 19 Oct 03:00Z — still the week of Mon 12 Oct there.
    expect(capWindowStart('weekly', new Date('2026-10-19T03:00:00Z'), 'America/New_York')?.toISOString()).toBe('2026-10-12T04:00:00.000Z');
    expect(capWindowStart('monthly', new Date('2026-11-01T02:00:00Z'), 'America/Los_Angeles')?.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    // A day that starts after a DST change: New York left DST on 1 Nov 2026, so 2 Nov starts at 05:00Z.
    expect(capWindowStart('daily', new Date('2026-11-02T12:00:00Z'), 'America/New_York')?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(capWindowStart('global', late, 'Asia/Kolkata')).toBeNull();
  });

  it('the cap time zone: the offer’s, else the network’s, else UTC — an invalid value is skipped', () => {
    expect(capTimeZoneOf('America/New_York', 'Asia/Kolkata')).toBe('America/New_York');
    expect(capTimeZoneOf(null, 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(capTimeZoneOf(undefined, undefined)).toBe('UTC');
    expect(capTimeZoneOf('Mars/Olympus', 'Not/AZone')).toBe('UTC');
  });

  it('the click cap key is stamped with the local day', () => {
    expect(dayStamp(new Date('2026-10-14T20:00:00Z'))).toBe('20261014');
    expect(dayStamp(new Date('2026-10-14T20:00:00Z'), 'Asia/Kolkata')).toBe('20261015');
  });

  it('only positive limits count', () => {
    expect(capLimits({ clicks: { daily: 5, weekly: 0, global: 100 } }, 'clicks')).toEqual([['daily', 5], ['global', 100]]);
    expect(capLimits({}, 'payout')).toEqual([]);
  });
});
