/**
 * Comprehensive demo data for local / staging exploration. Idempotent — safe to re-run.
 * Enriches the demo network (slug `demo`) with sample rows across dashboard modules so every
 * feature has something to show. Also seeds synthetic clicks/conversions/ledger when traffic
 * is sparse (works on hosted Supabase — unlike gen-traffic.ts which fires the tracking API).
 *
 * Prereqs: migrated DB + `npm run seed` (creates the demo network skeleton).
 *
 *   npm run seed:demo              # entities + traffic if needed
 *   npm run seed:demo -- --no-traffic   # skip click/conversion generation
 */
import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query, closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

const SLUG = 'demo';
const TRAFFIC_MARKER = 'seed-demo-data';

type Client = PoolClient;

async function findNetwork(): Promise<{ id: string }> {
  const demo = await query<{ id: string }>(`SELECT id FROM networks WHERE slug = $1`, [SLUG]);
  if (demo.rows[0]) return demo.rows[0];
  const any = await query<{ id: string }>(`SELECT id FROM networks ORDER BY created_at LIMIT 1`);
  if (!any.rows[0]) throw new Error('No network found — run `npm run seed` first');
  logger.warn('demo slug not found — using first network');
  return any.rows[0];
}

async function idByName(c: Client, table: string, networkId: string, name: string): Promise<string | null> {
  const r = await c.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE network_id = $1 AND name = $2 LIMIT 1`,
    [networkId, name],
  );
  return r.rows[0]?.id ?? null;
}

async function ensureAdvertiser(
  c: Client, networkId: string,
  spec: { name: string; status: string; contactEmail?: string; billingTerms?: string },
): Promise<string> {
  const existing = await idByName(c, 'advertisers', networkId, spec.name);
  if (existing) {
    await c.query(
      `UPDATE advertisers SET status = $2, contact_email = COALESCE($3, contact_email),
              billing_terms = COALESCE($4, billing_terms) WHERE id = $1`,
      [existing, spec.status, spec.contactEmail ?? null, spec.billingTerms ?? null],
    );
    return existing;
  }
  const r = await c.query<{ id: string }>(
    `INSERT INTO advertisers (network_id, name, status, contact_email, billing_terms, default_currency)
     VALUES ($1,$2,$3,$4,$5,'USD') RETURNING id`,
    [networkId, spec.name, spec.status, spec.contactEmail ?? null, spec.billingTerms ?? null],
  );
  return r.rows[0]!.id;
}

async function ensurePublisher(
  c: Client, networkId: string,
  spec: { name: string; status: string; contactEmail?: string; trafficSource?: string },
): Promise<string> {
  const existing = await idByName(c, 'publishers', networkId, spec.name);
  if (existing) {
    await c.query(
      `UPDATE publishers SET status = $2, contact_email = COALESCE($3, contact_email),
              traffic_source = COALESCE($4, traffic_source) WHERE id = $1`,
      [existing, spec.status, spec.contactEmail ?? null, spec.trafficSource ?? null],
    );
    return existing;
  }
  const r = await c.query<{ id: string }>(
    `INSERT INTO publishers (network_id, name, status, contact_email, traffic_source)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [networkId, spec.name, spec.status, spec.contactEmail ?? null, spec.trafficSource ?? null],
  );
  return r.rows[0]!.id;
}

async function ensureOffer(
  c: Client, networkId: string, advertiserId: string,
  spec: {
    name: string; status: string; category: string; payoutModel: string;
    payout: number; revenue: number; visibility?: string; objective?: string;
  },
): Promise<string> {
  const existing = await idByName(c, 'offers', networkId, spec.name);
  if (existing) {
    await c.query(
      `UPDATE offers SET status = $2, category = $3, payout_model = $4,
              default_payout = $5, default_revenue = $6, visibility = COALESCE($7, visibility)
       WHERE id = $1`,
      [existing, spec.status, spec.category, spec.payoutModel, spec.payout, spec.revenue, spec.visibility ?? 'public'],
    );
    return existing;
  }
  const r = await c.query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, payout_model,
       default_payout, default_revenue, currency, category, visibility, objective, preview_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12) RETURNING id`,
    [
      networkId, advertiserId, spec.name, spec.status,
      `https://landing.test/${spec.name.toLowerCase().replace(/\s+/g, '-')}?cid={click_id}&sub1={sub1}`,
      spec.payoutModel, spec.payout, spec.revenue, spec.category,
      spec.visibility ?? 'public', spec.objective ?? 'conversions',
      `https://preview.test/${spec.name.toLowerCase().replace(/\s+/g, '-')}`,
    ],
  );
  return r.rows[0]!.id;
}

