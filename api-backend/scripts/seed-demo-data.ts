/**
 * Comprehensive demo data seed for the enterprise affiliate tracking platform.
 *
 * Populates Partners (publishers), Advertisers, Offers, Clicks, Conversions, and all
 * sub-module assets (Smart Links, Offer Groups, Creatives, Traffic Controls, Custom Settings,
 * SmartSwitch, Partner/Advertiser Invoices, Partner Postbacks, Traffic Sources, Traffic
 * Blocking, Coupon Codes, Offer Templates, Offer Goals/Deals, Leadger Entries, Fraud Rules).
 *
 * Idempotent: deletes prior demo rows by network slug, then re-inserts.
 *
 * Prereq: run `npm run seed` then `npm run seed:rich` then `npm run seed:rich-modules`
 * against the SAME db first (this needs the demo network fully populated).
 *
 * Usage (LOCAL / throwaway DB only):
 * DATABASE_URL='postgresql://tracker:tracker_local_dev@localhost:5433/tracker_test' \
 * npm --prefix api-backend run seed:demo-data
 */
import pg from 'pg';

const NET_SLUG = 'demo';

function pick<T>(xs: readonly T[], i: number): T {
 return xs[((i % xs.length) + xs.length) % xs.length]!;
}

function daysAgo(n: number): Date {
 return new Date(Date.now() - n * 864e5);
}

function daysAhead(n: number): Date {
 return new Date(Date.now() + n * 864e5);
}

function hoursAgo(n: number): Date {
 return new Date(Date.now() - n * 3600e3);
}

function money(n: number): string {
 return n.toFixed(4);
}

function randomClickId(): string {
 return randomUUID().replace(/-/g, '').slice(0, 32);
}

function randomConversionId(): string {
 return randomUUID().replace(/-/g, '').slice(0, 24);
}

