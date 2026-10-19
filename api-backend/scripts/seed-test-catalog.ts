/**
 * A test catalog for trying the tracker end to end — clicks, rejections, conversions, partner postbacks — on
 * YOUR network (the one your .env database holds), created through the dashboard's own API as the network's
 * admin, so every value is validated exactly like the UI and caches are busted:
 *
 *   • 5 advertisers (one in EUR) and 5 partners (one pending → its clicks are rejected), each partner with a
 *     different postback set-up (all conversions, one event only, one offer only, POST, none)
 *   • 15 offers covering the settings worth testing: CPA / CPL / CPI / RevShare / CPS, GEO allow-lists with
 *     per-country payouts and a country landing page, a block-list, mobile- or desktop-only, multi-event goals
 *     (lead → purchase), private (approved partner only) and "ask" visibility, daily click / conversion caps,
 *     duplicate rules, manual approval, paused and draft, a fallback URL, and a debug offer that echoes every
 *     macro (httpbin.org) — landing pages on public sites (Google, YouTube, Instagram, Facebook, Amazon…)
 *     carry the click id in the address bar so you can copy it into a postback
 *   • a partner revenue share (CPS 25 % of the sale) through Offer Custom Settings
 *   • deep links on the Amazon offer and a coupon code TEST10 (Alpha) for clickless conversions
 *   • CPC (paid per click), CPM with view-through (impressions), email ownership (rebills without a click),
 *     price per product (SKU / category rules) and direct linking (the JavaScript tag) offers
 *   • localhost / 127.0.0.1 as tracking domains, so http://localhost:4002/click works
 *
 * Re-running is safe: anything that already exists (by name) is kept, not duplicated. Names end in "(test)".
 * It needs SUPABASE_JWT_SECRET (Supabase › Project Settings › JWT Keys › legacy secret) to sign in as the admin.
 *
 * Usage:  npm run seed:test-catalog [-- <network-slug>]        (default: test)
 */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { env } from '../src/config/env.js';
import { query, closeDb } from '../src/lib/db/pool.js';
import { getRedis } from '../src/lib/redis.js';
import { buildDashboardApp } from '../src/surfaces/dashboard/app.js';

type Json = Record<string, unknown>;
const slug = process.argv[2] ?? 'test';

const ADVERTISERS = [
  { name: 'Google Ads (test)', defaultCurrency: 'USD', contactEmail: 'ads-google@example.com' },
  { name: 'Meta (test)', defaultCurrency: 'USD', contactEmail: 'ads-meta@example.com' },
  { name: 'YouTube (test)', defaultCurrency: 'USD', contactEmail: 'ads-youtube@example.com' },
  { name: 'Amazon Shopping (test)', defaultCurrency: 'USD', contactEmail: 'ads-amazon@example.com' },
  { name: 'Booking EU (test)', defaultCurrency: 'EUR', contactEmail: 'ads-booking@example.com' },
] as const;

// Partner postbacks go to httpbin.org (it answers 200 and echoes what it got) — see each delivery under
// Reports › Partner Postback. Swap in your own tracker's postback URL to test for real.
const PARTNERS = [
  { name: 'Alpha Media (test)', status: 'active', trafficSource: 'Search', country: 'US',
    postbacks: [{ url: 'https://httpbin.org/get?network=alpha&click={sub1}&our_click={click_id}&payout={payout}&event={event}&txn={txn_id}', level: 'conversion' }] },
  { name: 'Bravo Traffic (test)', status: 'active', trafficSource: 'Social', country: 'IN',
    postbacks: [{ url: 'https://httpbin.org/get?network=bravo&clickid={sub1}&sum={payout}', level: 'event', event: 'purchase' }] },
  { name: 'Charlie Ads (test)', status: 'active', trafficSource: 'Native', country: 'GB',
    postbacks: [{ url: 'https://httpbin.org/post', level: 'conversion', method: 'POST', offer: 'Amazon Shopping — RevShare 8 % of the order' }] },
  { name: 'Delta Push (test)', status: 'active', trafficSource: 'Push', country: 'DE', postbacks: [] },
  { name: 'Echo Native (test)', status: 'pending', trafficSource: 'Native', country: 'FR', postbacks: [] },
] as const;

