/**
 * Offers end to end — the CLICK side (INTEGRATION_DB=1): every offer setting is saved through the dashboard
 * API (as the UI does) and checked by real clicks through /click and /sl, with the real GeoIP code on MaxMind's
 * test databases and the real click-persist worker. A saved-but-not-enforced setting fails here.
 *
 * Covered: offer status and fallbacks · partner status, visibility, access · GEO allow / block lists, '*',
 * unknown country, region rules (code or name), per-country payout / revenue / landing page, the dev override,
 * Cloudflare's country · smart links by country · device types · targeting (OS, OS version, browser, brand,
 * language, country, region, city, zip, DMA, ISP, carrier, IP, IP range) · traffic controls (block, fail,
 * whitelist) · traffic blocking · IP blacklist · fraud block score · click caps (offer, partner) · unique clicks
 * · server-side clicks · partner landing page / payout · macro encoding.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { canConnect } from '../helpers/db.js';
import { startLab, UA, IP, CLOUDFLARE_EDGE, type Lab } from '../helpers/offer-e2e.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

const ATTRIBUTION = {
  tracker24: { enabled: false, trackerId: null }, ipqs: { enabled: false }, throttle: { enabled: false, ratePct: 0 },
  clickToConversion: { enabled: false, minSeconds: 0, maxSeconds: null }, emailOwnership: false, viewThrough: false, serverSideClick: false,
};

d('offers end to end — clicks (live DB + GeoIP test data)', () => {
  let lab: Lab;
  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    lab = await startLab('e2ec');
  });
  afterAll(async () => { await lab?.close(); });

  describe('status, partners, visibility', () => {
    it('an active offer sends the visitor on with every macro filled and records the click', async () => {
      const o = await lab.offer();
      const r = await lab.click(o.id, { ip: IP.US_WA, ua: UA.iphone, qs: 'sub1=abc' });
      expect(r.status).toBe(302);
      const u = new URL(r.location!);
      expect(u.origin + u.pathname).toBe('https://adv.example.com/lp');
      expect(Object.fromEntries(u.searchParams)).toMatchObject({ s1: 'abc', o: o.id, p: lab.fx.pubA1, c: 'US', d: 'mobile' });
      expect(r.clickId).toMatch(/^[0-9a-f]{32}$/);
      expect(r.row).toMatchObject({ click_id: r.clickId, country: 'US', region: 'WA', city: 'Milton', device: 'mobile', is_unique: true, payout: '5.0000', revenue: '8.0000', fraud_flags: [] });
    });

    it('paused / draft / archived offers reject the click → the offer’s fallback, else the network’s, else 204', async () => {
      for (const status of ['paused', 'draft', 'archived']) {
        const o = await lab.offer({ status, fallbackUrl: 'https://fallback.example.com/offer' });
        const r = await lab.click(o.id, { ip: IP.US_WA });
        expect(r.reason, status).toBe('offer_not_active');
        expect(r.location).toBe('https://fallback.example.com/offer');
      }
      const bare = await lab.offer({ status: 'paused' });
      expect((await lab.click(bare.id, { ip: IP.US_WA })).status).toBe(204);
      await lab.api('put', '/settings/general', { fallbackUrl: 'https://fallback.example.com/network' });
      try {
        const r = await lab.click(bare.id, { ip: IP.US_WA });
        expect(r.location).toBe('https://fallback.example.com/network');
      } finally {
        await lab.api('put', '/settings/general', { fallbackUrl: null });
      }
    });

    it('only an active partner of the network runs traffic: pending, inactive, unknown are rejected', async () => {
      const o = await lab.offer();
      expect((await lab.click(o.id, { pub: await lab.partner('pending'), ip: IP.US_WA })).reason).toBe('partner_pending');
      expect((await lab.click(o.id, { pub: await lab.partner('inactive'), ip: IP.US_WA })).reason).toBe('partner_inactive');
      expect((await lab.click(o.id, { pub: '00000000-0000-4000-a000-0000000000ff', ip: IP.US_WA })).reason).toBe('unknown_partner');
      expect((await lab.click(o.id, { pub: lab.fx.pubB1, ip: IP.US_WA })).reason).toBe('unknown_partner'); // another network's partner
    });

    it('private and "ask" offers run only for approved partners; a denied partner is blocked', async () => {
      for (const visibility of ['private', 'ask']) {
        const o = await lab.offer({ visibility }, { approve: [lab.fx.pubA1] });
        expect((await lab.click(o.id, { ip: IP.US_WA })).status, visibility).toBe(302);
        expect((await lab.click(o.id, { pub: lab.fx.pubA2, ip: IP.US_WA })).reason, visibility).toBe('partner_not_approved');
      }
      const o = await lab.offer();
      await lab.api('post', `/offers/${o.id}/publishers`, { publisherId: lab.fx.pubA2, access: 'deny' });
      expect((await lab.click(o.id, { pub: lab.fx.pubA2, ip: IP.US_WA })).reason).toBe('partner_blocked');
      expect((await lab.click(o.id, { ip: IP.US_WA })).status).toBe(302);
    });
  });

  describe('GEO rules (Offer › GEO)', () => {
    it('an allow-list lets only its countries through — an unknown country is not on it', async () => {
      const o = await lab.offer({}, { geo: [{ country: 'US' }, { country: 'SE' }] });
      expect((await lab.click(o.id, { ip: IP.US_WA })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.SE })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.GB_LONDON })).reason).toBe('geo_not_allowed');
      expect((await lab.click(o.id, { ip: IP.JP })).reason).toBe('geo_not_allowed'); // IPv6
      expect((await lab.click(o.id, { ip: IP.UNKNOWN })).reason).toBe('geo_not_allowed');
    });

    it('a block-list stops its countries and lets the rest (and unknown) through', async () => {
      const o = await lab.offer({}, { geo: [{ country: 'CN', action: 'deny' }, { country: 'PH', action: 'deny' }] });
      expect((await lab.click(o.id, { ip: IP.CN })).reason).toBe('geo_not_allowed');
      expect((await lab.click(o.id, { ip: IP.PH })).reason).toBe('geo_not_allowed');
      expect((await lab.click(o.id, { ip: IP.SE })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.UNKNOWN })).status).toBe(302);
    });

    it('"*" sets the default for every other country', async () => {
      const o = await lab.offer({}, { geo: [{ country: '*', action: 'deny' }, { country: 'GB' }] });
      expect((await lab.click(o.id, { ip: IP.GB_LONDON })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.US_WA })).reason).toBe('geo_not_allowed');
    });

    it('region rules: the most specific rule wins, by ISO code ("WA", "US-WA") or by name ("England")', async () => {
      const wa = await lab.offer({}, { geo: [{ country: 'US', region: 'US-WA' }] });
      expect((await lab.click(wa.id, { ip: IP.US_WA })).status).toBe(302);
      expect((await lab.click(wa.id, { ip: IP.US_MOBILE })).reason).toBe('geo_not_allowed'); // US, region unknown
      const england = await lab.offer({}, { geo: [{ country: 'GB' }, { country: 'GB', region: 'England', action: 'deny' }, { country: 'SE', region: 'E', payoutOverride: '1.10' }] });
      expect((await lab.click(england.id, { ip: IP.GB_LONDON })).reason).toBe('geo_not_allowed');
      const se = await lab.click(england.id, { ip: IP.SE });
      expect(se.status).toBe(302);
      expect(se.row).toMatchObject({ region: 'E', payout: '1.1000' });
    });

    it('a country rule’s payout, revenue and landing page apply to that country only', async () => {
      const o = await lab.offer({}, { geo: [
        { country: 'GB', payoutOverride: '2.00', revenueOverride: '3.00', destinationOverride: 'https://gb.adv.example.com/?cid={click_id}&c={country}' },
        { country: 'US' },
      ] });
      const gb = await lab.click(o.id, { ip: IP.GB_LONDON });
      expect(gb.location).toMatch(/^https:\/\/gb\.adv\.example\.com\/\?cid=[0-9a-f]{32}&c=GB$/);
      expect(gb.row).toMatchObject({ payout: '2.0000', revenue: '3.0000' });
      const us = await lab.click(o.id, { ip: IP.US_WA });
      expect(us.location).toMatch(/^https:\/\/adv\.example\.com\/lp/);
      expect(us.row).toMatchObject({ payout: '5.0000', revenue: '8.0000' });
    });

    it('the dev override geo=XX / geo=XX-RR stands in for the visitor’s country (never in production)', async () => {
      const o = await lab.offer({}, { geo: [{ country: 'GB', region: 'SCT' }] });
      expect((await lab.click(o.id, { ip: IP.US_WA, qs: 'geo=GB-SCT' })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.US_WA, qs: 'geo=GB' })).reason).toBe('geo_not_allowed'); // region unknown
      expect((await lab.click(o.id, { ip: IP.GB_LONDON })).reason).toBe('geo_not_allowed'); // ENG, not SCT
    });

    it('behind Cloudflare, CF-IPCountry gives the country when the database can’t — only from Cloudflare’s edge', async () => {
      const o = await lab.offer({}, { geo: [{ country: 'GB' }] });
      const viaCf = await lab.click(o.id, { ip: IP.UNKNOWN, remote: CLOUDFLARE_EDGE, cf: 'GB' });
      expect(viaCf.status).toBe(302);
      expect(viaCf.row).toMatchObject({ country: 'GB' });
      expect((await lab.click(o.id, { ip: IP.UNKNOWN, cf: 'GB' })).reason).toBe('geo_not_allowed'); // not from Cloudflare: ignored
      expect((await lab.click(o.id, { ip: IP.UNKNOWN, remote: CLOUDFLARE_EDGE, cf: 'T1' })).reason).toBe('geo_not_allowed'); // Tor
    });

    it('GEO rules and Targeting countries that exclude each other: the API warns, and indeed no click gets through', async () => {
      const o = await lab.offer({ targeting: { country: { mode: 'include', values: ['IN'] } } }, { geo: [{ country: 'US' }, { country: 'CA' }] });
      const detail = await lab.api<{ configWarnings: string[] }>('get', `/offers/${o.id}`);
      expect(detail.configWarnings).toEqual(['No country can get through: Offer › GEO allows only CA, US, but Targeting › Country includes only IN.']);
      expect((await lab.click(o.id, { ip: IP.US_WA })).reason).toBe('targeting_not_matched');
      expect((await lab.click(o.id, { ip: IP.GB_LONDON })).reason).toBe('geo_not_allowed');
      expect((await lab.api<{ configWarnings: string[] }>('get', `/offers/${(await lab.offer()).id}`)).configWarnings).toEqual([]);
    });

    it('a smart link sends each country to an offer that allows it', async () => {
      const us = await lab.offer({}, { geo: [{ country: 'US' }] });
      const gb = await lab.offer({}, { geo: [{ country: 'GB' }] });
      const link = await lab.api<{ id: string }>('post', '/smart-links', { name: 'E2E by country', redirectMechanism: 'weight', items: [{ offerId: us.id, weight: 1 }, { offerId: gb.id, weight: 1 }] });
      for (const [ip, want] of [[IP.GB_LONDON, gb.id], [IP.US_WA, us.id], [IP.GB_BOXFORD, gb.id], [IP.US_WA, us.id]] as const) {
        const hop = await lab.click(link.id, { path: '/sl', ip, noRow: true });
        expect(hop.status).toBe(302);
        expect(new URL(hop.location!, 'http://x').searchParams.get('offer_id'), ip).toBe(want);
      }
      const none = await lab.click(link.id, { path: '/sl', ip: IP.JP, noRow: true });
      expect(none.status).toBe(204); // no offer allows JP and there is no catch-all
    });
  });

  describe('devices and targeting (Edit Offer › Targeting)', () => {
    it('allowed device types', async () => {
      const o = await lab.offer({ allowedTrafficTypes: ['mobile'] });
      expect((await lab.click(o.id, { ip: IP.US_WA, ua: UA.iphone })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.US_WA, ua: UA.ipad })).reason).toBe('device_not_allowed');
      expect((await lab.click(o.id, { ip: IP.US_WA, ua: UA.windows })).reason).toBe('device_not_allowed');
    });

    const cases: { name: string; targeting: Record<string, unknown>; pass: Record<string, unknown>; fail: Record<string, unknown>[] }[] = [
      { name: 'OS', targeting: { platform: { mode: 'include', values: ['iOS', 'Android'] } }, pass: { ua: UA.android }, fail: [{ ua: UA.windows }, { ua: UA.mac }] },
      { name: 'OS version', targeting: { platform: { mode: 'include', values: ['iOS'] }, osVersion: { mode: 'include', values: ['17'] } }, pass: { ua: UA.iphone }, fail: [{ ua: UA.android }] },
      { name: 'browser (exclude)', targeting: { browser: { mode: 'exclude', values: ['Firefox'] } }, pass: { ua: UA.windows }, fail: [{ ua: UA.firefox }] },
      { name: 'device brand', targeting: { deviceBrand: { mode: 'include', values: ['Samsung'] } }, pass: { ua: UA.android }, fail: [{ ua: UA.iphone }] },
      { name: 'language', targeting: { language: { mode: 'include', values: ['en'] } }, pass: { lang: 'en-US,en;q=0.9' }, fail: [{ lang: 'fr-FR' }, {}] },
      { name: 'country', targeting: { country: { mode: 'include', values: ['GB'] } }, pass: { ip: IP.GB_LONDON }, fail: [{ ip: IP.US_WA }, { ip: IP.UNKNOWN }] },
      { name: 'country (exclude)', targeting: { country: { mode: 'exclude', values: ['CN'] } }, pass: { ip: IP.SE }, fail: [{ ip: IP.CN }] },
      { name: 'region', targeting: { region: { mode: 'include', values: ['US-WA'] } }, pass: { ip: IP.US_WA }, fail: [{ ip: IP.GB_LONDON }] },
      { name: 'city', targeting: { city: { mode: 'include', values: ['London'] } }, pass: { ip: IP.GB_LONDON }, fail: [{ ip: IP.GB_BOXFORD }] },
      { name: 'zip', targeting: { country: { mode: 'include', values: ['US'] }, zip: { mode: 'include', values: ['98354'] } }, pass: { ip: IP.US_WA }, fail: [{ ip: IP.US_MOBILE }] },
      { name: 'DMA', targeting: { dma: { mode: 'include', values: ['819'] } }, pass: { ip: IP.US_WA }, fail: [{ ip: IP.GB_LONDON }] },
      { name: 'ISP', targeting: { isp: { mode: 'include', values: ['Century'] } }, pass: { ip: IP.US_WA }, fail: [{ ip: IP.SE }] },
      { name: 'mobile carrier', targeting: { mobileCarrier: { mode: 'include', values: ['Verizon Wireless'] } }, pass: { ip: IP.US_MOBILE }, fail: [{ ip: IP.US_WA }] },
      { name: 'IP exact', targeting: { ipExact: { mode: 'include', values: [IP.US_WA] } }, pass: { ip: IP.US_WA }, fail: [{ ip: IP.SE }] },
      { name: 'IP range (exclude)', targeting: { ipRange: { mode: 'exclude', values: ['175.16.199.0/24'] } }, pass: { ip: IP.SE }, fail: [{ ip: IP.CN }] },
    ];
    for (const c of cases) {
      it(`targeting: ${c.name}`, async () => {
        const o = await lab.offer({ targeting: c.targeting });
        const ok = await lab.click(o.id, { ip: IP.US_WA, ...c.pass });
        expect(ok.status, `${c.name} pass`).toBe(302);
        for (const f of c.fail) expect((await lab.click(o.id, { ip: IP.US_WA, ...f })).reason, `${c.name} fail ${JSON.stringify(f)}`).toBe('targeting_not_matched');
      });
    }
  });

  describe('blocking and fraud', () => {
    it('traffic controls: block, fail-traffic (passes, flagged) and whitelist', async () => {
      const o = await lab.offer();
      await lab.api('post', '/traffic-controls', { name: 'E2E block spam', offerScope: 'offers', offerIds: [o.id], action: 'block', variables: ['sub1'], comparisonMethod: 'contains', values: ['spam'] });
      await lab.api('post', '/traffic-controls', { name: 'E2E fail test', offerScope: 'offers', offerIds: [o.id], action: 'fail_traffic', variables: ['sub2'], comparisonMethod: 'exact_match', values: ['tester'] });
      expect((await lab.click(o.id, { ip: IP.US_WA, qs: 'sub1=big-spam-site' })).reason).toBe('traffic_control_blocked');
      const failed = await lab.click(o.id, { ip: IP.US_WA, qs: 'sub2=tester' });
      expect(failed.status).toBe(302);
      expect(failed.row!['fraud_flags']).toContain('traffic_control');
      expect((await lab.click(o.id, { ip: IP.US_WA, qs: 'sub1=clean' })).status).toBe(302);
      const w = await lab.offer();
      await lab.api('post', '/traffic-controls', { name: 'E2E only GB', controlType: 'whitelist', offerScope: 'offers', offerIds: [w.id], action: 'block', variables: ['country'], comparisonMethod: 'exact_match', values: ['GB'] });
      expect((await lab.click(w.id, { ip: IP.GB_LONDON })).status).toBe(302);
      expect((await lab.click(w.id, { ip: IP.US_WA })).reason).toBe('traffic_control_blocked');
    });

    it('traffic blocking (partner + offer, by sub placement)', async () => {
      const o = await lab.offer();
      await lab.api('post', '/traffic-blocking', { publisherId: lab.fx.pubA1, offerId: o.id, filters: { sub2: { matchType: 'exact_match', value: 'placement-9' } } });
      expect((await lab.click(o.id, { ip: IP.US_WA, qs: 'sub2=placement-9' })).reason).toBe('traffic_blocked');
      expect((await lab.click(o.id, { ip: IP.US_WA, qs: 'sub2=placement-1' })).status).toBe(302);
    });

    it('the network IP blacklist', async () => {
      const o = await lab.offer();
      await lab.api('put', '/control-center/ip-blacklist', { ranges: [{ from: IP.PH }] });
      try {
        expect((await lab.click(o.id, { ip: IP.PH })).reason).toBe('ip_blacklisted');
        expect((await lab.click(o.id, { ip: IP.SE })).status).toBe(302);
      } finally {
        await lab.api('put', '/control-center/ip-blacklist', { ranges: [] });
      }
    });

    it('fraud: a bot user agent is flagged; with a block score it is rejected', async () => {
      const o = await lab.offer();
      const flagged = await lab.click(o.id, { ip: IP.SE, ua: UA.bot });
      expect(flagged.status).toBe(302);
      expect(flagged.row!['fraud_flags']).toContain('bot_user_agent');
      await lab.api('put', '/fraud-rules', { blockScore: 50 });
      try {
        expect((await lab.click(o.id, { ip: IP.SE, ua: UA.bot })).reason).toBe('fraud_blocked');
        expect((await lab.click(o.id, { ip: IP.SE, ua: UA.windows })).status).toBe(302);
      } finally {
        await lab.api('put', '/fraud-rules', { blockScore: null });
      }
    });
  });

  describe('caps, uniqueness, server-side clicks, partner overrides', () => {
    it('a daily click cap stops the next click', async () => {
      const o = await lab.offer({ dailyClickCap: 2 });
      expect((await lab.click(o.id, { ip: IP.US_WA })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.SE })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.GB_LONDON })).reason).toBe('cap_exceeded');
    });

    it('a partner’s own click cap (Offer Custom Settings › Caps) stops only that partner', async () => {
      const o = await lab.offer();
      await lab.api('post', '/offer-custom-settings', { category: 'caps', offerId: o.id, partnerId: lab.fx.pubA1, capType: 'clicks', capInterval: 'daily', capValue: 1, status: 'active' });
      expect((await lab.click(o.id, { ip: IP.US_WA })).status).toBe(302);
      expect((await lab.click(o.id, { ip: IP.SE })).reason).toBe('partner_cap_exceeded');
      const other = await lab.partner('active');
      expect((await lab.click(o.id, { pub: other, ip: IP.SE })).status).toBe(302);
    });

    it('the same visitor twice is one unique click', async () => {
      const o = await lab.offer();
      const a = await lab.click(o.id, { ip: IP.GB_BOXFORD, ua: UA.mac });
      const b = await lab.click(o.id, { ip: IP.GB_BOXFORD, ua: UA.mac });
      const c = await lab.click(o.id, { ip: IP.SE, ua: UA.mac });
      expect([a.row!['is_unique'], b.row!['is_unique'], c.row!['is_unique']]).toEqual([true, false, true]);
    });

    it('a server-side click answers JSON and is judged on the visitor’s IP and browser', async () => {
      const o = await lab.offer({ attributionSettings: { ...ATTRIBUTION, serverSideClick: true } }, { geo: [{ country: 'GB' }] });
      const ok = await lab.click(o.id, { ip: IP.US_WA, qs: `format=json&ip=${IP.GB_LONDON}&ua=${encodeURIComponent(UA.android)}` });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({ ok: true, data: { click_id: expect.stringMatching(/^[0-9a-f]{32}$/), redirect_url: expect.stringContaining('adv.example.com') } });
      expect(ok.row).toMatchObject({ country: 'GB', device: 'mobile', ip: IP.GB_LONDON });
      const no = await lab.click(o.id, { ip: IP.GB_LONDON, qs: `format=json&ip=${IP.US_WA}` });
      expect(no.reason).toBe('geo_not_allowed'); // the visitor is in the US, whoever's server asks
    });

    it('a partner’s landing page and payout (Offer Custom Settings) and access payout override', async () => {
      const o = await lab.offer();
      await lab.api('post', '/offer-custom-settings', { category: 'landing_pages', offerId: o.id, partnerId: lab.fx.pubA1, landingPageUrl: 'https://lp-a1.adv.example.com/?cid={click_id}', status: 'active' });
      await lab.api('post', '/offer-custom-settings', { category: 'revenue_payout', offerId: o.id, partnerId: lab.fx.pubA2, applyCustomPayout: true, payoutModel: 'CPA', payoutValue: '7.00', status: 'active' });
      const a1 = await lab.click(o.id, { ip: IP.US_WA });
      expect(a1.location).toMatch(/^https:\/\/lp-a1\.adv\.example\.com\/\?cid=[0-9a-f]{32}$/);
      const a2 = await lab.click(o.id, { pub: lab.fx.pubA2, ip: IP.US_WA });
      expect(a2.location).toMatch(/^https:\/\/adv\.example\.com\/lp/);
      const p3 = await lab.partner('active');
      const priced = await lab.offer();
      await lab.api('post', `/offers/${priced.id}/publishers`, { publisherId: p3, access: 'allow', approvalStatus: 'approved', payoutOverride: '6.50' });
      expect((await lab.click(priced.id, { pub: p3, ip: IP.US_WA })).row).toMatchObject({ payout: '6.5000' });
    });

    it('macros are URL-encoded', async () => {
      const o = await lab.offer();
      const r = await lab.click(o.id, { ip: IP.US_WA, qs: `sub1=${encodeURIComponent('a b&c=d/é')}` });
      expect(new URL(r.location!).searchParams.get('s1')).toBe('a b&c=d/é');
      expect(r.location).not.toContain('a b&c');
    });
  });
});
