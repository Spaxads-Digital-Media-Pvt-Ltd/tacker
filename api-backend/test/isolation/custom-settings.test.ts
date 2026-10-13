/**
 * Offer Custom Settings runtime rules (audit F-12) — pure helpers, no DB: who a setting applies to,
 * targeting, effective windows, pricing models, goal scoping, and cap windows.
 */
import { describe, it, expect } from 'vitest';
import {
  applicableSettings, customPricing, priceFor, targetingMatches, capWindowStart, capBucket, capLimits,
  type CustomSettingConfig,
} from '../../src/lib/offer-settings/custom-settings.js';

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
  it('CPA (or none) is a fixed amount; CPS is a % of the sale; other models are not applied', () => {
    expect(priceFor('CPA', '9.0000', null)).toBe('9.0000');
    expect(priceFor(null, '9.0000', null)).toBe('9.0000');
    expect(priceFor('CPS', '10.0000', '200.0000')).toBe('20.0000');
    expect(priceFor('CPS_PPP', '12.5000', '80.0000')).toBe('10.0000');
    expect(priceFor('CPS', '10.0000', null)).toBeNull();
    for (const m of ['CPA_CPS', 'CPC', 'CPM', 'PRV']) expect(priceFor(m, '5.0000', '100.0000')).toBeNull();
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

  it('only positive limits count', () => {
    expect(capLimits({ clicks: { daily: 5, weekly: 0, global: 100 } }, 'clicks')).toEqual([['daily', 5], ['global', 100]]);
    expect(capLimits({}, 'payout')).toEqual([]);
  });
});