interface OfferSpec {
  advertiser: string; body: Json;
  geo?: { country: string; action?: 'allow' | 'deny'; payoutOverride?: string; revenueOverride?: string; destinationOverride?: string }[];
  goals?: Json[];
  approve?: string[];
  /** Price Per Product rules (/api/offers/:id/products). */
  products?: Json[];
}
const fixed = (extra: Json = {}): Json => ({
  baseEventName: null, manualApproval: false, allowDuplicates: true, revenueAction: 'conversion', revenueType: 'fixed', revenuePct: null, pricePerProduct: false, ...extra,
});
const attribution = (extra: Json = {}): Json => ({
  tracker24: { enabled: false, trackerId: null }, ipqs: { enabled: false }, throttle: { enabled: false, ratePct: 0 },
  clickToConversion: { enabled: false, minSeconds: 5, maxSeconds: 21600 }, emailOwnership: false, viewThrough: false, serverSideClick: false, ...extra,
});
const OFFERS: OfferSpec[] = [
  { advertiser: 'Google Ads (test)', geo: [{ country: 'US' }, { country: 'CA', payoutOverride: '2.00', revenueOverride: '3.20' }], body: {
    name: 'Google Search — CPA · US & CA only', payoutModel: 'CPA', defaultPayout: '2.50', defaultRevenue: '4.00', category: 'Search',
    destinationUrl: 'https://www.google.com/search?q=affiliate+tracking+test&click_id={click_id}&sub1={sub1}',
    description: 'Allow-list US and CA (CA pays 2.00). A click from any other country is rejected “Geo not allowed” — try ?geo=CA or ?geo=IN.' } },
  { advertiser: 'YouTube (test)', body: {
    name: 'YouTube Premium — RevShare 30 % · worldwide', payoutModel: 'RevShare', defaultPayout: '3.00', defaultRevenue: '0', category: 'Streaming',
    destinationUrl: 'https://www.youtube.com/premium?click_id={click_id}&src={publisher_id}',
    revenueSettings: fixed({ revenueType: 'percentage', revenuePct: 30 }),
    description: 'Revenue is 30 % of the sale: send sale_amount in the postback (…&sale_amount=40 → revenue 12.00).' } },
  { advertiser: 'Meta (test)', geo: [{ country: 'IN' }, { country: 'BR', payoutOverride: '0.60' }], body: {
    name: 'Instagram App Install — CPI · mobile only · IN & BR', payoutModel: 'CPI', defaultPayout: '0.80', defaultRevenue: '1.20', category: 'Apps',
    allowedTrafficTypes: ['mobile', 'tablet'], objective: 'app_installs',
    destinationUrl: 'https://www.instagram.com/?utm_source=tracker-test&click_id={click_id}',
    description: 'Phones and tablets only — a desktop click is rejected “Device not allowed”.' } },
  { advertiser: 'Meta (test)', goals: [
    { name: 'Lead', eventName: 'lead', payoutModel: 'CPL', payout: '1.50', revenue: '2.50', isDefault: true, sortOrder: 0 },
    { name: 'Purchase', eventName: 'purchase', payoutModel: 'CPA', payout: '10.00', revenue: '18.00', sortOrder: 1 },
  ], body: {
    name: 'Facebook Lead Form — CPL lead → CPA purchase (2 events)', payoutModel: 'CPL', defaultPayout: '1.50', defaultRevenue: '2.50', category: 'Lead gen', objective: 'leads',
    destinationUrl: 'https://www.facebook.com/business/ads/lead-ads?click_id={click_id}',
    description: 'Two events on one click: postback &event=lead (pays 1.50), then &event=purchase (pays 10.00).' } },
  { advertiser: 'Amazon Shopping (test)', body: {
    name: 'Amazon Shopping — RevShare 8 % of the order', payoutModel: 'RevShare', defaultPayout: '0', defaultRevenue: '0', category: 'E-commerce', objective: 'sale',
    destinationUrl: 'https://www.amazon.com/s?k=headphones&tag=tracker-test&click_id={click_id}',
    revenueSettings: fixed({ revenueType: 'percentage', revenuePct: 8 }),
    description: 'Revenue 8 % of sale_amount; Delta Push earns 25 % of the sale (Offer Custom Settings › CPS).' } },
  { advertiser: 'Booking EU (test)', geo: [
    { country: 'DE', payoutOverride: '3.00' }, { country: 'FR', payoutOverride: '2.50' },
    { country: 'GB', payoutOverride: '3.50', destinationOverride: 'https://www.booking.com/country/gb.html?click_id={click_id}' }, { country: 'ES', payoutOverride: '2.00' },
  ], body: {
    name: 'Booking.com Hotels — EU only · per-country payout', payoutModel: 'CPA', defaultPayout: '2.50', defaultRevenue: '4.00', currency: 'EUR', category: 'Travel',
    destinationUrl: 'https://www.booking.com/?click_id={click_id}', fallbackUrl: 'https://www.booking.com/',
    description: 'DE 3.00 · FR 2.50 · GB 3.50 (own landing page) · ES 2.00, in EUR. Other countries go to the fallback URL.' } },
  { advertiser: 'YouTube (test)', approve: ['Alpha Media (test)'], body: {
    name: 'Netflix Free Trial — private · approved partners only', payoutModel: 'CPA', defaultPayout: '5.00', defaultRevenue: '8.00', visibility: 'private', category: 'Streaming',
    destinationUrl: 'https://www.netflix.com/signup?click_id={click_id}',
    description: 'Only Alpha Media is approved — a click from another partner is rejected “Partner not approved for the offer”.' } },
  { advertiser: 'Google Ads (test)', body: {
    name: 'LinkedIn Jobs — request access (ask)', payoutModel: 'CPL', defaultPayout: '1.00', defaultRevenue: '1.80', visibility: 'ask', category: 'Jobs', objective: 'leads',
    destinationUrl: 'https://www.linkedin.com/jobs/?click_id={click_id}',
    description: 'Partners must ask for access (Offers › Applications) before their clicks count.' } },
  { advertiser: 'Google Ads (test)', body: {
    name: 'Spotify Premium — daily caps (100 clicks / 20 conversions)', payoutModel: 'CPA', defaultPayout: '2.00', defaultRevenue: '3.00', category: 'Music',
    dailyClickCap: 100, dailyConversionCap: 20,
    destinationUrl: 'https://www.spotify.com/premium/?click_id={click_id}',
    description: 'The 101st click of the day is rejected “Cap has been exceeded”.' } },
  { advertiser: 'Google Ads (test)', geo: [{ country: 'CN', action: 'deny' }, { country: 'RU', action: 'deny' }], body: {
    name: 'Wikipedia Donate — block-list CN & RU', payoutModel: 'CPA', defaultPayout: '0.50', defaultRevenue: '0.90', category: 'Nonprofit',
    destinationUrl: 'https://donate.wikimedia.org/?click_id={click_id}',
    description: 'Everyone except CN and RU (deny rules).' } },
  { advertiser: 'Amazon Shopping (test)', body: {
    name: 'Prime Video — desktop only', payoutModel: 'CPA', defaultPayout: '1.20', defaultRevenue: '2.00', category: 'Streaming',
    allowedTrafficTypes: ['desktop'], destinationUrl: 'https://www.primevideo.com/?click_id={click_id}',
    description: 'Desktop browsers only.' } },
  { advertiser: 'Meta (test)', body: {
    name: 'WhatsApp Business — every postback counts (renewals)', payoutModel: 'CPA', defaultPayout: '1.00', defaultRevenue: '1.50', category: 'Apps',
    revenueSettings: fixed({ duplicateMode: 'every_postback' }), destinationUrl: 'https://business.whatsapp.com/?click_id={click_id}',
    description: 'Monthly renewals without a transaction id: every postback is a new conversion (an identical repeat within 60 s is a retry).' } },
  { advertiser: 'Booking EU (test)', body: {
    name: 'Airbnb Host Sign-up — manual approval', payoutModel: 'CPL', defaultPayout: '4.00', defaultRevenue: '6.00', currency: 'EUR', category: 'Travel',
    revenueSettings: fixed({ manualApproval: true }), destinationUrl: 'https://www.airbnb.com/host/homes?click_id={click_id}',
    description: 'Conversions arrive pending — approve them in Reports › Conversion before they pay.' } },
  { advertiser: 'Google Ads (test)', body: {
    name: 'X (Twitter) Ads — paused', status: 'paused', payoutModel: 'CPA', defaultPayout: '1.00', defaultRevenue: '1.60', category: 'Social',
    destinationUrl: 'https://ads.x.com/?click_id={click_id}', description: 'Paused: clicks are rejected “Offer not active”.' } },
  { advertiser: 'Google Ads (test)', body: {
    name: 'Debug — echo every macro (httpbin)', payoutModel: 'CPA', defaultPayout: '1.00', defaultRevenue: '2.00', category: 'Testing',
    destinationUrl: 'https://httpbin.org/anything?click_id={click_id}&offer_id={offer_id}&publisher_id={publisher_id}&country={country}&device={device}&sub1={sub1}&sub2={sub2}&sub3={sub3}',
    description: 'Lands on a page showing exactly what the tracker passed — the quickest way to copy a click id for a postback.' } },
  { advertiser: 'Google Ads (test)', body: {
    name: 'Google Display — CPC 0.30 a click', payoutModel: 'CPC', defaultPayout: '0.30', defaultRevenue: '0.50', category: 'Display', objective: 'clicks',
    revenueSettings: fixed({ revenueAction: 'click' }), destinationUrl: 'https://www.google.com/search?q=display+ads&click_id={click_id}',
    description: 'Each unique, valid click from a partner is paid (0.30) and billed (0.50) — a "paid click" in Reports › Conversion (source click). No postback needed.' } },
  { advertiser: 'YouTube (test)', body: {
    name: 'YouTube Pre-roll — CPM 2.00 · view-through 24 h', payoutModel: 'CPM', defaultPayout: '2.00', defaultRevenue: '5.00', category: 'Video', objective: 'impressions',
    revenueSettings: fixed({ revenueAction: 'impression' }), attributionSettings: attribution({ viewThrough: true, viewThroughWindowHours: 24 }),
    destinationUrl: 'https://www.youtube.com/?click_id={click_id}',
    description: 'Fire the impression pixel (/impression?offer_id=…&pub_id=…): 2.00 / 5.00 per 1,000 valid impressions, booked every few minutes. A postback with impression_id=<id> (or offer_id + ip) and no click is a view-through conversion.' } },
  { advertiser: 'Meta (test)', body: {
    name: 'Netflix Subscription — email ownership (rebills)', payoutModel: 'CPA', defaultPayout: '4.00', defaultRevenue: '6.00', category: 'Streaming',
    attributionSettings: attribution({ emailOwnership: true, emailOwnershipMethod: 'first' }),
    destinationUrl: 'https://www.netflix.com/?click_id={click_id}',
    description: 'A conversion with &email=… makes its partner the customer\'s owner. A later postback with offer_id + the same email and NO click id (a rebill) is credited to that partner.' } },
  { advertiser: 'Amazon Shopping (test)', products: [
    { sku: 'SHOE-1', name: 'Running shoe', payoutType: 'fixed', payoutValue: '5.00', revenueType: 'percent', revenueValue: '20' },
    { category: 'electronics', name: 'All electronics', payoutType: 'percent', payoutValue: '3' },
  ], body: {
    name: 'Amazon Fashion — price per product', payoutModel: 'CPA', defaultPayout: '1.00', defaultRevenue: '0', category: 'E-commerce', objective: 'sale',
    revenueSettings: fixed({ revenueType: 'percentage', revenuePct: 10, pricePerProduct: true }),
    destinationUrl: 'https://www.amazon.com/fashion?click_id={click_id}',
    description: 'Send the order\'s products on the postback (products=[{"sku":"SHOE-1","price":"50","quantity":2},…]): SHOE-1 pays 5.00 a unit and bills 20 %, electronics pay 3 %, anything else 1.00 a unit (10 % revenue).' } },
  { advertiser: 'Booking EU (test)', body: {
    name: 'Booking Direct — direct linking (JavaScript tag)', payoutModel: 'CPA', defaultPayout: '2.00', defaultRevenue: '3.50', category: 'Travel',
    linkingType: 'redirect_direct', destinationUrl: 'https://www.booking.com/?click_id={click_id}',
    description: 'Partners link straight to booking.com with ?offer_id=…&pub_id=…; the tag (/sdk.js) on the advertiser\'s page registers the click. GET /api/offers/:id/links gives the direct link and the tag.' } },
];