async function ensureGeoRule(c: Client, networkId: string, offerId: string, country: string): Promise<void> {
  await c.query(
    `INSERT INTO offer_geo_rules (network_id, offer_id, country, action)
     VALUES ($1,$2,$3,'allow') ON CONFLICT DO NOTHING`,
    [networkId, offerId, country],
  );
}

async function ensureAccess(
  c: Client, networkId: string, offerId: string, publisherId: string,
  approval: 'approved' | 'pending' | 'rejected',
): Promise<void> {
  await c.query(
    `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
     VALUES ($1,$2,$3,'allow',$4)
     ON CONFLICT (offer_id, publisher_id) DO UPDATE SET approval_status = EXCLUDED.approval_status`,
    [networkId, offerId, publisherId, approval],
  );
}

async function ensureNamedRow(
  c: Client, table: string, networkId: string, name: string, insertSql: string, params: unknown[],
): Promise<string> {
  const existing = await idByName(c, table, networkId, name);
  if (existing) return existing;
  const r = await c.query<{ id: string }>(insertSql, params);
  return r.rows[0]!.id;
}

async function seedEntities(c: Client, networkId: string): Promise<{ offerIds: string[]; pubIds: string[]; advIds: Record<string, string> }> {
  const advIds = {
    acme: await ensureAdvertiser(c, networkId, { name: 'Acme Corp', status: 'active', contactEmail: 'advertiser@test.com', billingTerms: 'Net-30' }),
    newco: await ensureAdvertiser(c, networkId, { name: 'NewCo Ltd', status: 'active', contactEmail: 'sales@newco.test' }),
    testing: await ensureAdvertiser(c, networkId, { name: 'TESTING', status: 'active' }),
    financeFlow: await ensureAdvertiser(c, networkId, { name: 'FinanceFlow', status: 'pending', contactEmail: 'apply@financeflow.test' }),
    globalAds: await ensureAdvertiser(c, networkId, { name: 'GlobalAds', status: 'pending', contactEmail: 'partner@globalads.test' }),
    sunset: await ensureAdvertiser(c, networkId, { name: 'Sunset Media', status: 'inactive' }),
  };

  const pubIds = {
    trafficCo: await ensurePublisher(c, networkId, { name: 'TrafficCo', status: 'active', contactEmail: 'pub@trafficco.test', trafficSource: 'Paid Search' }),
    mediaBuyers: await ensurePublisher(c, networkId, { name: 'MediaBuyers', status: 'pending', contactEmail: 'buy@media.test' }),
    clickMasters: await ensurePublisher(c, networkId, { name: 'ClickMasters', status: 'active', contactEmail: 'ops@clickmasters.test', trafficSource: 'Native' }),
    affiliatePro: await ensurePublisher(c, networkId, { name: 'AffiliatePro', status: 'active', trafficSource: 'Social' }),
    beta: await ensurePublisher(c, networkId, { name: 'BetaPartners', status: 'inactive' }),
  };

  const offerSpecs = [
    { key: 'acmeUs', adv: advIds.acme, name: 'Acme US CPA', category: 'Finance', payoutModel: 'CPA', payout: 5, revenue: 8 },
    { key: 'acmeUk', adv: advIds.acme, name: 'Acme UK CPL', category: 'Finance', payoutModel: 'CPL', payout: 3, revenue: 5 },
    { key: 'newcoApp', adv: advIds.newco, name: 'NewCo App Install', category: 'Mobile Apps', payoutModel: 'CPI', payout: 2.5, revenue: 4 },
    { key: 'newcoLead', adv: advIds.newco, name: 'NewCo Lead Gen', category: 'Lead Gen', payoutModel: 'CPL', payout: 4, revenue: 6 },
    { key: 'testingRev', adv: advIds.testing, name: 'TESTING RevShare Offer', category: 'Gaming', payoutModel: 'RevShare', payout: 0, revenue: 0 },
    { key: 'financeLoan', adv: advIds.financeFlow, name: 'FinanceFlow Personal Loan', category: 'Finance', payoutModel: 'CPA', payout: 12, revenue: 18 },
    { key: 'globalShop', adv: advIds.globalAds, name: 'Global Shopping CPA', category: 'E-commerce', payoutModel: 'CPA', payout: 6, revenue: 10 },
    { key: 'sunsetPaused', adv: advIds.sunset, name: 'Sunset Legacy Offer', category: 'Uncategorized', payoutModel: 'CPA', payout: 1, revenue: 2, status: 'paused' as const },
    { key: 'gatedOffer', adv: advIds.acme, name: 'Acme Private Beta', category: 'Finance', payoutModel: 'CPA', payout: 7, revenue: 11, visibility: 'ask' as const },
  ] as const;

  const offerIds: Record<string, string> = {};
  for (const o of offerSpecs) {
    offerIds[o.key] = await ensureOffer(c, networkId, o.adv, {
      name: o.name,
      status: 'status' in o ? o.status : 'active',
      category: o.category,
      payoutModel: o.payoutModel,
      payout: o.payout,
      revenue: o.revenue,
      visibility: 'visibility' in o ? o.visibility : 'public',
    });
    await ensureGeoRule(c, networkId, offerIds[o.key]!, 'US');
    await ensureGeoRule(c, networkId, offerIds[o.key]!, 'GB');
  }

  // Access grants
  await ensureAccess(c, networkId, offerIds.acmeUs!, pubIds.trafficCo, 'approved');
  await ensureAccess(c, networkId, offerIds.acmeUs!, pubIds.clickMasters, 'approved');
  await ensureAccess(c, networkId, offerIds.acmeUk!, pubIds.trafficCo, 'approved');
  await ensureAccess(c, networkId, offerIds.newcoApp!, pubIds.affiliatePro, 'approved');
  await ensureAccess(c, networkId, offerIds.newcoLead!, pubIds.clickMasters, 'approved');
  await ensureAccess(c, networkId, offerIds.testingRev!, pubIds.trafficCo, 'approved');
  await ensureAccess(c, networkId, offerIds.gatedOffer!, pubIds.mediaBuyers, 'pending');
  await ensureAccess(c, networkId, offerIds.gatedOffer!, pubIds.affiliatePro, 'pending');

  // Multi-goal offer (Acme US CPA)
  const goalCheck = await c.query(`SELECT COUNT(*)::int AS n FROM offer_goals WHERE offer_id = $1`, [offerIds.acmeUs]);
  if ((goalCheck.rows[0]?.n ?? 0) === 0) {
    await c.query(
      `INSERT INTO offer_goals (network_id, offer_id, name, event_name, payout_model, payout, revenue, is_default, sort_order)
       VALUES ($1,$2,'Default Purchase',NULL,'CPA',5,8,true,0),
              ($1,$2,'Signup Bonus','signup','CPL',2,3,false,1),
              ($1,$2,'Lead Capture','lead','CPL',3,5,false,2)`,
      [networkId, offerIds.acmeUs],
    );
  }

  // Creatives, coupons, deals on Acme US
  await ensureNamedRow(c, 'offer_creatives', networkId, 'Acme Banner 728x90',
    `INSERT INTO offer_creatives (network_id, offer_id, name, type, url, width, height, status)
     VALUES ($1,$2,'Acme Banner 728x90','image','https://cdn.test/banners/acme-728.png',728,90,'active') RETURNING id`,
    [networkId, offerIds.acmeUs]);
  const couponCheck = await c.query(
    `SELECT 1 FROM offer_coupons WHERE offer_id = $1 AND lower(code) = 'acme20' LIMIT 1`, [offerIds.acmeUs],
  );
  if (couponCheck.rows.length === 0) {
    await c.query(
      `INSERT INTO offer_coupons (network_id, offer_id, code, description, discount, status)
       VALUES ($1,$2,'ACME20','20% off first order','20%','active')`,
      [networkId, offerIds.acmeUs],
    );
  }
  await ensureNamedRow(c, 'offer_deals', networkId, 'Holiday Boost',
    `INSERT INTO offer_deals (network_id, offer_id, name, description, deal_type, value, status)
     VALUES ($1,$2,'Holiday Boost','Q4 payout boost','payout_boost',1.5,'active') RETURNING id`,
    [networkId, offerIds.acmeUs]);

  // Tags
  const tagFinance = await ensureNamedRow(c, 'tags', networkId, 'Finance',
    `INSERT INTO tags (network_id, name, color) VALUES ($1,'Finance','#0d9488') RETURNING id`, [networkId]);
  const tagTop = await ensureNamedRow(c, 'tags', networkId, 'Top Performer',
    `INSERT INTO tags (network_id, name, color) VALUES ($1,'Top Performer','#6366f1') RETURNING id`, [networkId]);
  for (const [entityType, entityId] of [['offer', offerIds.acmeUs], ['publisher', pubIds.trafficCo], ['advertiser', advIds.acme]] as const) {
    await c.query(
      `INSERT INTO taggings (network_id, tag_id, entity_type, entity_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [networkId, entityType === 'offer' ? tagFinance : tagTop, entityType, entityId],
    );
  }

  // Marketplace profile
  const mp = await c.query(`SELECT id FROM marketplace_profiles WHERE network_id = $1`, [networkId]);
  if (mp.rows.length === 0) {
    await c.query(
      `INSERT INTO marketplace_profiles (network_id, name, description, logo_url, categories, payout_types_accepted,
         promotional_methods, device_types_covered, geolocations, website_url, contact_share_publicly,
         contact_first_name, contact_last_name, contact_email, social_linkedin)
       VALUES ($1,'Demo Network','Performance marketing network specializing in finance and mobile offers.',
         'https://api.dicebear.com/7.x/initials/svg?seed=DN',
         '["Finance","Mobile Apps","Lead Gen"]','["CPA","CPL","CPI"]',
         '["Email","Native","Social"]','["Desktop","Mobile","Tablet"]','["US","GB","CA"]',
         'https://demo-network.test',true,'Alex','Rivera','demo-admin@tracker.test','https://linkedin.com/company/demo-network')`,
      [networkId],
    );
  }

  // Publisher postbacks
  const pbCheck = await c.query(
    `SELECT 1 FROM publisher_postbacks WHERE network_id = $1 AND publisher_id = $2 LIMIT 1`,
    [networkId, pubIds.trafficCo],
  );
  if (pbCheck.rows.length === 0) {
    await c.query(
      `INSERT INTO publisher_postbacks (network_id, publisher_id, url, method, status)
       VALUES ($1,$2,'https://pub.trafficco.test/pb?cid={click_id}&payout={payout}&txn={txn_id}','GET','active')`,
      [networkId, pubIds.trafficCo],
    );
  }

  // Smart link
  const slId = await ensureNamedRow(c, 'smart_links', networkId, 'Finance Rotation',
    `INSERT INTO smart_links (network_id, name, redirect_mechanism, status, show_to_partners)
     VALUES ($1,'Finance Rotation','weight','active',true) RETURNING id`, [networkId]);
  const slItems = await c.query(`SELECT COUNT(*)::int AS n FROM smart_link_items WHERE smart_link_id = $1`, [slId]);
  if ((slItems.rows[0]?.n ?? 0) === 0) {
    await c.query(
      `INSERT INTO smart_link_items (network_id, smart_link_id, offer_id, weight, country)
       VALUES ($1,$2,$3,60,'US'), ($1,$2,$4,40,'US')`,
      [networkId, slId, offerIds.acmeUs, offerIds.acmeUk],
    );
  }

  // Offer template, group, traffic control, custom setting, smartswitch
  await ensureNamedRow(c, 'offer_templates', networkId, 'Standard CPA Template',
    `INSERT INTO offer_templates (network_id, name, is_default, offer_fields)
     VALUES ($1,'Standard CPA Template',true,'[]') RETURNING id`, [networkId]);
  const groupId = await ensureNamedRow(c, 'offer_groups', networkId, 'Acme Finance Bundle',
    `INSERT INTO offer_groups (network_id, name, advertiser_id, offer_ids, status)
     VALUES ($1,'Acme Finance Bundle',$2,$3,'active') RETURNING id`,
    [networkId, advIds.acme, JSON.stringify([offerIds.acmeUs, offerIds.acmeUk])]);
  void groupId;
  await ensureNamedRow(c, 'traffic_controls', networkId, 'Block Bad Sub1',
    `INSERT INTO traffic_controls (network_id, name, control_type, offer_ids, status)
     VALUES ($1,'Block Bad Sub1','blacklist',$2,'active') RETURNING id`,
    [networkId, JSON.stringify([offerIds.acmeUs])]);
  await ensureNamedRow(c, 'offer_custom_settings', networkId, 'US Payout Override',
    `INSERT INTO offer_custom_settings (network_id, category, name, offer_id, payout_value, status, description)
     VALUES ($1,'revenue_payout','US Payout Override',$2,6.0000,'active','Demo payout override for US traffic') RETURNING id`,
    [networkId, offerIds.acmeUs]);
  const ssId = await ensureNamedRow(c, 'smartswitch_rules', networkId, 'CR Spike Alert',
    `INSERT INTO smartswitch_rules (network_id, name, action, status, offer_ids)
     VALUES ($1,'CR Spike Alert','notify','active',$2) RETURNING id`,
    [networkId, JSON.stringify([offerIds.acmeUs])]);
  const ssHist = await c.query(`SELECT COUNT(*)::int AS n FROM smartswitch_history WHERE network_id = $1`, [networkId]);
  if ((ssHist.rows[0]?.n ?? 0) === 0) {
    await c.query(
      `INSERT INTO smartswitch_history (network_id, rule_id, rule_name, change, employee)
       VALUES ($1,$2,'CR Spike Alert','Rule created','Demo Admin')`,
      [networkId, ssId],
    );
  }

  // Partner tiers
  const tierId = await ensureNamedRow(c, 'partner_tiers', networkId, 'Gold Partners',
    `INSERT INTO partner_tiers (network_id, name, status, margin_pct, is_default, description)
     VALUES ($1,'Gold Partners','active',15,false,'Top-tier partners with 15% margin') RETURNING id`, [networkId]);
  const hasDefault = await c.query(
    `SELECT 1 FROM partner_tiers WHERE network_id = $1 AND is_default = true LIMIT 1`, [networkId],
  );
  if (hasDefault.rows.length === 0) {
    await ensureNamedRow(c, 'partner_tiers', networkId, 'New Partners',
      `INSERT INTO partner_tiers (network_id, name, status, margin_pct, is_default)
       VALUES ($1,'New Partners','active',25,true) RETURNING id`, [networkId]);
  } else {
    await ensureNamedRow(c, 'partner_tiers', networkId, 'New Partners',
      `INSERT INTO partner_tiers (network_id, name, status, margin_pct, is_default)
       VALUES ($1,'New Partners','active',25,false) RETURNING id`, [networkId]);
  }
  await c.query(
    `INSERT INTO partner_tier_members (network_id, tier_id, publisher_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [networkId, tierId, pubIds.trafficCo],
  );
  await c.query(
    `INSERT INTO partner_tier_offers (network_id, tier_id, offer_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [networkId, tierId, offerIds.acmeUs],
  );

  // Questionnaire + gated offer link
  const qId = await ensureNamedRow(c, 'questionnaires', networkId, 'Partner Onboarding',
    `INSERT INTO questionnaires (network_id, name, status) VALUES ($1,'Partner Onboarding','active') RETURNING id`, [networkId]);
  const qFields = await c.query(`SELECT COUNT(*)::int AS n FROM questionnaire_fields WHERE questionnaire_id = $1`, [qId]);
  if ((qFields.rows[0]?.n ?? 0) === 0) {
    await c.query(
      `INSERT INTO questionnaire_fields (network_id, questionnaire_id, position, label, required, data_field)
       VALUES ($1,$2,0,'Describe your traffic sources',true,'textarea'),
              ($1,$2,1,'Monthly volume estimate',true,'numeric_input')`,
      [networkId, qId],
    );
  }
  await c.query(`UPDATE offers SET questionnaire_id = $2 WHERE id = $1 AND questionnaire_id IS NULL`, [offerIds.gatedOffer, qId]);

  // Traffic sources & blocking
  await ensureNamedRow(c, 'traffic_sources', networkId, 'Facebook Preset',
    `INSERT INTO traffic_sources (network_id, name, enable_postback, postback_url, visible_to_partners, parameters)
     VALUES ($1,'Facebook Preset',true,'https://fb.test/pb?cid={click_id}','true','[{"name":"utm_source","value":"facebook"}]') RETURNING id`, [networkId]);
  await c.query(
    `INSERT INTO traffic_blockings (network_id, publisher_id, offer_id, status, filters)
     SELECT $1,$2,$3,'active','{"sub1":{"matchType":"contains","value":"blocked"}}'
     WHERE NOT EXISTS (SELECT 1 FROM traffic_blockings WHERE network_id = $1 AND publisher_id = $2 AND offer_id = $3)`,
    [networkId, pubIds.clickMasters, offerIds.newcoApp],
  );

  // Custom fields + metrics
  await c.query(
    `INSERT INTO custom_field_defs (network_id, entity_type, key, label, field_type, sort_order)
     SELECT $1,'publisher','skype_id','Skype ID','text',0 WHERE NOT EXISTS (
       SELECT 1 FROM custom_field_defs WHERE network_id = $1 AND entity_type = 'publisher' AND lower(key) = 'skype_id')`,
    [networkId],
  );
  await ensureNamedRow(c, 'custom_metrics', networkId, 'Profit Margin',
    `INSERT INTO custom_metrics (network_id, name, formula, format)
     VALUES ($1,'Profit Margin','[{"type":"op","value":"("},{"type":"metric","key":"revenue"},{"type":"op","value":"-"},{"type":"metric","key":"payout"},{"type":"op","value":")"},{"type":"op","value":"/"},{"type":"metric","key":"revenue"}]','percentage') RETURNING id`, [networkId]);

  // Postback controls & tiered commissions
  await ensureNamedRow(c, 'advertiser_postback_controls', networkId, 'Auto-reject low payout',
    `INSERT INTO advertiser_postback_controls (network_id, name, status, control_type, target_type, target_ids, rules)
     VALUES ($1,'Auto-reject low payout','active','reject','advertiser',$2,'[{"variable":"payout","operator":"less_than","value":"1"}]') RETURNING id`,
    [networkId, [advIds.acme]]);
  await ensureNamedRow(c, 'advertiser_tiered_commissions', networkId, 'Acme Volume Bonus',
    `INSERT INTO advertiser_tiered_commissions (network_id, name, status, target_type, target_ids, time_period,
       payout_enabled, payout_action, payout_value, goals)
     VALUES ($1,'Acme Volume Bonus','active','advertiser',$2,'monthly',true,'increase_flat',1.0000,
       '[{"variable":"conversions","minValue":100,"maxValue":null}]') RETURNING id`,
    [networkId, [advIds.acme]]);

  // Invoices (sample snapshots)
  const periodStart = '2026-08-01';
  const periodEnd = '2026-08-31';
  await c.query(
    `INSERT INTO partner_invoices (network_id, publisher_id, status, currency, period_start, period_end, billed_amount, public_notes)
     SELECT $1,$2,'unpaid','USD',$3,$4,1250.00,'August performance payout'
     WHERE NOT EXISTS (SELECT 1 FROM partner_invoices WHERE network_id = $1 AND publisher_id = $2 AND period_start = $3)`,
    [networkId, pubIds.trafficCo, periodStart, periodEnd],
  );
  await c.query(
    `INSERT INTO advertiser_invoices (network_id, advertiser_id, status, currency, period_start, period_end, billed_amount, notes)
     SELECT $1,$2,'unpaid','USD',$3,$4,3200.00,'August billing — Acme campaigns'
     WHERE NOT EXISTS (SELECT 1 FROM advertiser_invoices WHERE network_id = $1 AND advertiser_id = $2 AND period_start = $3)`,
    [networkId, advIds.acme, periodStart, periodEnd],
  );

  // Reporting adjustment
  await c.query(
    `INSERT INTO reporting_adjustments (network_id, publisher_id, offer_id, date_from, date_to, days)
     SELECT $1,$2,$3,'2026-08-15','2026-08-15','[{"date":"2026-08-15","clicks":5,"conversions":1}]'
     WHERE NOT EXISTS (SELECT 1 FROM reporting_adjustments WHERE network_id = $1 AND publisher_id = $2 AND offer_id = $3)`,
    [networkId, pubIds.trafficCo, offerIds.acmeUs],
  );

  // Customer value
  await c.query(
    `INSERT INTO customer_data_points (network_id, name, data_type, parameter_key)
     SELECT $1,'Deposit Amount','number','deposit' WHERE NOT EXISTS (
       SELECT 1 FROM customer_data_points WHERE network_id = $1 AND parameter_key = 'deposit')`,
    [networkId],
  );
  await ensureNamedRow(c, 'customer_value_rules', networkId, 'High Depositor Bonus',
    `INSERT INTO customer_value_rules (network_id, name, status, payout_value, conditions)
     VALUES ($1,'High Depositor Bonus','active',10,'[]') RETURNING id`, [networkId]);

  // Communication hub
  const audId = await ensureNamedRow(c, 'audiences', networkId, 'Active Publishers',
    `INSERT INTO audiences (network_id, name, group_type, status_filter)
     VALUES ($1,'Active Publishers','publishers','{active}') RETURNING id`, [networkId]);
  await ensureNamedRow(c, 'email_templates', networkId, 'Welcome Template',
    `INSERT INTO email_templates (network_id, name, subject, body)
     VALUES ($1,'Welcome Template','Welcome to Demo Network','Hi {{name}}, welcome aboard!') RETURNING id`, [networkId]);
  await c.query(
    `INSERT INTO email_messages (network_id, subject, body, message_type, audience_id, status, recipient_count)
     SELECT $1,'August Newsletter','Check out our new offers!','general',$2,'sent',3
     WHERE NOT EXISTS (SELECT 1 FROM email_messages WHERE network_id = $1 AND subject = 'August Newsletter')`,
    [networkId, audId],
  );
  await ensureNamedRow(c, 'banners', networkId, 'New Offer Alert',
    `INSERT INTO banners (network_id, name, message, priority, status)
     VALUES ($1,'New Offer Alert','New finance offers available — check the marketplace!','high','published') RETURNING id`, [networkId]);

  // Alerts & fraud config
  await c.query(
    `INSERT INTO alerts (network_id, type, severity, entity_type, title, description, status)
     SELECT $1,'cr_spike','medium','offer','Conversion rate spike on Acme US CPA','CR jumped 40% vs 7-day avg','open'
     WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE network_id = $1 AND type = 'cr_spike' AND status = 'open')`,
    [networkId],
  );
  await c.query(
    `INSERT INTO fraud_rules (network_id, config) VALUES ($1,'{"enabled":true,"minClickToConversionSeconds":2}')
     ON CONFLICT (network_id) DO NOTHING`,
    [networkId],
  );

  // Link templates
  await ensureNamedRow(c, 'advertiser_link_templates', networkId, 'Acme Default LP',
    `INSERT INTO advertiser_link_templates (network_id, advertiser_id, name, destination_url)
     VALUES ($1,$2,'Acme Default LP','https://acme.test/lp?aid={advertiser_id}&sub1={sub1}') RETURNING id`,
    [networkId, advIds.acme]);

  // API key (hash only — not a real secret)
  const adminUser = await c.query<{ id: string }>(
    `SELECT id FROM users WHERE network_id = $1 ORDER BY created_at LIMIT 1`, [networkId],
  );
  const keyHash = createHash('sha256').update('demo-api-key-not-for-production').digest('hex');
  await c.query(
    `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, name, scopes)
     SELECT $1,'network',$2,'net_demo_abcd', $3,'Demo Network API','{read,write}'
     WHERE NOT EXISTS (SELECT 1 FROM api_keys WHERE network_id = $1 AND key_prefix = 'net_demo_abcd')`,
    [networkId, adminUser.rows[0]?.id ?? networkId, keyHash],
  );

  // Import/export log
  await c.query(
    `INSERT INTO import_export_logs (network_id, kind, entity, status, row_count, detail)
     SELECT $1,'export','conversions','completed',150,'Demo export job'
     WHERE NOT EXISTS (SELECT 1 FROM import_export_logs WHERE network_id = $1 AND detail = 'Demo export job')`,
    [networkId],
  );

  // AI conversation sample
  const aiConv = await c.query(`SELECT id FROM ai_conversations WHERE network_id = $1 LIMIT 1`, [networkId]);
  if (aiConv.rows.length === 0) {
    const conv = await c.query<{ id: string }>(
      `INSERT INTO ai_conversations (network_id, user_id, title) VALUES ($1,'demo-admin','Offer performance summary') RETURNING id`,
      [networkId],
    );
    await c.query(
      `INSERT INTO ai_messages (network_id, conversation_id, role, content)
       VALUES ($1,$2,'user','Which offer had the best CVR last week?'),
              ($1,$2,'assistant','Acme US CPA led with 4.2% CVR across 1,240 clicks.')`,
      [networkId, conv.rows[0]!.id],
    );
  }

  return {
    offerIds: Object.values(offerIds),
    pubIds: [pubIds.trafficCo, pubIds.clickMasters, pubIds.affiliatePro],
    advIds,
  };
}

async function seedTraffic(c: Client, networkId: string, offerIds: string[], pubIds: string[]): Promise<void> {
  const existing = await c.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM clicks WHERE network_id = $1 AND sub2 = $2`,
    [networkId, TRAFFIC_MARKER],
  );
  if ((existing.rows[0]?.n ?? 0) >= 100) {
    logger.info('demo traffic already seeded — skipping');
    return;
  }

  const advMap = await c.query<{ id: string; advertiser_id: string; default_payout: string; default_revenue: string; currency: string }>(
    `SELECT id, advertiser_id, default_payout::text, default_revenue::text, currency FROM offers WHERE id = ANY($1)`,
    [offerIds.filter(Boolean)],
  );
  const offers = advMap.rows.filter((o) => offerIds.includes(o.id));
  if (offers.length === 0 || pubIds.length === 0) return;

  const subs = ['google', 'facebook', 'native', 'tiktok', 'email'];
  const events = ['purchase', 'purchase', 'signup', 'lead'];
  const statuses = ['approved', 'approved', 'approved', 'pending', 'rejected'];
  const devices = ['desktop', 'mobile', 'tablet'];
  let clicks = 0;
  let conversions = 0;

  for (let day = 29; day >= 0; day--) {
    const perDay = 15 + Math.floor(Math.random() * 10);
    for (let i = 0; i < perDay; i++) {
      const offer = offers[Math.floor(Math.random() * offers.length)]!;
      const pub = pubIds[Math.floor(Math.random() * pubIds.length)]!;
      const clickId = randomUUID().replace(/-/g, '');
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - day);
      createdAt.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));

      await c.query(
        `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, country, device,
           sub1, sub2, resolved_payout, resolved_revenue, currency, is_unique)
         VALUES ($1,$2,$3,$4,$5,'US',$6,$7,$8,$9,$10,$11,true)`,
        [
          clickId, networkId, offer.id, pub, createdAt.toISOString(),
          devices[Math.floor(Math.random() * devices.length)],
          subs[Math.floor(Math.random() * subs.length)]!, TRAFFIC_MARKER,
          offer.default_payout, offer.default_revenue, offer.currency,
        ],
      );
      clicks++;

      if (Math.random() < 0.38) {
        const conversionId = randomUUID().replace(/-/g, '');
        const txnId = `demo-${conversionId.slice(0, 16)}`;
        const status = statuses[Math.floor(Math.random() * statuses.length)]!;
        const payout = offer.default_payout;
        const revenue = offer.default_revenue;

        await c.query(
          `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
             event_name, status, payout, revenue, currency, transaction_id, source, raw_params, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'postback',$13,$14)
           ON CONFLICT DO NOTHING`,
          [
            conversionId, networkId, clickId, offer.id, pub, offer.advertiser_id,
            events[Math.floor(Math.random() * events.length)], status,
            payout, revenue, offer.currency, txnId, JSON.stringify({ user_id: `user_${Math.floor(Math.random() * 500)}`, deposit: String(Math.floor(Math.random() * 200)) }),
            createdAt.toISOString(),
          ],
        );
        conversions++;

        if (status === 'approved') {
          await c.query(
            `INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, idempotency_key)
             VALUES ($1,'publisher',$2,$3,'earning','credit',$4,$5,$6),
                    ($1,'advertiser',$7,$3,'billing','debit',$8,$5,$9)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              networkId, pub, conversionId, payout, offer.currency, `conv-earning:${conversionId}`,
              offer.advertiser_id, revenue, `conv-billing:${conversionId}`,
            ],
          );
        }
      }
    }
  }

  logger.info({ clicks, conversions }, 'seeded demo traffic');
}

async function main(): Promise<void> {
  const skipTraffic = process.argv.includes('--no-traffic');
  const network = await findNetwork();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = await seedEntities(client, network.id);
    if (!skipTraffic) {
      await seedTraffic(client, network.id, ids.offerIds, ids.pubIds);
    }
    await client.query('COMMIT');
    logger.info({ networkId: network.id }, 'demo data ready — log in as demo-admin@tracker.test and explore');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-demo-data failed');
    void closeDb().finally(() => process.exit(1));
  });
