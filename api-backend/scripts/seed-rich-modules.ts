/**
 * Rich local dev dataset — PART 2 (companion to seed-rich.ts).
 *
 * seed-rich.ts fills Offers / Advertisers / managers / tags / offer groups / geo rules. This script
 * fills every *other* dashboard module so the whole app can be seen and tested with real-looking
 * data: Partner Tiers, Offer Applications + Questionnaires, Partner/Advertiser Postbacks &
 * Controls, Traffic Sources / Blocking / Controls, Coupons, Partner & Advertiser Invoices, Custom
 * Fields & Metrics, Creatives, Offer Templates, Offer Goals & Deals, Smart Links (+ SmartSwitch),
 * Customer Value (data points / rules / firings), Communication Hub (templates / audiences /
 * messages / banners), Link Templates, Tiered Commissions, Fraud rules, API Keys, Marketplace
 * Profile, Reporting Adjustments.
 *
 * Pure SQL against DATABASE_URL — no hot-path code, no schema changes. Idempotent: every section
 * deletes its own network-scoped rows first, then re-inserts, inside one transaction. Relationships
 * are real — postbacks/coupons/creatives/goals reference actual offers, tiers/invoices/blocking
 * reference actual publishers, controls/commissions reference actual advertisers.
 *
 * Prereq: run `npm run seed` then `npm run seed:rich` against the SAME db first (this needs the
 * demo network populated with offers / advertisers / publishers / manager users).
 *
 * Usage (LOCAL / throwaway DB only — same override as every other dev script):
 *   DATABASE_URL='postgresql://tracker:tracker_local_dev@localhost:5433/tracker_test' \
 *     npm --prefix api-backend run seed:rich-modules
 */
import pg from 'pg';