const ok = (r: request.Response, what: string): Json => {
  if (r.status >= 300) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
  return (r.body?.data ?? {}) as Json;
};

async function main(): Promise<void> {
  if (!env.SUPABASE_JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET is not set — it signs the admin session this script uses.');
  const net = (await query<{ id: string; name: string }>('SELECT id, name FROM networks WHERE slug = $1', [slug])).rows[0];
  if (!net) throw new Error(`No network with the slug "${slug}". Run: npm run seed:test-catalog -- <your-network-slug>`);
  const admin = (await query<{ auth_user_id: string; email: string }>(
    `SELECT auth_user_id, email FROM users WHERE network_id = $1 AND role = 'admin' AND status = 'active' AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1`, [net.id])).rows[0];
  if (!admin) throw new Error(`Network "${slug}" has no active admin login to act as.`);
  const token = jwt.sign({
    iss: `${env.SUPABASE_URL!.replace(/\/+$/, '')}/auth/v1`, aud: 'authenticated', sub: admin.auth_user_id,
    network_id: net.id, kind: 'admin', role: 'admin', email: admin.email,
  }, env.SUPABASE_JWT_SECRET, { expiresIn: '30m' });
  const app = buildDashboardApp();
  const api = {
    get: (p: string) => request(app).get(`/api${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: Json) => request(app).post(`/api${p}`).set('Authorization', `Bearer ${token}`).send(b),
    patch: (p: string, b: Json) => request(app).patch(`/api${p}`).set('Authorization', `Bearer ${token}`).send(b),
  };
  const existing = async (table: string) => new Map((await query<{ id: string; name: string; ref: string }>(
    `SELECT id, name, ref::text FROM ${table} WHERE network_id = $1`, [net.id])).rows.map((r) => [r.name, r]));

  // Advertisers and partners.
  const advs = await existing('advertisers');
  for (const a of ADVERTISERS) {
    if (advs.has(a.name)) continue;
    const d = ok(await api.post('/advertisers', { ...a, status: 'active' }), `advertiser ${a.name}`);
    advs.set(a.name, { id: String(d['id']), name: a.name, ref: String(d['ref'] ?? '') });
  }
  const pubs = await existing('publishers');
  for (const p of PARTNERS) {
    if (pubs.has(p.name)) continue;
    const d = ok(await api.post('/publishers', {
      name: p.name, status: p.status, trafficSource: p.trafficSource, country: p.country,
      contactEmail: `${p.name.split(' ')[0]!.toLowerCase()}@partners.example.com`,
    }), `partner ${p.name}`);
    pubs.set(p.name, { id: String(d['id']), name: p.name, ref: String(d['ref'] ?? '') });
  }
  const pubsAfter = await existing('publishers');

  // Offers with their GEO rules, goals and approvals.
  const offers = await existing('offers');
  let created = 0;
  for (const o of OFFERS) {
    const name = String(o.body['name']);
    if (offers.has(name)) continue;
    const d = ok(await api.post('/offers', { status: 'active', currency: 'USD', ...o.body, advertiserId: advs.get(o.advertiser)!.id }), `offer ${name}`);
    const id = String(d['id']);
    for (const g of o.geo ?? []) ok(await api.post(`/offers/${id}/geo-rules`, { action: 'allow', ...g }), `geo rule ${g.country} on ${name}`);
    for (const g of o.goals ?? []) ok(await api.post(`/offers/${id}/goals`, g), `goal ${String(g['name'])} on ${name}`);
    for (const p of o.approve ?? []) ok(await api.post(`/offers/${id}/publishers`, { publisherId: pubsAfter.get(p)!.id, access: 'allow', approvalStatus: 'approved' }), `approve ${p} on ${name}`);
    for (const p of o.products ?? []) ok(await api.post(`/offers/${id}/products`, p), `product rule on ${name}`);
    offers.set(name, { id, name, ref: String(d['ref'] ?? '') });
    created += 1;
  }
  const offersAfter = await existing('offers');

  // Partner postbacks (skipped when the partner already has one).
  for (const p of PARTNERS) {
    const pub = pubsAfter.get(p.name)!;
    const has = (await query('SELECT 1 FROM publisher_postbacks WHERE network_id = $1 AND publisher_id = $2', [net.id, pub.id])).rows.length > 0;
    if (has) continue;
    for (const pb of p.postbacks) {
      ok(await api.post(`/publishers/${pub.id}/postbacks`, {
        url: pb.url, method: 'method' in pb ? pb.method : 'GET', level: pb.level,
        event: 'event' in pb ? pb.event : null, offerId: 'offer' in pb ? offersAfter.get(pb.offer)!.id : null,
      }), `postback for ${p.name}`);
    }
  }

  // A partner revenue share: Delta Push earns 25 % of the sale on the Amazon offer.
  const amazon = offersAfter.get('Amazon Shopping — RevShare 8 % of the order')!;
  const delta = pubsAfter.get('Delta Push (test)')!;
  const hasCps = (await query(`SELECT 1 FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $2 AND partner_id = $3`, [net.id, amazon.id, delta.id])).rows.length > 0;
  if (!hasCps) {
    ok(await api.post('/offer-custom-settings', {
      category: 'revenue_payout', offerId: amazon.id, partnerId: delta.id, name: 'Delta Push — 25 % of the sale',
      applyCustomPayout: true, payoutModel: 'CPS', payoutValue: '25', status: 'active',
    }), 'custom payout for Delta Push');
  }

  // Deep links on the Amazon offer (partners may send &url=https://www.amazon.com/…), and a coupon code for
  // Alpha on it (a postback with coupon_code=TEST10 and no click id is credited to Alpha) — kept in step.
  await api.patch(`/offers/${amazon.id}`, { deepLinkEnabled: true }).then((r) => ok(r, 'deep links on Amazon'));
  const alpha0 = pubsAfter.get('Alpha Media (test)')!;
  const hasCoupon = (await query(`SELECT 1 FROM offer_coupons WHERE network_id = $1 AND lower(code) = 'test10'`, [net.id])).rows.length > 0;
  if (!hasCoupon) ok(await api.post(`/offers/${amazon.id}/coupons`, { code: 'TEST10', publisherId: alpha0.id, description: 'Alpha Media test coupon' }), 'coupon TEST10');

  // Local tracking links: localhost / 127.0.0.1 → this network.
  for (const host of ['localhost', '127.0.0.1']) {
    await query(
      `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
       VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued', false)
       ON CONFLICT (lower(host)) DO UPDATE SET network_id = EXCLUDED.network_id, status = 'active', verification_state = 'verified'`, [net.id, host]);
  }

  // What to click.
  const alpha = pubsAfter.get('Alpha Media (test)')!;
  const echo = pubsAfter.get('Echo Native (test)')!;
  const lines = OFFERS.map((o) => {
    const of = offersAfter.get(String(o.body['name']))!;
    return `  ${String(of.ref).padStart(4)}  ${String(o.body['name'])}\n        http://localhost:4002/click?offer_id=${of.ref}&pub_id=${alpha.ref}&sub1=my-test-1`;
  });
  // eslint-disable-next-line no-console
  console.log(`
✅ Test catalog on "${net.name}" (${slug}) — ${created} new offer(s); ${ADVERTISERS.length} advertisers, ${PARTNERS.length} partners (refs: ${PARTNERS.map((p) => `${pubsAfter.get(p.name)!.ref} ${p.name}`).join(' · ')})

Click links (partner Alpha Media, ref ${alpha.ref}; change pub_id to try the others — ${echo.ref} is pending → rejected):
${lines.join('\n')}

Force a country with &geo=US (dev only). Then fire a conversion (copy click_id from the landing page's address bar):
  http://localhost:4002/postback?click_id=<CLICK_ID>&txn_id=order-1&status=approved&secure_code=<your code: Settings › Security>
  …add &event=purchase on the Facebook offer, &sale_amount=40 on the RevShare offers.
Coupon (no click): http://localhost:4002/postback?coupon_code=TEST10&txn_id=order-2&sale_amount=40&status=approved&secure_code=<CODE>
Deep link (Amazon): http://localhost:4002/click?offer_id=${amazon.ref}&pub_id=${alpha.ref}&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0TEST
Real GEO on localhost: add -H 'X-Forwarded-For: 49.36.0.1' (IN) / 8.8.4.4 (US) to curl, or &geo=US / &geo=US-CA
Impression pixel (CPM offer): http://localhost:4002/impression?offer_id=${offersAfter.get('YouTube Pre-roll — CPM 2.00 · view-through 24 h')!.ref}&pub_id=${alpha.ref}
Products (price per product): …/postback?click_id=<CLICK_ID>&products=%5B%7B%22sku%22%3A%22SHOE-1%22%2C%22price%22%3A%2250%22%2C%22quantity%22%3A2%7D%5D&status=approved&secure_code=<CODE>
Email rebill (no click): …/postback?offer_id=${offersAfter.get('Netflix Subscription — email ownership (rebills)')!.ref}&email=jane@example.com&txn_id=rebill-1&status=approved&secure_code=<CODE>
`);
}

main()
  .then(async () => { await closeDb(); await getRedis().quit().catch(() => undefined); process.exit(0); })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    await closeDb().catch(() => undefined);
    await getRedis().quit().catch(() => undefined);
    process.exit(1);
  });