function randomUUID(): string {
 // Minimal UUID v4 without crypto
 const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
 return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(parseInt(hex.slice(16, 17), 16) & 0x3 | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const COUNTRIES = ['US', 'IN', 'GB', 'DE', 'CA', 'AU', 'BR', 'FR', 'ES', 'NL', 'NG', 'PK', 'VN', 'MX', 'JP'];
const DEVICES = ['Mobile', 'Desktop', 'Tablet'];
const BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge', 'Opera'];
const OS_LIST = ['iOS', 'Android', 'Windows', 'MacOS', 'Linux'];
const ISP_LIST = ['Comcast', 'AT&T', 'Verizon', 'T-Mobile', 'Vodafone', 'Deutsche Telekom', 'Reliance Jio', 'Singtel'];
const EVENT_NAMES = ['purchase', 'signup', 'install', 'lead', 'trial_start', 'renewal'];
const FRAUD_FLAGS_POOL: string[][] = [[], [], [], ['high_click_rate'], ['unusual_device'], ['vpndetected'], [], [], [], ['new_ip'], ['suspicious_country']];
const SUB_POOLS = [
 ['fb_', 'google_', 'tiktok_', 'taboola_', 'push_'],
 ['summer', 'winter', 'spring', 'promo', 'vip'],
 ['camp_', 'adset_', 'zone_'],
 ['111', '222', '333', ''],
];

async function main(): Promise<void> {
 const dbUrl = process.env.DATABASE_URL;
 if (!dbUrl) throw new Error('DATABASE_URL is required');
 if (/supabase\.(co|com)/i.test(dbUrl)) {
 throw new Error('Refusing to run: DATABASE_URL points at a hosted Supabase project. Point it at a local/throwaway DB.');
 }

 const db = new pg.Client({ connectionString: dbUrl });
 await db.connect();
 try {
 const net = (await db.query<{ id: string }>(`SELECT id FROM networks WHERE slug = $1`, [NET_SLUG])).rows[0];
 if (!net) throw new Error(`network "${NET_SLUG}" not found — run \`npm run seed\` first`);
 const netId = net.id;

 // ── 0. clean prior demo data ──────────────────────────────────────────────────
 // Clicks/conversions have no metadata column, so we use a unique click_id prefix for cleanup
 const DEMO_CLICK_PREFIX = 'demo-seed-';
 await db.query(
 `DELETE FROM ledger_entries WHERE network_id = $1 AND idempotency_key LIKE $2`, [netId, 'ledger_pub_demo%']);
 await db.query(
 `DELETE FROM conversions WHERE network_id = $1 AND conversion_id LIKE $2`, [netId, 'demo%']);
 await db.query(
 `DELETE FROM clicks WHERE network_id = $1 AND click_id LIKE $2`, [netId, `${DEMO_CLICK_PREFIX}%`]);

 // Clean sub-module data we'll re-seed
 await db.query(`DELETE FROM offer_coupons WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM partner_invoices WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM advertiser_invoices WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM traffic_blockings WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM traffic_sources WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM traffic_controls WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_custom_settings WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM smartswitch_history WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM smartswitch_rules WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM smart_link_items WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM smart_links WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_groups WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_creatives WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_templates WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_goals WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_deals WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM publisher_postbacks WHERE network_id = $1`, [netId]);
 await db.query(`DELETE FROM offer_publisher_access WHERE network_id = $1`, [netId]);

 // ── 1. Look up existing references ───────────────────────────────────────────
 const offers = (await db.query<{ id: string; name: string; advertiser_id: string; currency: string; payout_model: string; default_payout: string; default_revenue: string }>(
 `SELECT id, name, advertiser_id, currency, payout_model, default_payout::text, default_revenue::text FROM offers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
 const advertisers = (await db.query<{ id: string; name: string; default_currency: string }>(
 `SELECT id, name, default_currency FROM advertisers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
 const publishers = (await db.query<{ id: string; name: string }>(
 `SELECT id, name FROM publishers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
 const users = (await db.query<{ id: string; name: string; role: string; auth_user_id: string | null }>(
 `SELECT id, name, role, auth_user_id FROM users WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
 const domains = (await db.query<{ id: string; host: string }>(
 `SELECT id, host FROM tracking_domains WHERE network_id = $1`, [netId])).rows;
 const admin = users.find((u) => u.role === 'admin') ?? users[0]!;
 const signInAdmins = users.filter((u) => u.role === 'admin' && u.auth_user_id);
 const primaryAdminAuthId = signInAdmins[0]?.auth_user_id ?? admin.id;
 const dom = (h: string): string | null => domains.find((d) => d.host === h)?.id ?? null;

 const advByName = (n: string) => advertisers.find((a) => a.name === n)!.id;
 const pubByName = (n: string) => publishers.find((p) => p.name === n)!.id;
 const offerByName = (n: string) => offers.find((o) => o.name === n)!.id;

 await db.query('BEGIN');

 // ══════════════════════════════════════════════════════════════════════════════
 // 2. ENRICH PUBLISHERS (Partners) — add country, payment_method, tier, managers
 // ══════════════════════════════════════════════════════════════════════════════
 const PUB_ENRICH: { name: string; country: string; payment_method: string; billing_freq: string; tier: string; status: string }[] = [
 { name: 'TrafficCo', country: 'US', payment_method: 'PayPal', billing_freq: 'Net 15', tier: 'Gold Partners', status: 'active' },
 { name: 'MediaBuyers', country: 'GB', payment_method: 'Wire', billing_freq: 'Net 30', tier: 'Silver Partners', status: 'active' },
 { name: 'PushHouse', country: 'DE', payment_method: 'Payoneer', billing_freq: 'Net 30', tier: 'Platinum Partners', status: 'active' },
 { name: 'InfluencerCo', country: 'US', payment_method: 'ACH', billing_freq: 'Net 15', tier: 'Gold Partners', status: 'active' },
 { name: 'ClickFlow', country: 'IN', payment_method: 'PayPal', billing_freq: 'Net 45', tier: 'Silver Partners', status: 'active' },
 { name: 'AdVenture', country: 'AU', payment_method: 'Wire', billing_freq: 'Net 30', tier: 'New Partners', status: 'pending' },
 { name: 'ScaleMedia', country: 'CA', payment_method: 'Payoneer', billing_freq: 'Net 15', tier: 'Gold Partners', status: 'active' },
 { name: 'RevenueX', country: 'BR', payment_method: 'PayPal', billing_freq: 'Net 30', tier: 'Silver Partners', status: 'paused' },
 { name: 'GrowthLabs', country: 'US', payment_method: 'ACH', billing_freq: 'Net 15', tier: 'Platinum Partners', status: 'active' },
 { name: 'PolarAffiliates', country: 'GB', payment_method: 'Wire', billing_freq: 'Net 30', tier: 'New Partners', status: 'active' },
 { name: 'ZenithMedia', country: 'FR', payment_method: 'Payoneer', billing_freq: 'Net 45', tier: 'Gold Partners', status: 'pending' },
 { name: 'NexusPublishers', country: 'DE', payment_method: 'PayPal', billing_freq: 'Net 30', tier: 'Silver Partners', status: 'active' },
 ];
 // If fewer publishers than enrich entries, trim
 const pubEnrich = PUB_ENRICH.slice(0, publishers.length);
 const managerUsers = users.filter((u) => u.role === 'manager' || u.role === 'admin');
 for (let i = 0; i < pubEnrich.length; i++) {
 const p = pubEnrich[i]!;
 await db.query(
 `UPDATE publishers
 SET status = $3, country = $4, payment_method = $5, billing_frequency = $6, tier = $7,
 partner_manager_id = $8, account_executive_id = $9, contact_email = $10
 WHERE network_id = $1 AND name = $2`,
 [netId, p.name, p.status, p.country, p.payment_method, p.billing_freq, p.tier,
 pick(managerUsers, i).id, pick(managerUsers, i + 1).id,
 `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@contact.test`]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 3. ENRICH ADVERTISERS — add billing_terms, verification_token
 // ══════════════════════════════════════════════════════════════════════════════
 const ADV_ENRICH: { name: string; billing_terms: string; status: string }[] = [
 { name: 'Acme Corp', billing_terms: 'Net 30', status: 'active' },
 { name: 'Lumen Skincare', billing_terms: 'Net 15', status: 'active' },
 { name: 'Sterling Financial', billing_terms: 'Net 30', status: 'active' },
 { name: 'Fjord Outdoor Co', billing_terms: 'Net 45', status: 'active' },
 { name: 'Pixel Forge Games', billing_terms: 'Net 15', status: 'active' },
 { name: 'Globex Nutrition', billing_terms: 'Net 30', status: 'active' },
 { name: 'Northwind Retail', billing_terms: 'Net 30', status: 'active' },
 { name: 'StreamVault Inc', billing_terms: 'Net 30', status: 'active' },
 ];
 const advEnrich = ADV_ENRICH.slice(0, advertisers.length);
 for (const a of advEnrich) {
 await db.query(
 `UPDATE advertisers
 SET status = $3, billing_terms = $4, verification_token = $5,
 contact_email = $6
 WHERE network_id = $1 AND name = $2`,
 [netId, a.name, a.status, a.billing_terms,
 `vtok_${a.name.toLowerCase().replace(/[^a-z]+/g, '')}_${randomUUID().slice(0, 8)}`,
 `billing@${a.name.toLowerCase().replace(/[^a-z]+/g, '')}.test`]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 4. SMART LINKS — 6 entries with varied mechanisms
 // ══════════════════════════════════════════════════════════════════════════════
 const SMART_LINKS = [
 { name: 'US Nutrition Rotator', mech: 'weight', status: 'active', showToPartners: true, catchAll: true, host: 'demo.ourtracking.com' },
 { name: 'EU Finance Priority', mech: 'priority', status: 'active', showToPartners: false, catchAll: true, host: 'demo.ourtracking.com' },
 { name: 'Global Gaming KPI', mech: 'kpi', status: 'active', showToPartners: true, catchAll: true, host: 'demo.ourtracking.com' },
 { name: 'Catch-All Fallback', mech: 'weight', status: 'paused', showToPartners: false, catchAll: true, host: 'demo.ourtracking.com' },
 { name: 'US Direct (no fallback)', mech: 'weight', status: 'active', showToPartners: true, catchAll: false, host: 'localhost' },
 { name: 'APAC Priority Split', mech: 'priority', status: 'active', showToPartners: false, catchAll: true, host: 'localhost' },
 ];
 for (let s = 0; s < SMART_LINKS.length; s++) {
 const sl = SMART_LINKS[s]!;
 const slOffers = offers.slice(s, s + 4);
 const row = (await db.query<{ id: string }>(
 `INSERT INTO smart_links (network_id, name, status, redirect_mechanism, catch_all_offer_id, labels, force_ssl, show_to_partners, tracking_domain_id,
 kpi_run_frequency_hours, kpi_lookback_hours, kpi_metric, kpi_min_clicks)
 VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12) RETURNING id`,
 [
 netId, sl.name, sl.status, sl.mech,
 sl.catchAll ? slOffers[slOffers.length - 1]?.id ?? null : null,
 `${sl.name.split(' ')[0]?.toLowerCase() ?? 'default'},${s % 2 === 0 ? 'active' : 'curated'}`,
 sl.showToPartners, dom(sl.host),
 sl.mech === 'kpi' ? 24 : null, sl.mech === 'kpi' ? 168 : null,
 sl.mech === 'kpi' ? 'epc' : null, sl.mech === 'kpi' ? 100 : null,
 ])).rows[0]!;
 for (let it = 0; it < slOffers.length; it++) {
 await db.query(
 `INSERT INTO smart_link_items (network_id, smart_link_id, offer_id, weight, country, offer_url, position)
 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
 [netId, row.id, slOffers[it]!.id, sl.mech === 'weight' ? (it + 1) * 10 : 1,
 pick([null, 'US', 'GB', 'DE'], it), null, it]);
 }
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 5. OFFER GROUPS — 3-4 groups with shared caps
 // ══════════════════════════════════════════════════════════════════════════════
 const GROUPS = [
 { name: 'US Nutrition Portfolio', offerNames: ['Globex Daily Greens Trial - US', 'Globex Sleep Formula - US', 'Globex Keto Bundle — US'], currency: 'USD', caps: '{"clicks":{"daily":50000,"monthly":1200000},"conversions":{"daily":2500},"payout":{"daily":8000}}' },
 { name: 'EU Finance Launch', offerNames: ['Sterling Personal Loan — UK', 'Sterling Balance-Transfer Card — UK'], currency: 'GBP', caps: '{"revenue":{"daily":15000,"weekly":90000},"clicks":{"daily":20000}}' },
 { name: 'Mobile Gaming Bundle', offerNames: ['Pixel Forge: Dragon Realm — Global Install', 'Pixel Forge: Idle Tycoon — US/CA'], currency: 'USD', caps: null },
 { name: 'Skincare Premium Set', offerNames: ['Lumen Vitamin C Serum — US', 'Lumen Retinol Night Cream — CA'], currency: 'USD', caps: '{"clicks":{"daily":30000},"payout":{"daily":5000,"monthly":120000}}' },
 ];
 for (const g of GROUPS) {
 const ids = g.offerNames.map(on => offerByName(on)).filter(Boolean) as string[];
 if (ids.length === 0) continue;
 const advId = (await db.query<{ advertiser_id: string | null }>(
 `SELECT advertiser_id FROM offers WHERE id = $1`, [ids[0]])).rows[0]?.advertiser_id ?? null;
 await db.query(
 `INSERT INTO offer_groups (network_id, name, advertiser_id, offer_ids, currency, labels, notes, status, caps_enabled, caps)
 VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'active',$8,$9::jsonb)`,
 [netId, g.name, advId, JSON.stringify(ids), g.currency,
 `${g.name.toLowerCase().split(' ')[0]},${g.currency.toLowerCase()}`, `Curated ${g.name} — review caps monthly.`,
 g.caps != null, g.caps ?? '{}']);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 6. CREATIVES — banners, html, link, email, video, thumbnail, archive, text
 // ══════════════════════════════════════════════════════════════════════════════
 const CREATIVES_DATA: { name: string; type: string; url: string | null; html: string | null; w: number | null; h: number | null; lang: string; status: string; vis: boolean }[] = [];
 // Banner images per first 6 offers
 for (let i = 0; i < Math.min(offers.length, 6); i++) {
 const o = offers[i]!;
 CREATIVES_DATA.push(
 { name: `${o.name.slice(0, 20)} — Leaderboard`, type: 'image', url: `https://cdn.demo.test/creatives/${o.id.slice(0, 8)}/lb-728x90.jpg`, html: null, w: 728, h: 90, lang: 'en', status: 'active', vis: true },
 { name: `${o.name.slice(0, 20)} — Medium Rect`, type: 'image', url: `https://cdn.demo.test/creatives/${o.id.slice(0, 8)}/mr-300x250.jpg`, html: null, w: 300, h: 250, lang: 'en', status: pick(['active', 'paused'], i), vis: true },
 );
 if (i % 2 === 0) {
 CREATIVES_DATA.push(
 { name: `${o.name.slice(0, 20)} — HTML5 Banner`, type: 'html', url: null, html: `<a href="{tracking_link}"><img src="https://cdn.demo.test/c/${o.id.slice(0, 8)}-h.jpg" /></a>`, w: 300, h: 250, lang: pick(['en', 'de', 'fr'], i), status: 'active', vis: true },
 );
 }
 }
 // Extra types for filter variety
 const EXTRA_CREATIVES = [
 { name: 'Q4 Promo Reel — 15s', type: 'video', url: 'https://cdn.demo.test/creatives/promo-15s.mp4', html: null, w: 1920, h: 1080, lang: 'en', status: 'active', vis: true },
 { name: 'Launch Sizzle — 30s (DE)', type: 'video', url: 'https://cdn.demo.test/creatives/sizzle-de.mp4', html: null, w: 1280, h: 720, lang: 'de', status: 'paused', vis: true },
 { name: 'Banner Pack — IAB set', type: 'archive', url: 'https://cdn.demo.test/creatives/iab-banner-pack.zip', html: null, w: null, h: null, lang: 'en', status: 'active', vis: true },
 { name: 'Social Kit — FR', type: 'archive', url: 'https://cdn.demo.test/creatives/social-kit-fr.zip', html: null, w: null, h: null, lang: 'fr', status: 'active', vis: false },
 { name: 'App Icon 512', type: 'thumbnail', url: 'https://cdn.demo.test/creatives/app-icon-512.png', html: null, w: 512, h: 512, lang: 'en', status: 'active', vis: true },
 { name: 'Store Hero Thumb', type: 'thumbnail', url: 'https://cdn.demo.test/creatives/store-hero.png', html: null, w: 1200, h: 628, lang: 'en', status: 'active', vis: true },
 { name: 'Email Body Copy — ES', type: 'text', url: 'https://cdn.demo.test/creatives/email-copy-es.txt', html: null, w: null, h: null, lang: 'es', status: 'active', vis: true },
 { name: 'Native Headlines — EN', type: 'text', url: 'https://cdn.demo.test/creatives/native-headlines.txt', html: null, w: null, h: null, lang: 'en', status: 'paused', vis: true },
 { name: 'Retired Leaderboard 728x90', type: 'image', url: 'https://cdn.demo.test/creatives/retired-728.jpg', html: null, w: 728, h: 90, lang: 'en', status: 'deleted', vis: false },
 { name: 'Old Coupon Snippet', type: 'html', url: null, html: '<div class="promo">Use code SAVE20 — <a href="{tracking_link}">shop now</a></div>', w: 300, h: 250, lang: 'en', status: 'deleted', vis: true },
 ];
 CREATIVES_DATA.push(...EXTRA_CREATIVES);

 for (let i = 0; i < CREATIVES_DATA.length; i++) {
 const c = CREATIVES_DATA[i]!;
 const o = offers[i % Math.min(offers.length, 9)]!;
 const type = c.type;
 await db.query(
 `INSERT INTO offer_creatives (network_id, offer_id, name, type, url, html, width, height, language, status, visible_to_partners, email_from, email_subject)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
 [netId, o.id, c.name, type, c.url, c.html, c.w, c.h, c.lang, c.status, c.vis,
 type === 'email' ? 'promo@demo.test' : null,
 type === 'email' ? `Limited time: ${o.name.slice(0, 32)}` : null]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 7. CUSTOM SETTINGS — 5 categories (revenue_payout, caps, throttle_rates, landing_pages, creatives)
 // ══════════════════════════════════════════════════════════════════════════════
 const OCS = [
 { category: 'revenue_payout', name: 'Q1 VIP payout bump', oi: 0, event: 'lead', value: '18.00', pn: 2 },
 { category: 'revenue_payout', name: 'EU revenue uplift', oi: 2, event: 'sale', value: '32.00', pn: 0 },
 { category: 'revenue_payout', name: 'Legacy CPL rate', oi: 4, event: 'lead', value: '9.50', pn: 1, status: 'paused' },
 { category: 'caps', name: 'Weekend click ceiling', oi: 0, event: 'Daily Click Cap', value: '25000', pn: 0 },
 { category: 'caps', name: 'Trial conversion cap', oi: 2, event: 'Daily Conversion Cap', value: '400', pn: 0 },
 { category: 'caps', name: 'Lifetime cap — launch', oi: 3, event: 'Total Conversion Cap', value: '10000', pn: 1, status: 'paused' },
 { category: 'throttle_rates', name: 'Slow ramp — new geo', oi: 1, event: null, value: '40', desc: 'https://lp.demo.test/holding', pn: 0 },
 { category: 'throttle_rates', name: 'Datacenter shave', oi: 5, event: null, value: '15', pn: 2 },
 { category: 'landing_pages', name: 'Mobile-optimised LP', oi: 0, event: '60', value: 'https://lp.demo.test/m/offer', pn: 0 },
 { category: 'landing_pages', name: 'A/B variant B', oi: 0, event: '40', value: 'https://lp.demo.test/b/offer', pn: 0 },
 { category: 'landing_pages', name: 'German LP', oi: 2, event: '100', value: 'https://lp.demo.test/de/offer', pn: 1, status: 'paused' },
 { category: 'creatives', name: 'Hero banner 970x250', oi: 1, event: '70', value: 'hero-970x250.jpg', pn: 0 },
 { category: 'creatives', name: 'Story video 9:16', oi: 4, event: '30', value: 'story-vertical.mp4', pn: 0 },
 ];
 for (const s of OCS) {
 const o = offers[s.oi % offers.length]!;
 const partnerIds = publishers.slice(0, s.pn).map((p) => p.id);
 await db.query(
 `INSERT INTO offer_custom_settings (network_id, category, name, offer_id, partner_ids, description, public_description, event, value, status)
 VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
 [netId, s.category, s.name, o.id, JSON.stringify(partnerIds), s.desc ?? null, null, s.event, s.value, s.status ?? 'active']);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 8. TRAFFIC CONTROLS — blacklist/whitelist IP/GEO rules
 // ══════════════════════════════════════════════════════════════════════════════
 const TC = [
 { name: 'Block empty referrer', ct: 'blacklist', action: 'block', vars: ['referrer'], cmp: 'is_empty', vals: [] as string[] },
 { name: 'Datacenter user-agents', ct: 'blacklist', action: 'fail_traffic', vars: ['user_agent'], cmp: 'contains', vals: ['bot', 'crawler', 'python-requests'] },
 { name: 'Allow only tier-1 geo', ct: 'whitelist', action: 'block', vars: ['country'], cmp: 'exact_match', vals: ['US', 'GB', 'CA', 'AU'] },
 { name: 'Reject test sub IDs', ct: 'blacklist', action: 'block', vars: ['sub1', 'sub2'], cmp: 'begins_with', vals: ['test_', 'qa_'] },
 { name: 'Desktop-only offers', ct: 'whitelist', action: 'fail_traffic', vars: ['device'], cmp: 'exact_match', vals: ['desktop'] },
 ];
 for (let i = 0; i < TC.length; i++) {
 const t = TC[i]!;
 await db.query(
 `INSERT INTO traffic_controls (network_id, name, control_type, offer_ids, advertiser_ids, partner_ids, status,
 effective_from, effective_to, offer_scope, partner_scope, action, variables, comparison_method, control_values)
 VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb)`,
 [
 netId, t.name, t.ct, JSON.stringify(i % 3 === 1 ? [offers[i % offers.length]!.id] : []),
 JSON.stringify(i % 3 === 2 ? [advertisers[i % advertisers.length]!.id] : []),
 JSON.stringify(i % 2 === 0 ? [] : [publishers[i % publishers.length]!.id]),
 i % 4 === 3 ? 'inactive' : 'active',
 i % 2 === 0 ? daysAgo(15) : null, i % 2 === 0 ? daysAhead(45) : null,
 i % 3 === 0 ? 'all' : i % 3 === 1 ? 'offers' : 'advertisers',
 i % 2 === 0 ? 'all' : 'specific', t.action,
 JSON.stringify(t.vars), t.cmp, JSON.stringify(t.vals),
 ]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 9. TRAFFIC SOURCES
 // ══════════════════════════════════════════════════════════════════════════════
 const TRAFFIC_SOURCES = [
 { name: 'Facebook Ads', params: [{ parameter: 'utm_source', value: 'facebook' }, { parameter: 'sub1', value: '{campaign_id}' }, { parameter: 'sub2', value: '{adset_id}' }] },
 { name: 'Google Ads', params: [{ parameter: 'utm_source', value: 'google' }, { parameter: 'sub1', value: '{gclid}' }] },
 { name: 'TikTok Ads', params: [{ parameter: 'utm_source', value: 'tiktok' }, { parameter: 'sub1', value: '{ttclid}' }] },
 { name: 'Taboola Native', params: [{ parameter: 'utm_source', value: 'taboola' }, { parameter: 'sub1', value: '{site_id}' }, { parameter: 'sub2', value: '{thumbnail}' }] },
 { name: 'Push House', params: [{ parameter: 'utm_source', value: 'pushhouse' }, { parameter: 'sub1', value: '{zone}' }] },
 ];
 for (const s of TRAFFIC_SOURCES) {
 await db.query(
 `INSERT INTO traffic_sources (network_id, name, enable_postback, postback_url, visible_to_partners, parameters)
 VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
 [netId, s.name, true, `https://pb.${s.name.toLowerCase().replace(/[^a-z]+/g, '')}.com/conv?cid={click_id}`,
 true, JSON.stringify(s.params)]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 10. TRAFFIC BLOCKING — per-field filter rules
 // ══════════════════════════════════════════════════════════════════════════════
 const TB_RULES: Record<string, { matchType: string; value: string | null }>[] = [
 { sub1: { matchType: 'contains', value: 'spam_' } },
 { sub2: { matchType: 'exact_match', value: 'incentivized' } },
 { sub1: { matchType: 'begins_with', value: 'bot-' }, sub3: { matchType: 'contains', value: 'fraud' } },
 { sourceId: { matchType: 'exact_match', value: '99999' } },
 { sub4: { matchType: 'is_empty', value: null } },
 { sub5: { matchType: 'ends_with', value: '_blocked' } },
 ];
 for (let i = 0; i < TB_RULES.length; i++) {
 await db.query(
 `INSERT INTO traffic_blockings (network_id, publisher_id, offer_id, status, filters)
 VALUES ($1,$2,$3,$4,$5::jsonb)`,
 [netId, publishers[i % publishers.length]!.id, offers[i % offers.length]!.id,
 i === 3 ? 'inactive' : 'active', JSON.stringify(TB_RULES[i]!)]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 11. PARTNER POSTBACKS
 // ══════════════════════════════════════════════════════════════════════════════
 for (let i = 0; i < 8; i++) {
 const scope = i % 3;
 const pubId = scope === 2 ? null : publishers[i % publishers.length]!.id;
 const offId = scope === 0 ? null : offers[i % offers.length]!.id;
 await db.query(
 `INSERT INTO publisher_postbacks (network_id, publisher_id, offer_id, url, method, event, status, level, delivery_method, html_code, description, delay)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
 [netId, pubId, offId,
 `https://s2s.${pick(['affpartner', 'clickflow', 'leadgen'], i)}.com/pb?cid={click_id}&payout={payout}&txn={transaction_id}`,
 i % 2 === 0 ? 'GET' : 'POST',
 pick(EVENT_NAMES, i),
 i % 5 === 4 ? 'disabled' : 'active',
 pick(['conversion', 'event', 'cpc'], i), 'postback', null,
 pick(['Main S2S postback', 'Backup pixel', 'Meta CAPI bridge', 'CPC tracking'], i),
 i % 3 === 0 ? null : String(i * 5)]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 12. COUPON CODES
 // ══════════════════════════════════════════════════════════════════════════════
 const COUPONS = ['SAVE20', 'WELCOME10', 'FREESHIP', 'VIP25', 'SPRING15', 'BUNDLE30', 'FLASH50', 'LOYAL5'];
 for (let i = 0; i < COUPONS.length; i++) {
 await db.query(
 `INSERT INTO offer_coupons (network_id, offer_id, publisher_id, code, description, discount, status, starts_at, ends_at, notes)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
 ON CONFLICT (offer_id, lower(code)) DO NOTHING`,
 [netId, offers[i % offers.length]!.id,
 i % 3 === 0 ? publishers[i % publishers.length]!.id : null,
 COUPONS[i], `${COUPONS[i]} promo code`,
 pick(['20%', '10%', 'Free shipping', '25%', '$15 off', '30%'], i),
 pick(['active', 'active', 'active', 'expired', 'disabled'], i),
 daysAgo(30 - i), i % 4 === 3 ? daysAgo(2) : daysAhead(30 + i * 3),
 i % 5 === 0 ? 'Creator-exclusive code' : null]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 13. PARTNER INVOICES (Accounts Payable)
 // ══════════════════════════════════════════════════════════════════════════════
 for (let i = 0; i < 6; i++) {
 const billed = 1800 + i * 940 + (i % 3) * 275;
 const paid = i % 3 === 0 ? 0 : i % 3 === 1 ? billed : Math.round(billed * 0.6);
 await db.query(
 `INSERT INTO partner_invoices (network_id, publisher_id, status, visible_to_partner, payment_terms, payment_method, currency,
 period_start, period_end, billed_amount, payments_amount, paid_at, public_notes, internal_notes)
 VALUES ($1,$2,$3,true,$4,$5,'USD',$6,$7,$8,$9,$10,$11,$12)`,
 [netId, publishers[i % publishers.length]!.id,
 paid >= billed ? 'paid' : 'unpaid',
 pick(['Net 15', 'Net 30', 'Net 45'], i),
 pick(['PayPal', 'Wire', 'Payoneer', 'ACH'], i),
 new Date(daysAgo(60 - i * 5).getFullYear(), daysAgo(60).getMonth() - (i % 3) - 1, 1),
 new Date(daysAgo(60 - i * 5).getFullYear(), daysAgo(60).getMonth() - (i % 3), 0),
 money(billed), money(paid),
 paid >= billed ? daysAgo(3 + i) : null,
 i % 2 === 0 ? 'Thanks for the great month!' : null,
 i % 3 === 0 ? 'Awaiting advertiser settlement' : null]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 14. ADVERTISER INVOICES (Accounts Receivable)
 // ══════════════════════════════════════════════════════════════════════════════
 for (let i = 0; i < 6; i++) {
 const adv = advertisers[i % advertisers.length]!;
 const billed = 4200 + i * 1600 + (i % 4) * 500;
 const paid = i % 3 === 0 ? 0 : i % 3 === 1 ? billed : Math.round(billed * 0.75);
 await db.query(
 `INSERT INTO advertiser_invoices (network_id, advertiser_id, status, visible_to_advertiser, payment_terms, currency,
 period_start, period_end, billed_amount, paid_amount, paid_at, notes)
 VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11)`,
 [netId, adv.id, paid >= billed ? 'paid' : 'unpaid',
 pick(['Net 30', 'Net 45', 'Prepaid', 'Net 60'], i),
 adv.default_currency || 'USD',
 new Date(daysAgo(55 - i * 4).getFullYear(), daysAgo(55).getMonth() - (i % 3) - 1, 1),
 new Date(daysAgo(55 - i * 4).getFullYear(), daysAgo(55).getMonth() - (i % 3), 0),
 money(billed), money(paid),
 paid >= billed ? daysAgo(4 + i) : null,
 i % 2 === 1 ? 'Includes Q-end volume bonus' : null]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 15. SMART-SWITCH RULES — reference catalog
 // ══════════════════════════════════════════════════════════════════════════════
 const SWITCH_RULES = [
 { name: 'Pause on low EPC', action: 'notify', delay: '1h', variable: 'epc', actionable: 'epc,cvr', nOffers: 3 },
 { name: 'Block offers over daily cap', action: 'block', delay: '15m', variable: 'daily_cap', actionable: null, nOffers: 3 },
 { name: 'Notify on conversion-rate drop', action: 'notify', delay: '30m', variable: 'conversion_rate', actionable: 'cvr', nOffers: 5 },
 { name: 'Block on datacenter spike', action: 'block', delay: '5m', variable: 'datacenter_pct', actionable: 'fraud_score', nOffers: 2, status: 'paused' },
 ];
 for (const r of SWITCH_RULES) {
 await db.query(
 `INSERT INTO smartswitch_rules (network_id, name, action, action_delay, variable, actionable_variables, offer_ids, advertiser_ids, partner_ids, status)
 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
 [netId, r.name, r.action, r.delay, r.variable, r.actionable,
 JSON.stringify(offers.slice(0, r.nOffers).map((o) => o.id)), '[]', '[]', r.status ?? 'active']);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 16. OFFER TEMPLATES
 // ══════════════════════════════════════════════════════════════════════════════
 const TEMPLATES = [
 { name: 'CPA Lead-Gen Default', def: true, values: { advertiserId: advertisers[0]!.id, category: 'Finance', visibility: 'public', destinationUrl: 'https://lp.demo-lead.test/start?cid={click_id}', currency: 'USD', payoutModel: 'CPA', defaultPayout: '12.0000', defaultRevenue: '20.0000' } },
 { name: 'App Install (CPI)', def: false, values: { category: 'Gaming', visibility: 'public', currency: 'USD', payoutModel: 'CPI', defaultPayout: '2.5000', defaultRevenue: '4.0000' } },
 { name: 'RevShare Subscription', def: false, values: { category: 'Streaming & Software', visibility: 'ask', currency: 'USD', payoutModel: 'RevShare', defaultPayout: '30.0000', defaultRevenue: '45.0000' } },
 ];
 for (const t of TEMPLATES) {
 await db.query(
 `INSERT INTO offer_templates (network_id, name, is_default, offer_fields, field_values)
 VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
 [netId, t.name, t.def, JSON.stringify(Object.keys(t.values)), JSON.stringify(t.values)]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 17. OFFER GOALS + DEALS
 // ══════════════════════════════════════════════════════════════════════════════
 for (let i = 0; i < Math.min(offers.length, 6); i++) {
 const o = offers[i]!;
 await db.query(
 `INSERT INTO offer_goals (network_id, offer_id, name, event_name, payout_model, payout, revenue, currency, daily_conversion_cap, total_conversion_cap, is_default, status, sort_order)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'active',0)`,
 [netId, o.id, 'Primary Conversion', pick(EVENT_NAMES, i), pick(['CPA', 'CPL', 'CPI'], i),
 money(6 + i * 2), money(12 + i * 3), o.currency || 'USD', i % 2 === 0 ? 500 + i * 50 : null, i % 3 === 0 ? 10000 : null]);
 if (i % 2 === 0) {
 await db.query(
 `INSERT INTO offer_goals (network_id, offer_id, name, event_name, payout_model, payout, revenue, currency, is_default, status, sort_order)
 VALUES ($1,$2,'Upsell Event',$3,'CPA',$4,$5,$6,false,'active',1)`,
 [netId, o.id, 'upsell', money(3 + i), money(7 + i), o.currency || 'USD']);
 }
 await db.query(
 `INSERT INTO offer_deals (network_id, offer_id, name, description, deal_type, value, status, starts_at, ends_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
 [netId, o.id,
 pick(['Weekend Payout Boost', 'Q-End Push', 'Exclusive Bump', 'Holiday Bonus'], i),
 'Temporary payout increase for top partners',
 pick(['payout_boost', 'flat_bonus', 'custom'], i),
 money(2 + i), pick(['active', 'active', 'scheduled', 'ended'], i),
 i % 3 === 2 ? daysAhead(5) : daysAgo(7), i % 3 === 3 ? daysAgo(1) : daysAhead(21)]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 18. FRAUD RULES config
 // ══════════════════════════════════════════════════════════════════════════════
 await db.query(
 `INSERT INTO fraud_rules (network_id, config) VALUES ($1,$2::jsonb)
 ON CONFLICT (network_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
 [netId, JSON.stringify({
 clickFloodPerMinute: 120,
 duplicateClickWindowS: 5,
 datacenterIpBlock: true,
 maxConversionsPerClick: 1,
 suspiciousCountryList: ['NG', 'PK', 'VN'],
 minTimeToConvertS: 3,
 autoHoldFraudScoreOver: 0.75,
 })]);

 // ══════════════════════════════════════════════════════════════════════════════
 // 19. PUBLISHER-OFFER ACCESS GRANTS (ensure private/ask offers are accessible)
 // ══════════════════════════════════════════════════════════════════════════════
 const privateOffers = offers.filter((o) => {
 const adv = advertisers.find((a) => a.id === o.advertiser_id);
 return adv?.name !== 'Acme Corp' || o.name.includes('Globex');
 });
 for (let i = 0; i < privateOffers.length; i++) {
 const grant = [publishers[i % publishers.length]!, publishers[(i + 1) % publishers.length]!];
 for (const p of grant) {
 await db.query(
 `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
 VALUES ($1,$2,$3,'allow','approved')
 ON CONFLICT (offer_id, publisher_id) DO NOTHING`,
 [netId, privateOffers[i]!.id, p.id]);
 }
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 20-A. RECENT CLICKS — guaranteed data in last 24h for chart visibility
 // ══════════════════════════════════════════════════════════════════════════════
 const RECENT_CLICKS = 120;
 const HOURS_BACK = 24;
 for (let i = 0; i < RECENT_CLICKS; i++) {
 const o = pick(offers, i);
 const pub = pick(publishers, i + 1);
 const hoursAgo = Math.random() * HOURS_BACK;
 const clickTime = new Date(Date.now() - hoursAgo * 3600000);
 const country = pick(COUNTRIES, i);
 const device = pick(DEVICES, i);
 const browser = pick(BROWSERS, i);
 const os = pick(OS_LIST, i);
 const subPool = pick(SUB_POOLS, i % SUB_POOLS.length);
 const fraudFlags = pick(FRAUD_FLAGS_POOL, i % FRAUD_FLAGS_POOL.length);
 const fraudScore = fraudFlags.length > 0 ? Math.floor(Math.random() * 50) + 25 : Math.floor(Math.random() * 15);
 const payout = parseFloat(o.default_payout) + (Math.random() - 0.5) * 2;
 const revenue = parseFloat(o.default_revenue) + (Math.random() - 0.5) * 3;
 const cid = `${DEMO_CLICK_PREFIX}recent-${randomUUID().replace(/-/g, '').slice(0, 24)}`;

 await db.query(
 `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip,
 country, region, city, isp, device, os, browser, referrer, user_agent,
 sub1, sub2, sub3, sub4, sub5, is_unique, fraud_score, fraud_flags,
 resolved_payout, resolved_revenue, currency)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
 [
 cid, netId, o.id, pub.id, clickTime.toISOString(),
 `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
 country, null, null, pick(ISP_LIST, i),
 device, os, browser,
 `https://ref.${pick(['fb', 'google', 'tiktok', 'taboola'], i)}.com/click/${i}`,
 `${browser}/${os}`,
 `${pick(subPool, 0)}${pick(['camp', 'adset', 'zone', 'src'], i)}_${1000 + i}`,
 `${pick(subPool, 1)}${pick(['email', 'promo', 'vip', 'standard'], i)}_${i}`,
 `${pick(subPool, 2)}${i}`,
 `${pick(subPool, 3)}${i % 50}`,
 null,
 true, fraudScore, JSON.stringify(fraudFlags),
 Math.max(0, payout).toFixed(4), Math.max(0, revenue).toFixed(4), 'USD',
 ]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 20. CLICKS — 500+ over past 30 days
 // ══════════════════════════════════════════════════════════════════════════════
 const TOTAL_CLICKS = 600;
 const CLICK_BATCH = 200;
 for (let batch = 0; batch < TOTAL_CLICKS; batch += CLICK_BATCH) {
 const end = Math.min(batch + CLICK_BATCH, TOTAL_CLICKS);
 const values: string[] = [];
 const params: (string | number | boolean | null)[] = [];
 let pIdx = 1;

 for (let i = batch; i < end; i++) {
 const o = pick(offers, i);
 const pub = pick(publishers, i + 1);
 const clickTime = daysAgo(Math.random() * 30);
 const country = pick(COUNTRIES, i);
 const device = pick(DEVICES, i);
 const browser = pick(BROWSERS, i);
 const os = pick(OS_LIST, i);
 const subPool = pick(SUB_POOLS, i % SUB_POOLS.length);
 const fraudFlags = pick(FRAUD_FLAGS_POOL, i % FRAUD_FLAGS_POOL.length);
 const fraudScore = fraudFlags.length > 0 ? Math.floor(Math.random() * 50) + 25 : Math.floor(Math.random() * 15);
 const payout = parseFloat(o.default_payout) + (Math.random() - 0.5) * 2;
 const revenue = parseFloat(o.default_revenue) + (Math.random() - 0.5) * 3;
 const cid = `${DEMO_CLICK_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 24)}`;

 values.push(`($${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++})`);
 params.push(
 cid, netId, o.id, pub.id, clickTime.toISOString(),
 `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
 country, null, null, pick(ISP_LIST, i),
 device, os, browser,
 `https://ref.${pick(['fb', 'google', 'tiktok', 'taboola'], i)}.com/click/${i}`,
 `${browser}/${os}`,
 `${pick(subPool, 0)}${pick(['camp', 'adset', 'zone', 'src'], i)}_${1000 + i}`,
 `${pick(subPool, 1)}${pick(['email', 'promo', 'vip', 'standard'], i)}_${i % 100}`,
 `${pick(subPool, 2)}${i}`,
 `${pick(subPool, 3)}${i % 50}`,
 null,
 true, fraudScore, JSON.stringify(fraudFlags),
 Math.max(0, payout).toFixed(4), Math.max(0, revenue).toFixed(4), 'USD',
 );
 }

 await db.query(
 `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip,
 country, region, city, isp, device, os, browser, referrer, user_agent,
 sub1, sub2, sub3, sub4, sub5, is_unique, fraud_score, fraud_flags,
 resolved_payout, resolved_revenue, currency)
 VALUES ${values.join(',')}`,
 params);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 21. CONVERSIONS — 50+ from clicks
 // ══════════════════════════════════════════════════════════════════════════════
 // Grab click_ids for the first ~70 clicks to use as conversion origins
 const clickRows = (await db.query<{ click_id: string; offer_id: string; publisher_id: string; created_at: string }>(
 `SELECT click_id, offer_id, publisher_id, created_at FROM clicks WHERE network_id = $1 AND click_id LIKE $2 ORDER BY created_at LIMIT 70`,
 [netId, `${DEMO_CLICK_PREFIX}%`])).rows;

 const TOTAL_CONVERSIONS = 65;
 for (let i = 0; i < TOTAL_CONVERSIONS && i < clickRows.length; i++) {
 const src = pick(['postback', 'pixel', 'iframe', 'manual'], i);
 const status = pick(['approved', 'approved', 'approved', 'pending', 'rejected'], i);
 const click = clickRows[i]!;
 const o = offers.find((ov) => ov.id === click.offer_id) ?? offers[0]!;
 const payout = status === 'approved' ? (parseFloat(o.default_payout) * (0.6 + Math.random() * 0.8)).toFixed(4) : null;
 const revenue = status === 'approved' ? (parseFloat(o.default_revenue) * (0.7 + Math.random() * 0.6)).toFixed(4) : null;
 const clickTs = new Date(click.created_at);

 await db.query(
 `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
 event_name, status, payout, revenue, currency, transaction_id, source, raw_params)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
 ON CONFLICT (conversion_id) DO NOTHING`,
 [
 `demo-conv-${i}-${Date.now().toString(36)}`, netId, click.click_id, click.offer_id, click.publisher_id, o.advertiser_id,
 pick(EVENT_NAMES, i), status, payout, revenue, o.currency || 'USD',
 `txn_${i}_${Date.now().toString(36)}`, src, JSON.stringify({ src }),
 ]);
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 22. LEDGER ENTRIES — derive from approved conversions so balances are real
 // ══════════════════════════════════════════════════════════════════════════════
 const approvedConvs = (await db.query<{ id: string; conversion_id: string; publisher_id: string; advertiser_id: string; payout: string; revenue: string; currency: string }>(
 `SELECT id, conversion_id, publisher_id, advertiser_id, payout::text, revenue::text, currency
 FROM conversions WHERE network_id = $1 AND status = 'approved' AND conversion_id LIKE 'demo-conv-%'
 ORDER BY created_at LIMIT 50`, [netId])).rows;

 for (let i = 0; i < approvedConvs.length; i++) {
 const c = approvedConvs[i]!;
 const payout = parseFloat(c.payout) || 0;
 const revenue = parseFloat(c.revenue) || 0;
 const ts = daysAgo(Math.random() * 25);

 // Publisher earning
 await db.query(
 `INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, status, idempotency_key, metadata)
 VALUES ($1,'publisher',$2,$3,'earning','credit',$4,$5,'approved',$6,'{"seed":"demo-data"}'::jsonb)
 ON CONFLICT (idempotency_key) DO NOTHING`,
 [netId, c.publisher_id, c.conversion_id, money(payout), c.currency, `ledger_pub_${c.conversion_id}`]);

 // Advertiser billing
 await db.query(
 `INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, status, idempotency_key, metadata)
 VALUES ($1,'advertiser',$2,$3,'billing','credit',$4,$5,'approved',$6,'{"seed":"demo-data"}'::jsonb)
 ON CONFLICT (idempotency_key) DO NOTHING`,
 [netId, c.advertiser_id, c.conversion_id, money(revenue), c.currency, `ledger_adv_${c.conversion_id}`]);

 // Network revenue entry
 if (revenue > payout) {
 await db.query(
 `INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, status, idempotency_key, metadata)
 VALUES ($1,'publisher',$2,$3,'earning','credit',$4,$5,'approved',$6,'{"seed":"demo-data"}'::jsonb)
 ON CONFLICT (idempotency_key) DO NOTHING`,
 [netId, c.publisher_id, c.conversion_id, money(revenue - payout), c.currency, `ledger_net_${c.conversion_id}`]);
 }
 }

 // ══════════════════════════════════════════════════════════════════════════════
 // 23. SMART-SWITCH HISTORY entries
 // ══════════════════════════════════════════════════════════════════════════════
 const ruleRows = (await db.query<{ id: string; name: string }>(
 `SELECT id, name FROM smartswitch_rules WHERE network_id = $1`, [netId])).rows;
 for (let i = 0; i < ruleRows.length; i++) {
 await db.query(
 `INSERT INTO smartswitch_history (network_id, rule_id, rule_name, change, employee, created_at)
 VALUES ($1,$2,$3,$4,$5,$6)`,
 [netId, ruleRows[i]!.id, ruleRows[i]!.name, 'Rule created', primaryAdminAuthId, daysAgo(7 - i)]);
 }

 await db.query('COMMIT');

 // ── Summary ──────────────────────────────────────────────────────────────────
 const c = async (t: string, extra = ''): Promise<number> => Number((await db.query<{ n: string }>(
 `SELECT count(*) n FROM ${t} WHERE network_id = $1 ${extra}`, [netId])).rows[0]!.n);

 const summary = {
 publishers_enriched: await c('publishers', `AND country IS NOT NULL`),
 advertisers_enriched: await c('advertisers', `AND billing_terms IS NOT NULL`),
 smart_links: await c('smart_links'),
 smart_link_items: await c('smart_link_items'),
 offer_groups: await c('offer_groups'),
 offer_creatives: await c('offer_creatives'),
 offer_custom_settings: await c('offer_custom_settings'),
 traffic_controls: await c('traffic_controls'),
 traffic_sources: await c('traffic_sources'),
 traffic_blockings: await c('traffic_blockings'),
 offer_coupons: await c('offer_coupons'),
 partner_invoices: await c('partner_invoices'),
 advertiser_invoices: await c('advertiser_invoices'),
 publisher_postbacks: await c('publisher_postbacks'),
 offer_templates: await c('offer_templates'),
 offer_goals: await c('offer_goals'),
 offer_deals: await c('offer_deals'),
 smartswitch_rules: await c('smartswitch_rules'),
 smartswitch_history: await c('smartswitch_history'),
 clicks: await c('clicks', `AND click_id LIKE '${DEMO_CLICK_PREFIX}%'`),
 conversions: await c('conversions', `AND conversion_id LIKE 'demo-conv%'`),
 ledger_entries: await c('ledger_entries', `AND idempotency_key LIKE 'ledger_pub_demo%'`),
 fraud_rules: await c('fraud_rules'),
 offer_publisher_access: await c('offer_publisher_access'),
 };
 // eslint-disable-next-line no-console
 console.log('seed-demo-data OK — demo network now has:\n' + JSON.stringify(summary, null, 2));
 } catch (err) {
 await db.query('ROLLBACK').catch(() => {});
 throw err;
 } finally {
 await db.end();
 }
}

main().then(
 () => process.exit(0),
 (err) => {
 // eslint-disable-next-line no-console
 console.error('seed-demo-data failed:', err instanceof Error ? err.message : err);
 process.exit(1);
 },
);