const NET_SLUG = 'demo';
const pick = <T>(xs: readonly T[], i: number): T => xs[((i % xs.length) + xs.length) % xs.length]!;
const daysAgo = (n: number): Date => new Date(Date.now() - n * 864e5);
const daysAhead = (n: number): Date => new Date(Date.now() + n * 864e5);
const money = (n: number): string => n.toFixed(4);

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

    // ── reference data (must already exist) ───────────────────────────────────────────────────
    const offers = (await db.query<{ id: string; name: string; advertiser_id: string; currency: string }>(
      `SELECT id, name, advertiser_id, currency FROM offers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
    const advertisers = (await db.query<{ id: string; name: string; default_currency: string }>(
      `SELECT id, name, default_currency FROM advertisers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
    const publishers = (await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM publishers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
    const users = (await db.query<{ id: string; name: string; role: string; auth_user_id: string | null }>(
      `SELECT id, name, role, auth_user_id FROM users WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
    const domains = (await db.query<{ id: string; host: string }>(
      `SELECT id, host FROM tracking_domains WHERE network_id = $1`, [netId])).rows;
    const convIds = (await db.query<{ id: string }>(
      `SELECT id FROM conversions WHERE network_id = $1 ORDER BY created_at DESC LIMIT 40`, [netId])).rows.map((r) => r.id);
    if (offers.length < 5 || advertisers.length < 3 || publishers.length < 3) {
      throw new Error('need offers/advertisers/publishers seeded first — run `npm run seed:rich`');
    }
    const admin = users.find((u) => u.role === 'admin') ?? users[0]!;
    // The API-Keys screen scopes network keys to the logged-in admin's JWT `sub` (= users.auth_user_id,
    // NOT users.id) — so only sign-in-capable admins can own a visible key.
    const signInAdmins = users.filter((u) => u.role === 'admin' && u.auth_user_id);
    const dom = (h: string): string | null => domains.find((d) => d.host === h)?.id ?? domains[0]?.id ?? null;

    await db.query('BEGIN');

    // ── 0. clean this script's prior rows (FK-safe order) ─────────────────────────────────────
    await db.query(`UPDATE offers SET questionnaire_id = NULL WHERE network_id = $1`, [netId]);
    await db.query(`UPDATE offer_publisher_access SET approval_status = 'approved', answers = NULL
                      WHERE network_id = $1 AND answers IS NOT NULL`, [netId]);
    for (const t of [
      'partner_tier_offers', 'partner_tier_members', 'partner_tiers',
      'questionnaire_fields', 'questionnaires',
      'publisher_postbacks', 'traffic_blockings', 'traffic_sources', 'traffic_controls',
      'offer_coupons', 'partner_invoices', 'advertiser_invoices',
      'custom_field_defs', 'custom_metrics',
      'offer_creatives', 'offer_templates', 'offer_goals', 'offer_deals',
      'smart_link_items', 'smart_links', 'smartswitch_rules',
      'customer_value_rule_firings', 'customer_value_rules', 'customer_data_points',
      'email_messages', 'email_templates', 'audiences', 'banners',
      'advertiser_link_templates', 'advertiser_postback_controls', 'advertiser_tiered_commissions',
      'fraud_rules', 'api_keys', 'marketplace_profiles', 'reporting_adjustments',
    ]) {
      await db.query(`DELETE FROM ${t} WHERE network_id = $1`, [netId]);
    }

    // ═══ 1. Partner Tiers (Partners › Tiers) ══════════════════════════════════════════════════
    const TIERS = [
      { name: 'Platinum Partners', margin: 8, def: false, desc: 'Top-volume partners — lowest network margin, full offer visibility.' },
      { name: 'Gold Partners', margin: 15, def: false, desc: 'Established partners with a consistent track record.' },
      { name: 'Silver Partners', margin: 25, def: false, desc: 'Growing partners, standard margin.' },
      { name: 'New Partners', margin: 35, def: true, desc: 'Default tier for freshly approved partners.' },
    ];
    const tierIds: string[] = [];
    for (const t of TIERS) {
      const row = (await db.query<{ id: string }>(
        `INSERT INTO partner_tiers (network_id, name, status, description, margin_pct, is_default)
         VALUES ($1,$2,'active',$3,$4,$5) RETURNING id`,
        [netId, t.name, t.desc, t.margin, t.def])).rows[0]!;
      tierIds.push(row.id);
    }
    for (let i = 0; i < publishers.length; i++) {
      await db.query(
        `INSERT INTO partner_tier_members (network_id, tier_id, publisher_id) VALUES ($1,$2,$3)
         ON CONFLICT (tier_id, publisher_id) DO NOTHING`,
        [netId, pick(tierIds, i), publishers[i]!.id]);
    }
    for (let i = 0; i < Math.min(offers.length, 8); i++) {
      await db.query(
        `INSERT INTO partner_tier_offers (network_id, tier_id, offer_id, apply_margin, auto_approve_partners)
         VALUES ($1,$2,$3,true,$4) ON CONFLICT (tier_id, offer_id) DO NOTHING`,
        [netId, pick(tierIds, i), offers[i]!.id, i % 2 === 0]);
    }

    // ═══ 2. Questionnaires + Offer Applications (Partners › Offer Applications) ════════════════
    const QUESTIONNAIRES = [
      {
        name: 'Standard Partner Vetting',
        fields: [
          { label: 'Primary traffic source', data_field: 'select', required: true, options: ['Search', 'Social', 'Email', 'Native', 'Display', 'Push'] },
          { label: 'Estimated monthly clicks', data_field: 'numeric_input', required: true },
          { label: 'Do you use incentivised traffic?', data_field: 'checkbox', required: false },
          { label: 'Describe your promotional methods', data_field: 'textarea', required: true },
        ],
      },
      {
        name: 'Finance Vertical Compliance',
        fields: [
          { label: 'Are you FCA / regulator registered?', data_field: 'checkbox', required: true },
          { label: 'Registration number', data_field: 'input', required: false },
          { label: 'Compliance contact email', data_field: 'input', required: true },
          { label: 'Target countries', data_field: 'input', required: true, tooltip: 'Comma-separated ISO codes' },
          { label: 'Earliest go-live date', data_field: 'date_input', required: false },
        ],
      },
    ];
    const qIds: string[] = [];
    for (const q of QUESTIONNAIRES) {
      const qrow = (await db.query<{ id: string }>(
        `INSERT INTO questionnaires (network_id, name, status) VALUES ($1,$2,'active') RETURNING id`,
        [netId, q.name])).rows[0]!;
      qIds.push(qrow.id);
      for (let p = 0; p < q.fields.length; p++) {
        const f = q.fields[p]!;
        await db.query(
          `INSERT INTO questionnaire_fields (network_id, questionnaire_id, position, label, required, tooltip, data_field, options)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [netId, qrow.id, p, f.label, f.required, ('tooltip' in f ? f.tooltip : null) ?? null, f.data_field, ('options' in f ? f.options : null) ?? null]);
      }
    }
    // attach a questionnaire to a spread of offers
    const qOfferIds = offers.slice(0, 5).map((o) => o.id);
    for (let i = 0; i < qOfferIds.length; i++) {
      await db.query(`UPDATE offers SET questionnaire_id = $2 WHERE id = $1`, [qOfferIds[i], pick(qIds, i)]);
    }
    // flip a deterministic subset of existing access grants to "pending" with submitted answers
    const grantRows = (await db.query<{ id: string; offer_id: string }>(
      `SELECT id, offer_id FROM offer_publisher_access WHERE network_id = $1 ORDER BY offer_id, publisher_id LIMIT 200`, [netId])).rows;
    let pendingSet = 0;
    for (const g of grantRows) {
      if (pendingSet >= 7) break;
      if (!qOfferIds.includes(g.offer_id)) continue;
      await db.query(
        `UPDATE offer_publisher_access
            SET approval_status = 'pending',
                answers = $2::jsonb
          WHERE id = $1`,
        [g.id, JSON.stringify({ submittedAt: daysAgo(2 + pendingSet).toISOString(), note: 'Applied via marketplace', trafficSource: pick(['Search', 'Social', 'Email', 'Native'], pendingSet) })]);
      pendingSet++;
    }

    // ═══ 3. Partner Postbacks (Partners › Postbacks) ═════════════════════════════════════════
    for (let i = 0; i < 8; i++) {
      const scope = i % 3; // 0 global(partner), 1 specific(partner+offer), 2 global(offer)
      const pubId = scope === 2 ? null : publishers[i % publishers.length]!.id;
      const offId = scope === 0 ? null : offers[i % offers.length]!.id;
      const delivery = i % 4 === 3 ? 'html' : 'postback';
      await db.query(
        `INSERT INTO publisher_postbacks (network_id, publisher_id, offer_id, url, method, event, status, level, delivery_method, html_code, description, delay)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          netId, pubId, offId,
          delivery === 'html' ? null : `https://s2s.${pick(['affpartner', 'clickflow', 'leadgen'], i)}.com/pb?cid={click_id}&payout={payout}&txn={transaction_id}`,
          i % 2 === 0 ? 'GET' : 'POST',
          pick(['conversion', 'purchase', 'lead', 'install'], i),
          i % 5 === 4 ? 'disabled' : 'active',
          pick(['conversion', 'event', 'cpc'], i),
          delivery,
          delivery === 'html' ? '<img src="https://s2s.affpartner.com/px?cid={click_id}" width="1" height="1" />' : null,
          pick(['Main S2S postback', 'Backup pixel', 'Meta CAPI bridge', 'CPC tracking'], i),
          i % 3 === 0 ? null : String(i * 5),
        ]);
    }

    // ═══ 4. Traffic Blocking (Partners › Traffic Blocking) ═══════════════════════════════════
    for (let i = 0; i < 6; i++) {
      await db.query(
        `INSERT INTO traffic_blockings (network_id, publisher_id, offer_id, status, filters)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [
          netId, publishers[i % publishers.length]!.id, offers[i % offers.length]!.id,
          i % 4 === 3 ? 'inactive' : 'active',
          JSON.stringify(pick([
            { subIds: ['spam_01', 'spam_02'], reason: 'Known fraudulent sub IDs' },
            { devices: ['tablet'], reason: 'No tablet inventory for this offer' },
            { countries: ['NG', 'PK'], reason: 'Out of geo' },
            { ipRanges: ['10.0.0.0/8'], reason: 'Datacenter traffic' },
          ], i)),
        ]);
    }

    // ═══ 5. Traffic Sources (Partners › Traffic Sources) ════════════════════════════════════
    const TRAFFIC_SOURCES = [
      { name: 'Facebook Ads', params: [{ parameter: 'utm_source', value: 'facebook' }, { parameter: 'sub1', value: '{campaign_id}' }, { parameter: 'sub2', value: '{adset_id}' }], postback: true },
      { name: 'Google Ads', params: [{ parameter: 'utm_source', value: 'google' }, { parameter: 'sub1', value: '{gclid}' }], postback: true },
      { name: 'TikTok Ads', params: [{ parameter: 'utm_source', value: 'tiktok' }, { parameter: 'sub1', value: '{ttclid}' }], postback: false },
      { name: 'Taboola Native', params: [{ parameter: 'utm_source', value: 'taboola' }, { parameter: 'sub1', value: '{site_id}' }, { parameter: 'sub2', value: '{thumbnail}' }], postback: false },
      { name: 'Push House', params: [{ parameter: 'utm_source', value: 'pushhouse' }, { parameter: 'sub1', value: '{zone}' }], postback: true },
    ];
    for (const s of TRAFFIC_SOURCES) {
      await db.query(
        `INSERT INTO traffic_sources (network_id, name, enable_postback, postback_url, visible_to_partners, parameters)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [netId, s.name, s.postback, s.postback ? `https://pb.${s.name.toLowerCase().replace(/[^a-z]+/g, '')}.com/conv?cid={click_id}` : null, true, JSON.stringify(s.params)]);
    }

    // ═══ 5b. Traffic Controls (Offers › Traffic Controls) ══════════════════════════════════
    const TC = [
      { name: 'Block empty referrer', ct: 'blacklist', action: 'block', vars: ['referrer'], cmp: 'is_empty', vals: [] },
      { name: 'Datacenter user-agents', ct: 'blacklist', action: 'fail_traffic', vars: ['user_agent'], cmp: 'contains', vals: ['bot', 'crawler', 'python-requests'] },
      { name: 'Allow only tier-1 geo', ct: 'whitelist', action: 'block', vars: ['country'], cmp: 'exact_match', vals: ['US', 'GB', 'CA', 'AU'] },
      { name: 'Reject test sub IDs', ct: 'blacklist', action: 'block', vars: ['sub1', 'sub2'], cmp: 'begins_with', vals: ['test_', 'qa_'] },
      { name: 'Desktop-only offers', ct: 'whitelist', action: 'fail_traffic', vars: ['device'], cmp: 'exact_match', vals: ['desktop'] },
    ];
    for (let i = 0; i < TC.length; i++) {
      const t = TC[i]!;
      const offerScope = i % 3 === 0 ? 'all' : i % 3 === 1 ? 'offers' : 'advertisers';
      await db.query(
        `INSERT INTO traffic_controls (network_id, name, control_type, offer_ids, advertiser_ids, partner_ids, status,
           effective_from, effective_to, offer_scope, partner_scope, action, variables, comparison_method, control_values)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb)`,
        [
          netId, t.name, t.ct,
          JSON.stringify(offerScope === 'offers' ? [offers[i % offers.length]!.id] : []),
          JSON.stringify(offerScope === 'advertisers' ? [advertisers[i % advertisers.length]!.id] : []),
          JSON.stringify(i % 2 === 0 ? [] : [publishers[i % publishers.length]!.id]),
          i % 4 === 3 ? 'inactive' : 'active',
          i % 2 === 0 ? daysAgo(15) : null, i % 2 === 0 ? daysAhead(45) : null,
          offerScope, i % 2 === 0 ? 'all' : 'specific', t.action,
          JSON.stringify(t.vars), t.cmp, JSON.stringify(t.vals),
        ]);
    }

    // ═══ 6. Coupon Codes (Partners › Coupon Codes) ═════════════════════════════════════════
    const COUPONS = ['SAVE20', 'WELCOME10', 'FREESHIP', 'VIP25', 'SPRING15', 'BUNDLE30', 'FLASH50', 'LOYAL5', 'NEWYEAR', 'CREATOR'];
    for (let i = 0; i < COUPONS.length; i++) {
      await db.query(
        `INSERT INTO offer_coupons (network_id, offer_id, publisher_id, code, description, discount, status, starts_at, ends_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (offer_id, lower(code)) DO NOTHING`,
        [
          netId, offers[i % offers.length]!.id,
          i % 3 === 0 ? publishers[i % publishers.length]!.id : null,
          COUPONS[i], `${COUPONS[i]} promo code`,
          pick(['20%', '10%', 'Free shipping', '25%', '$15 off', '30%'], i),
          pick(['active', 'active', 'active', 'expired', 'disabled'], i),
          daysAgo(30 - i), i % 4 === 3 ? daysAgo(2) : daysAhead(30 + i * 3),
          i % 5 === 0 ? 'Creator-exclusive code' : null,
        ]);
    }

    // ═══ 7. Partner Invoices (Partners › Invoices) ═════════════════════════════════════════
    for (let i = 0; i < 6; i++) {
      const billed = 1800 + i * 940 + (i % 3) * 275;
      const paid = i % 3 === 0 ? 0 : i % 3 === 1 ? billed : Math.round(billed * 0.6);
      await db.query(
        `INSERT INTO partner_invoices (network_id, publisher_id, status, visible_to_partner, payment_terms, payment_method, currency,
           period_start, period_end, billed_amount, payments_amount, paid_at, public_notes, internal_notes)
         VALUES ($1,$2,$3,true,$4,$5,'USD',$6,$7,$8,$9,$10,$11,$12)`,
        [
          netId, publishers[i % publishers.length]!.id,
          paid >= billed ? 'paid' : 'unpaid',
          pick(['Net 15', 'Net 30', 'Net 45'], i),
          pick(['PayPal', 'Wire', 'Payoneer', 'ACH'], i),
          new Date(daysAgo(60 - i * 5).getFullYear(), daysAgo(60).getMonth() - (i % 3) - 1, 1),
          new Date(daysAgo(60 - i * 5).getFullYear(), daysAgo(60).getMonth() - (i % 3), 0),
          money(billed), money(paid),
          paid >= billed ? daysAgo(3 + i) : null,
          i % 2 === 0 ? 'Thanks for the great month!' : null,
          i % 3 === 0 ? 'Awaiting advertiser settlement' : null,
        ]);
    }

    // ═══ 8. Advertiser Invoices (Advertisers › Invoices) ══════════════════════════════════
    for (let i = 0; i < 6; i++) {
      const adv = advertisers[i % advertisers.length]!;
      const billed = 4200 + i * 1600 + (i % 4) * 500;
      const paid = i % 3 === 0 ? 0 : i % 3 === 1 ? billed : Math.round(billed * 0.75);
      await db.query(
        `INSERT INTO advertiser_invoices (network_id, advertiser_id, status, visible_to_advertiser, payment_terms, currency,
           period_start, period_end, billed_amount, paid_amount, paid_at, notes)
         VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          netId, adv.id, paid >= billed ? 'paid' : 'unpaid',
          pick(['Net 30', 'Net 45', 'Prepaid', 'Net 60'], i),
          adv.default_currency || 'USD',
          new Date(daysAgo(55 - i * 4).getFullYear(), daysAgo(55).getMonth() - (i % 3) - 1, 1),
          new Date(daysAgo(55 - i * 4).getFullYear(), daysAgo(55).getMonth() - (i % 3), 0),
          money(billed), money(paid),
          paid >= billed ? daysAgo(4 + i) : null,
          i % 2 === 1 ? 'Includes Q-end volume bonus' : null,
        ]);
    }

    // ═══ 9. Custom Fields (Partners / Advertisers › Custom Fields) ════════════════════════
    const CUSTOM_FIELDS: { entity: 'publisher' | 'advertiser'; key: string; label: string; type: string; options?: string[] }[] = [
      { entity: 'publisher', key: 'skype_handle', label: 'Skype Handle', type: 'text' },
      { entity: 'publisher', key: 'telegram', label: 'Telegram', type: 'text' },
      { entity: 'publisher', key: 'company_reg_no', label: 'Company Reg. No.', type: 'text' },
      { entity: 'publisher', key: 'incentive_traffic', label: 'Runs Incentive Traffic', type: 'boolean' },
      { entity: 'publisher', key: 'payout_tier', label: 'Payout Tier', type: 'select', options: ['Standard', 'Preferred', 'Strategic'] },
      { entity: 'advertiser', key: 'im_platform', label: 'IM Platform', type: 'select', options: ['Slack', 'Skype', 'Telegram', 'Email only'] },
      { entity: 'advertiser', key: 'billing_contact', label: 'Billing Contact', type: 'text' },
      { entity: 'advertiser', key: 'vat_number', label: 'VAT Number', type: 'text' },
      { entity: 'advertiser', key: 'auto_approve_partners', label: 'Auto-approve Partners', type: 'boolean' },
    ];
    for (let i = 0; i < CUSTOM_FIELDS.length; i++) {
      const f = CUSTOM_FIELDS[i]!;
      await db.query(
        `INSERT INTO custom_field_defs (network_id, entity_type, key, label, field_type, options, required, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (network_id, entity_type, lower(key)) DO NOTHING`,
        [netId, f.entity, f.key, f.label, f.type, f.options ?? [], i % 4 === 0, i]);
    }

    // ═══ 10. Custom Metrics (Reporting › Custom Metrics) ═════════════════════════════════
    const CUSTOM_METRICS = [
      { name: 'Profit', format: 'currency', formula: [{ type: 'metric', key: 'revenue' }, { type: 'op', value: '-' }, { type: 'metric', key: 'payout' }] },
      { name: 'Margin %', format: 'percentage', formula: [{ type: 'metric', key: 'margin' }, { type: 'op', value: '/' }, { type: 'metric', key: 'revenue' }] },
      { name: 'EPC', format: 'currency', formula: [{ type: 'metric', key: 'revenue' }, { type: 'op', value: '/' }, { type: 'metric', key: 'clicks' }] },
      { name: 'Approval Rate', format: 'percentage', formula: [{ type: 'metric', key: 'conversions' }, { type: 'op', value: '/' }, { type: 'metric', key: 'total_conversions' }] },
      { name: 'Effective CPC', format: 'currency', formula: [{ type: 'metric', key: 'payout' }, { type: 'op', value: '/' }, { type: 'metric', key: 'clicks' }] },
    ];
    for (const m of CUSTOM_METRICS) {
      await db.query(
        `INSERT INTO custom_metrics (network_id, name, formula, format) VALUES ($1,$2,$3::jsonb,$4)`,
        [netId, m.name, JSON.stringify(m.formula), m.format]);
    }

    // ═══ 11. Offer Creatives (Offers › Creatives) ═══════════════════════════════════════
    const CREATIVE_LANGS = ['en', 'en', 'de', 'fr', 'es'];
    for (let i = 0; i < Math.min(offers.length, 6); i++) {
      const o = offers[i]!;
      const perOffer = 2 + (i % 3);
      for (let c = 0; c < perOffer; c++) {
        const type = pick(['image', 'image', 'html', 'link', 'email'], i + c);
        await db.query(
          `INSERT INTO offer_creatives (network_id, offer_id, name, type, url, html, width, height, language, status, visible_to_partners, email_from, email_subject)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            netId, o.id,
            `${o.name.slice(0, 28)} — ${type} ${c + 1}`,
            type,
            type === 'html' ? null : `https://cdn.demo.test/creatives/${o.id.slice(0, 8)}/${type}-${c + 1}.${type === 'image' ? 'jpg' : type === 'email' ? 'html' : 'png'}`,
            type === 'html' ? `<a href="{tracking_link}"><img src="https://cdn.demo.test/c/${o.id.slice(0, 8)}-${c}.jpg" /></a>` : null,
            type === 'image' || type === 'html' ? pick([300, 728, 160, 320], c) : null,
            type === 'image' || type === 'html' ? pick([250, 90, 600, 50], c) : null,
            pick(CREATIVE_LANGS, i + c),
            pick(['active', 'active', 'active', 'paused'], i + c),
            c % 4 !== 3,
            type === 'email' ? 'promo@demo.test' : null,
            type === 'email' ? `Limited time: ${o.name.slice(0, 32)}` : null,
          ]);
      }
    }

    // ═══ 12. Offer Templates (Offers › Templates) ═══════════════════════════════════════
    // Keys MUST match the frontend field catalog (data/offerTemplateFields.ts → useFieldSpecs),
    // which is also the OfferCreate form-state shape — that's what "Use Template" / "Add Offer from
    // Template" merge into. Only these 8 keys are templatable.
    const TEMPLATES = [
      {
        name: 'CPA Lead-Gen Default', def: true,
        values: {
          advertiserId: advertisers[0]!.id, category: 'Finance', visibility: 'public',
          destinationUrl: 'https://lp.demo-lead.test/start?cid={click_id}',
          currency: 'USD', payoutModel: 'CPA', defaultPayout: '12.0000', defaultRevenue: '20.0000',
        },
      },
      {
        name: 'App Install (CPI)', def: false,
        values: {
          category: 'Gaming', visibility: 'public',
          currency: 'USD', payoutModel: 'CPI', defaultPayout: '2.5000', defaultRevenue: '4.0000',
        },
      },
      {
        name: 'RevShare Subscription', def: false,
        values: {
          category: 'Streaming & Software', visibility: 'ask',
          currency: 'USD', payoutModel: 'RevShare', defaultPayout: '30.0000', defaultRevenue: '45.0000',
        },
      },
    ];
    for (const t of TEMPLATES) {
      await db.query(
        `INSERT INTO offer_templates (network_id, name, is_default, offer_fields, field_values)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [netId, t.name, t.def, JSON.stringify(Object.keys(t.values)), JSON.stringify(t.values)]);
    }

    // ═══ 13. Offer Goals + Deals (Offer detail sub-tabs) ═══════════════════════════════
    for (let i = 0; i < Math.min(offers.length, 6); i++) {
      const o = offers[i]!;
      await db.query(
        `INSERT INTO offer_goals (network_id, offer_id, name, event_name, payout_model, payout, revenue, currency, daily_conversion_cap, total_conversion_cap, is_default, status, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'active',0)`,
        [netId, o.id, 'Primary Conversion', pick(['purchase', 'signup', 'install', 'lead'], i), pick(['CPA', 'CPL', 'CPI'], i),
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

    // ═══ 14. Smart Links (+ SmartSwitch) ═══════════════════════════════════════════════
    // Deliberately varied so the Manage Smart Links filter drawer has something to bite on:
    // every mechanism, both Show-to-Partners values, catch-all present + absent, two tracking
    // domains, an active + a paused link.
    const SMART_LINKS: {
      name: string; mech: 'weight' | 'priority' | 'kpi'; labels: string | null;
      status: 'active' | 'paused'; showToPartners: boolean; catchAll: boolean; host: string;
    }[] = [
      { name: 'US Nutrition Rotator', mech: 'weight', labels: 'nutrition,us', status: 'active', showToPartners: true, catchAll: true, host: 'demo.ourtracking.com' },
      { name: 'EU Finance Priority', mech: 'priority', labels: 'finance,eu', status: 'active', showToPartners: false, catchAll: true, host: 'demo.ourtracking.com' },
      { name: 'Global Gaming KPI', mech: 'kpi', labels: 'gaming', status: 'active', showToPartners: true, catchAll: true, host: 'demo.ourtracking.com' },
      { name: 'Catch-All Fallback', mech: 'weight', labels: null, status: 'paused', showToPartners: false, catchAll: true, host: 'demo.ourtracking.com' },
      { name: 'US Direct (no fallback)', mech: 'weight', labels: 'direct,us', status: 'active', showToPartners: true, catchAll: false, host: 'localhost' },
      { name: 'APAC Priority Split', mech: 'priority', labels: 'apac', status: 'active', showToPartners: false, catchAll: true, host: 'localhost' },
    ];
    for (let s = 0; s < SMART_LINKS.length; s++) {
      const sl = SMART_LINKS[s]!;
      const items = offers.slice(s, s + 4).length >= 2 ? offers.slice(s, s + 4) : offers.slice(0, 4);
      const row = (await db.query<{ id: string }>(
        `INSERT INTO smart_links (network_id, name, status, redirect_mechanism, catch_all_offer_id, labels, force_ssl, show_to_partners, tracking_domain_id,
           kpi_run_frequency_hours, kpi_lookback_hours, kpi_metric, kpi_min_clicks)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          netId, sl.name, sl.status, sl.mech,
          sl.catchAll ? items[items.length - 1]!.id : null, sl.labels, sl.showToPartners, dom(sl.host),
          sl.mech === 'kpi' ? 24 : null, sl.mech === 'kpi' ? 168 : null, sl.mech === 'kpi' ? 'epc' : null, sl.mech === 'kpi' ? 100 : null,
        ])).rows[0]!;
      for (let it = 0; it < items.length; it++) {
        await db.query(
          `INSERT INTO smart_link_items (network_id, smart_link_id, offer_id, weight, country, offer_url, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [netId, row.id, items[it]!.id, sl.mech === 'weight' ? (it + 1) * 10 : 1,
            pick([null, 'US', 'GB', 'DE'], it), null, it]);
      }
    }
    const SWITCH_RULES = [
      { name: 'Pause on low EPC', action: 'notify', variable: 'epc' },
      { name: 'Block offers over cap', action: 'block', variable: 'daily_cap' },
    ];
    for (const r of SWITCH_RULES) {
      await db.query(
        `INSERT INTO smartswitch_rules (network_id, name, action, action_delay, variable, actionable_variables, offer_ids, advertiser_ids, partner_ids, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'active')`,
        [netId, r.name, r.action, '1h', r.variable, null,
          JSON.stringify(offers.slice(0, 3).map((o) => o.id)), '[]', '[]']);
    }

    // ═══ 15. Customer Value (data points / rules / firings) ════════════════════════════
    const DATA_POINTS = [
      { name: 'Order Value', data_type: 'number', parameter_key: 'order_value' },
      { name: 'Customer Tier', data_type: 'text', parameter_key: 'customer_tier' },
      { name: 'LTV 90d', data_type: 'number', parameter_key: 'ltv_90d' },
      { name: 'Subscription Plan', data_type: 'text', parameter_key: 'sub_plan' },
      { name: 'Repeat Purchase Count', data_type: 'number', parameter_key: 'repeat_count' },
    ];
    for (const d of DATA_POINTS) {
      await db.query(
        `INSERT INTO customer_data_points (network_id, name, data_type, parameter_key) VALUES ($1,$2,$3,$4)
         ON CONFLICT (network_id, parameter_key) DO NOTHING`,
        [netId, d.name, d.data_type, d.parameter_key]);
    }
    const CV_RULES = [
      { name: 'High-LTV Payout Bump', grouping: 'all_together', cycle: 'continuous', cont: 'from_first_conversion', days: 90, payout: '5.0000', revenue: null },
      { name: 'VIP Tier Bonus', grouping: 'separately_by', cycle: 'recurring', dur: 'monthly', payout: '10.0000', revenue: '15.0000' },
      { name: 'Repeat Buyer Reward', grouping: 'all_together', cycle: 'continuous', cont: 'for_rule_duration', days: 30, payout: '3.5000', revenue: null },
      { name: 'Subscription Upgrade', grouping: 'all_together', cycle: 'recurring', dur: 'quarterly', payout: null, revenue: '20.0000' },
    ];
    const cvRuleIds: string[] = [];
    for (let i = 0; i < CV_RULES.length; i++) {
      const r = CV_RULES[i]!;
      const row = (await db.query<{ id: string }>(
        `INSERT INTO customer_value_rules
           (network_id, name, status, conversion_event_grouping, apply_offers_mode, apply_partners_mode, apply_advertisers_mode,
            start_date, end_date, goal_cycle, recurring_duration, continuous_mode, continuous_days, set_goal_conditions,
            conditions, outcome_frequency, payout_value, revenue_value)
         VALUES ($1,$2,$3,$4,'all','all','all',$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) RETURNING id`,
        [
          netId, r.name, i % 4 === 3 ? 'inactive' : 'active', r.grouping,
          daysAgo(45), r.cycle === 'recurring' ? daysAhead(60) : null,
          r.cycle, 'dur' in r ? r.dur : null, 'cont' in r ? r.cont : null, 'days' in r ? r.days : null,
          i % 2 === 0, JSON.stringify(i % 2 === 0 ? [{ dataPoint: 'order_value', operator: 'greater_than', value: '100' }] : []),
          i % 2 === 0 ? 'once_per_customer' : 'every_cycle',
          r.payout, r.revenue,
        ])).rows[0]!;
      cvRuleIds.push(row.id);
    }
    for (let i = 0; i < Math.min(convIds.length, 16); i++) {
      await db.query(
        `INSERT INTO customer_value_rule_firings (network_id, rule_id, user_id, conversion_id, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [netId, pick(cvRuleIds, i), `cust_${1000 + i}`, convIds[i], daysAgo(i + 1)]);
    }

    // ═══ 16. Communication Hub (templates / audiences / messages / banners) ═══════════
    const EMAIL_TEMPLATES = [
      { name: 'New Offer Announcement', type: 'offer_details', subject: 'New offer live: {offer_name}' },
      { name: 'Monthly Partner Newsletter', type: 'general', subject: 'Your {month} performance recap' },
      { name: 'Payout Processed', type: 'general', subject: 'Your payout of {amount} is on the way' },
      { name: 'Compliance Reminder', type: 'general', subject: 'Action needed: creative approval' },
    ];
    for (const t of EMAIL_TEMPLATES) {
      await db.query(
        `INSERT INTO email_templates (network_id, name, message_type, subject, body)
         VALUES ($1,$2,$3,$4,$5)`,
        [netId, t.name, t.type, t.subject, `<p>Hi {partner_name},</p><p>${t.subject}</p><p>— The Team</p>`]);
    }
    const AUDIENCES = [
      { name: 'All Active Partners', group_type: 'publishers', status_filter: ['active'] },
      { name: 'Pending Partners', group_type: 'publishers', status_filter: ['pending'] },
      { name: 'All Advertisers', group_type: 'advertisers', status_filter: ['active'] },
    ];
    const audIds: string[] = [];
    for (const a of AUDIENCES) {
      const row = (await db.query<{ id: string }>(
        `INSERT INTO audiences (network_id, name, group_type, status_filter, tier_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [netId, a.name, a.group_type, a.status_filter, null])).rows[0]!;
      audIds.push(row.id);
    }
    for (let i = 0; i < 5; i++) {
      const status = pick(['sent', 'sent', 'draft', 'scheduled', 'sent'], i);
      await db.query(
        `INSERT INTO email_messages (network_id, subject, body, message_type, audience_id, status, scheduled_at, sent_at, recipient_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          netId,
          pick(['October offers roundup', 'Payout schedule update', 'New compliance policy', 'Holiday season prep', 'Top partner spotlight'], i),
          '<p>Full message body here.</p>',
          i % 3 === 0 ? 'offer_details' : 'general',
          pick(audIds, i),
          status,
          status === 'scheduled' ? daysAhead(3) : null,
          status === 'sent' ? daysAgo(i + 2) : null,
          status === 'sent' ? 40 + i * 7 : 0,
        ]);
    }
    const BANNERS = [
      { name: 'Scheduled maintenance notice', message: 'Reporting will be briefly unavailable Sat 02:00–03:00 UTC.', priority: 'high', status: 'published' },
      { name: 'New payout method live', message: 'Payoneer is now available under Settings → Billing.', priority: 'default', status: 'published' },
      { name: 'Q1 kickoff webinar', message: 'Join our Q1 partner webinar — link in your inbox.', priority: 'default', status: 'scheduled' },
    ];
    for (let i = 0; i < BANNERS.length; i++) {
      const b = BANNERS[i]!;
      await db.query(
        `INSERT INTO banners (network_id, name, message, priority, status, publish_at, expire_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [netId, b.name, b.message, b.priority, b.status,
          b.status === 'scheduled' ? daysAhead(2) : daysAgo(3), daysAhead(14 + i * 7)]);
    }

    // ═══ 17. Advertiser Link Templates (Advertisers › Link Templates) ════════════════
    for (let i = 0; i < 5; i++) {
      const adv = advertisers[i % advertisers.length]!;
      await db.query(
        `INSERT INTO advertiser_link_templates (network_id, advertiser_id, name, destination_url)
         VALUES ($1,$2,$3,$4)`,
        [netId, adv.id, `${adv.name} — standard deep link`,
          `https://lp.${adv.name.toLowerCase().replace(/[^a-z]+/g, '')}.test/{offer_slug}?cid={click_id}&aff={affiliate_id}&s1={sub1}`]);
    }

    // ═══ 18. Advertiser Postback Controls (Advertisers › Postback Controls) ═════════
    for (let i = 0; i < 5; i++) {
      const ct = pick(['accept', 'reject', 'hold'] as const, i);
      const targetType = i % 2 === 0 ? 'offer' : 'advertiser';
      const targetIds = targetType === 'offer' ? [offers[i % offers.length]!.id] : [advertisers[i % advertisers.length]!.id];
      await db.query(
        `INSERT INTO advertiser_postback_controls (network_id, name, status, control_type, target_type, target_ids, partner_ids, condition_logic, rules, effective_start, effective_end)
         VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],$8,$9::jsonb,$10,$11)`,
        [
          netId,
          pick(['Reject empty event', 'Hold high-payout conversions', 'Accept verified only', 'Reject datacenter IPs', 'Hold new-partner traffic'], i),
          i % 4 === 3 ? 'inactive' : 'active', ct, targetType, targetIds, [],
          i % 2 === 0 ? 'all' : 'any',
          JSON.stringify([{ variable: pick(['event', 'payout', 'sub1'], i), operator: pick(['equals', 'greater_than', 'is_empty'], i), value: pick(['', '50', 'test'], i) }]),
          i % 3 === 0 ? null : daysAgo(20), i % 3 === 0 ? null : daysAhead(40),
        ]);
    }

    // ═══ 19. Advertiser Tiered Commissions (Advertisers › Tiered Commissions) ═══════
    for (let i = 0; i < 5; i++) {
      const targetType = i % 2 === 0 ? 'advertiser' : 'offer';
      const targetIds = targetType === 'advertiser' ? [advertisers[i % advertisers.length]!.id] : [offers[i % offers.length]!.id];
      await db.query(
        `INSERT INTO advertiser_tiered_commissions
           (network_id, name, status, notes, effective_start, effective_end, target_type, target_ids, partner_ids, time_period,
            retroactive_mode, goals, payout_enabled, payout_action, payout_value, revenue_enabled, revenue_action, revenue_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9::uuid[],$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)`,
        [
          netId,
          pick(['Volume bonus — monthly', 'Q-end revenue accelerator', 'Weekly conversion tiers', 'Global lifetime tiers', 'Daily push incentive'], i),
          i % 4 === 3 ? 'inactive' : 'active',
          i % 2 === 0 ? 'Auto-applied at period close' : null,
          daysAgo(30).toISOString(), daysAhead(60).toISOString(),
          targetType, targetIds, [],
          pick(['daily', 'weekly', 'monthly', 'quarterly', 'global'] as const, i),
          pick(['disabled', 'enabled', 'custom'] as const, i),
          JSON.stringify([
            { variable: pick(['conversion', 'total_payout', 'total_revenue'] as const, i), minValue: 0, maxValue: 100 },
            { variable: pick(['conversion', 'total_payout', 'total_revenue'] as const, i), minValue: 100, maxValue: null },
          ]),
          true, pick(['increase_flat', 'increase_pct', 'decrease_flat', 'decrease_pct'] as const, i), money(2 + i),
          i % 2 === 0, i % 2 === 0 ? pick(['increase_pct', 'increase_flat'] as const, i) : null, i % 2 === 0 ? money(3 + i) : null,
        ]);
    }

    // ═══ 20. Fraud Rules (Fraud config) ══════════════════════════════════════════════
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

    // ═══ 21. API Keys (Settings › API Keys) ═════════════════════════════════════════
    // Network keys are listed per logged-in admin, so give every admin user one; plus a couple of
    // portal-scoped keys owned by a real advertiser / publisher.
    const crypto = await import('node:crypto');
    const primaryAdminAuthId = signInAdmins[0]?.auth_user_id ?? admin.id;
    const API_KEYS: { audience: 'network' | 'advertiser' | 'publisher'; name: string; owner: string; scopes: string[]; revoked?: boolean }[] = [
      ...signInAdmins.map((u, k) => ({
        audience: 'network' as const,
        name: k === 0 ? 'Reporting ETL' : `${u.name} personal key`,
        owner: u.auth_user_id!,
        scopes: ['reports:read', 'offers:read', 'conversions:read'],
      })),
      { audience: 'network', name: 'CI smoke tests', owner: primaryAdminAuthId, scopes: ['offers:read'], revoked: true },
      { audience: 'advertiser', name: `${advertisers[0]!.name} S2S`, owner: advertisers[0]!.id, scopes: ['conversions:write', 'reports:read'] },
      { audience: 'publisher', name: `${publishers[0]!.name} pull API`, owner: publishers[0]!.id, scopes: ['reports:read', 'offers:read'] },
    ];
    for (let i = 0; i < API_KEYS.length; i++) {
      const k = API_KEYS[i]!;
      const secret = crypto.randomBytes(24).toString('hex');
      const prefix = `tk_${k.audience.slice(0, 3)}_${crypto.randomBytes(4).toString('hex')}`;
      await db.query(
        `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, name, scopes, status, rate_limit_tier, last_used_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'default',$9,'seed-rich-modules')`,
        [netId, k.audience, k.owner, prefix, crypto.createHash('sha256').update(secret).digest('hex'),
          k.name, k.scopes, k.revoked ? 'revoked' : 'active', i % 2 === 0 ? daysAgo(i + 1) : null]);
    }

    // ═══ 22. Marketplace Profile (Marketplace › Profile) ═══════════════════════════
    await db.query(
      `INSERT INTO marketplace_profiles
         (network_id, name, description, categories_mode, categories, conversion_funnel_expertise, promotional_methods,
          payout_types_accepted, device_types_covered, geolocations_mode, geolocations, website_url,
          contact_share_publicly, contact_first_name, contact_last_name, contact_email, social_linkedin, require_default_offer)
       VALUES ($1,$2,$3,'targeted',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,'specific',$9::jsonb,$10,true,$11,$12,$13,$14,false)
       ON CONFLICT (network_id) DO UPDATE SET description = EXCLUDED.description, updated_at = now()`,
      [
        netId, 'Demo Network', 'A boutique performance network across nutrition, finance and gaming verticals.',
        JSON.stringify(['Health & Wellness (General)', 'Financial Growth & Investments', 'Entertainment & Gaming']),
        JSON.stringify(['Single Step', 'Free Trial', 'Subscription']),
        JSON.stringify(['Email', 'Social Media', 'Native Ads', 'Search']),
        JSON.stringify(['Cost Per Action', 'Cost Per Lead', 'Revenue Share']),
        JSON.stringify(['PC', 'Mobile', 'Tablet']),
        JSON.stringify(['US', 'GB', 'CA', 'DE', 'AU']),
        'https://demo-network.test', 'Alex', 'Rivera', 'partners@demo-network.test', 'https://linkedin.com/company/demo-network',
      ]);

    // ═══ 23. Reporting Adjustments (Partners › Adjustments) ════════════════════════
    for (let i = 0; i < 4; i++) {
      const from = daysAgo(10 + i * 3);
      const to = daysAgo(7 + i * 3);
      await db.query(
        `INSERT INTO reporting_adjustments (network_id, publisher_id, offer_id, date_from, date_to, days, last_modified_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          netId, publishers[i % publishers.length]!.id, offers[i % offers.length]!.id,
          from, to,
          JSON.stringify([
            { date: from.toISOString().slice(0, 10), revenue: 120 + i * 10, payout: 80 + i * 5, notes: 'Advertiser-confirmed correction' },
            { date: to.toISOString().slice(0, 10), conversions: 5 + i, grossSales: 6 + i },
          ]),
          admin.id,
        ]);
    }

    await db.query('COMMIT');

    // ── summary ──────────────────────────────────────────────────────────────────────────────
    const c = async (t: string, extra = '') => Number((await db.query<{ n: string }>(
      `SELECT count(*) n FROM ${t} WHERE network_id = $1 ${extra}`, [netId])).rows[0]!.n);
    const summary = {
      partner_tiers: await c('partner_tiers'),
      partner_tier_members: await c('partner_tier_members'),
      partner_tier_offers: await c('partner_tier_offers'),
      questionnaires: await c('questionnaires'),
      questionnaire_fields: await c('questionnaire_fields'),
      offers_with_questionnaire: await c('offers', `AND questionnaire_id IS NOT NULL`),
      pending_applications: await c('offer_publisher_access', `AND approval_status = 'pending'`),
      publisher_postbacks: await c('publisher_postbacks'),
      traffic_blockings: await c('traffic_blockings'),
      traffic_sources: await c('traffic_sources'),
      traffic_controls: await c('traffic_controls'),
      offer_coupons: await c('offer_coupons'),
      partner_invoices: await c('partner_invoices'),
      advertiser_invoices: await c('advertiser_invoices'),
      custom_field_defs: await c('custom_field_defs'),
      custom_metrics: await c('custom_metrics'),
      offer_creatives: await c('offer_creatives'),
      offer_templates: await c('offer_templates'),
      offer_goals: await c('offer_goals'),
      offer_deals: await c('offer_deals'),
      smart_links: await c('smart_links'),
      smart_link_items: await c('smart_link_items'),
      smartswitch_rules: await c('smartswitch_rules'),
      customer_data_points: await c('customer_data_points'),
      customer_value_rules: await c('customer_value_rules'),
      customer_value_rule_firings: await c('customer_value_rule_firings'),
      email_templates: await c('email_templates'),
      audiences: await c('audiences'),
      email_messages: await c('email_messages'),
      banners: await c('banners'),
      advertiser_link_templates: await c('advertiser_link_templates'),
      advertiser_postback_controls: await c('advertiser_postback_controls'),
      advertiser_tiered_commissions: await c('advertiser_tiered_commissions'),
      fraud_rules: await c('fraud_rules'),
      api_keys: await c('api_keys'),
      marketplace_profiles: await c('marketplace_profiles'),
      reporting_adjustments: await c('reporting_adjustments'),
    };
    // eslint-disable-next-line no-console
    console.log('seed-rich-modules OK — demo network module data:\n' + JSON.stringify(summary, null, 2));
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
    console.error('seed-rich-modules failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
