/**
 * Offer settings that contradict each other (lib/offer-settings/warnings.ts) — what GET /api/offers/:id returns
 * as configWarnings. Pure.
 */
import { describe, it, expect } from 'vitest';
import { offerConfigWarnings, type WarningInput } from '../../src/lib/offer-settings/warnings.js';

const base: WarningInput = { status: 'active', visibility: 'public', approvedPartners: 0, allowedTrafficTypes: [], targeting: null, geoRules: [] };
const geo = (country: string, action = 'allow', region: string | null = null) => ({ country, region, action });

describe('offer config warnings', () => {
  it('a consistent offer has none', () => {
    expect(offerConfigWarnings(base)).toEqual([]);
    expect(offerConfigWarnings({ ...base, geoRules: [geo('US'), geo('IN')], targeting: { country: { mode: 'include', values: ['IN'] } } })).toEqual([]);
  });

  it('GEO allows US, CA but Targeting includes only IN — nothing gets through', () => {
    const w = offerConfigWarnings({ ...base, geoRules: [geo('US'), geo('CA')], targeting: { country: { mode: 'include', values: ['IN'] } } });
    expect(w).toEqual(['No country can get through: Offer › GEO allows only CA, US, but Targeting › Country includes only IN.']); // sorted
  });

  it('Targeting includes only countries GEO blocks; Targeting excludes every allowed country; "*" deny alone', () => {
    expect(offerConfigWarnings({ ...base, geoRules: [geo('IN', 'deny')], targeting: { country: { mode: 'include', values: ['in'] } } })[0]).toMatch(/includes only IN, which Offer › GEO blocks/);
    expect(offerConfigWarnings({ ...base, geoRules: [geo('US')], targeting: { country: { mode: 'exclude', values: ['US'] } } })[0]).toMatch(/excludes them all/);
    expect(offerConfigWarnings({ ...base, geoRules: [geo('*', 'deny')] })).toContain('Offer › GEO blocks every country ("*" deny) and allows none.');
  });

  it('a region deny doesn’t block the whole country', () => {
    expect(offerConfigWarnings({ ...base, geoRules: [geo('US', 'deny', 'CA')], targeting: { country: { mode: 'include', values: ['US'] } } })).toEqual([]);
  });

  it('devices vs OS, a private offer nobody may run, a paused offer', () => {
    expect(offerConfigWarnings({ ...base, allowedTrafficTypes: ['desktop'], targeting: { platform: { mode: 'include', values: ['iOS', 'Android'] } } })[0]).toMatch(/desktop only/);
    expect(offerConfigWarnings({ ...base, allowedTrafficTypes: ['mobile'], targeting: { platform: { mode: 'include', values: ['Windows'] } } })[0]).toMatch(/mobile only/);
    expect(offerConfigWarnings({ ...base, visibility: 'private' })[0]).toMatch(/No partner is approved/);
    expect(offerConfigWarnings({ ...base, visibility: 'private', approvedPartners: 2 })).toEqual([]);
    expect(offerConfigWarnings({ ...base, status: 'paused' })[0]).toMatch(/paused/);
  });
});
