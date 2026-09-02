/**
 * Rich local dev dataset — enriches the `demo` network with realistic, varied data so every
 * Manage Offers filter (and the reports/list UI generally) has something meaningful to show:
 *
 *   • ~4 manager users, every advertiser given an account + sales manager
 *   • ~7 advertisers, ~16 offers spanning every payout_model, a spread of categories,
 *     allowed_traffic_types (incl. "no restriction"), currencies, visibility and status,
 *     tracking domains, and preview URLs
 *   • per-country payout/revenue/destination rules on ~6 offers (allow-list, block-list,
 *     overrides) — the real backing for a "Country" filter
 *   • 6 labels (tags) assigned across ~10 offers, 3 offer groups with members,
 *     publisher-access grants on the private/ask offers
 *
 * Pure SQL against DATABASE_URL — no hot-path code, no schema changes. Idempotent: re-running
 * replaces its own rows (offers/advertisers marked metadata->>'seed'='rich', and it fully
 * re-seeds geo rules / offer taggings / offer groups for the network). The 6 original seed
 * offers are enriched in place, not deleted.
 *
 * Usage (LOCAL / throwaway DB only — same override as every other dev script):
 *   DATABASE_URL='postgresql://tracker:tracker_local_dev@localhost:5433/tracker_test' \
 *     npm --prefix api-backend run seed:rich
 */
import pg from 'pg';

const NET_SLUG = 'demo';

function pick<T>(xs: readonly T[], i: number): T {
  return xs[i % xs.length]!;
}

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
    if (!net) throw new Error(`network "${NET_SLUG}" not found — run \`npm run seed\` against this DB first`);
    const netId = net.id;

    await db.query('BEGIN');

    // ── 0. clean this script's prior rows so a re-run is deterministic ──────────────────────────
    await db.query(
      `DELETE FROM taggings WHERE network_id = $1 AND entity_type = 'offer'`, [netId]);
    await db.query(`DELETE FROM offer_groups WHERE network_id = $1`, [netId]);
    await db.query(`DELETE FROM offer_geo_rules WHERE network_id = $1`, [netId]);
    await db.query(
      `DELETE FROM offers WHERE network_id = $1 AND metadata->>'seed' = 'rich'`, [netId]);
    await db.query(
      `DELETE FROM advertisers WHERE network_id = $1 AND metadata->>'seed' = 'rich'`, [netId]);

    // ── 1. manager users ──────────────────────────────────────────────────────────────────────
    const MANAGERS = [
      { email: 'priya.nair@demo.test', name: 'Priya Nair' },
      { email: 'marcus.webb@demo.test', name: 'Marcus Webb' },
      { email: 'lena.fischer@demo.test', name: 'Lena Fischer' },
      { email: 'diego.alvarez@demo.test', name: 'Diego Alvarez' },
    ];
    for (const m of MANAGERS) {
      await db.query(
        `INSERT INTO users (network_id, email, name, role, status)
         VALUES ($1, $2, $3, 'manager', 'active')
         ON CONFLICT (network_id, lower(email)) DO UPDATE SET name = EXCLUDED.name, role = 'manager'`,
        [netId, m.email, m.name],
      );
    }
    const users = (await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE network_id = $1`, [netId])).rows;
    const mgr = (email: string) => users.find((u) => u.email === email)!.id;
    const mgrIds = MANAGERS.map((m) => mgr(m.email));

    // ── 2. advertisers — keep the 3 base ones, add 4, give every advertiser both managers ──────
    const NEW_ADVERTISERS = [
      { name: 'Lumen Skincare', currency: 'USD' },
      { name: 'Sterling Financial', currency: 'GBP' },
      { name: 'Fjord Outdoor Co', currency: 'EUR' },
      { name: 'Pixel Forge Games', currency: 'USD' },
    ];
    for (const a of NEW_ADVERTISERS) {
      await db.query(
        `INSERT INTO advertisers (network_id, name, status, default_currency, metadata)
         VALUES ($1, $2, 'active', $3, '{"seed":"rich"}'::jsonb)`,
        [netId, a.name, a.currency],
      );
    }
    const advertisers = (await db.query<{ id: string; name: string; default_currency: string }>(
      `SELECT id, name, default_currency FROM advertisers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
    // Rotate account + sales manager across advertisers so every filter option is exercised.
    for (let i = 0; i < advertisers.length; i++) {
      await db.query(
        `UPDATE advertisers SET account_manager_id = $2, sales_manager_id = $3 WHERE id = $1`,
        [advertisers[i]!.id, pick(mgrIds, i), pick(mgrIds, i + 1)],
      );
    }
    const advByName = (n: string) => advertisers.find((a) => a.name === n)!.id;

    // ── 3. tracking domains lookup ────────────────────────────────────────────────────────────
    const domains = (await db.query<{ id: string; host: string }>(
      `SELECT id, host FROM tracking_domains WHERE network_id = $1`, [netId])).rows;
    const dom = (h: string) => domains.find((d) => d.host === h)?.id ?? null;

    // ── 4. enrich the 6 original offers in place ──────────────────────────────────────────────
    const BASE_ENRICH: { name: string; category: string; payout_model: string; traffic: string[]; visibility: string; domain: string | null }[] = [
      { name: 'Acme US CPA', category: 'Insurance', payout_model: 'CPA', traffic: [], visibility: 'public', domain: 'demo.ourtracking.com' },
      { name: 'Northwind Home & Kitchen - US', category: 'Home & Garden', payout_model: 'CPA', traffic: ['desktop', 'tablet'], visibility: 'public', domain: 'demo.ourtracking.com' },
      { name: 'Globex Daily Greens Trial - US', category: 'Nutrition', payout_model: 'CPL', traffic: ['mobile'], visibility: 'ask', domain: 'demo.ourtracking.com' },
      { name: 'Northwind Outdoor Gear - US', category: 'Sports & Outdoors', payout_model: 'RevShare', traffic: ['desktop'], visibility: 'private', domain: 'localhost' },
      { name: 'Globex Sleep Formula - US', category: 'Nutrition', payout_model: 'CPA', traffic: ['mobile', 'tablet'], visibility: 'public', domain: null },
      { name: 'Northwind Pet Care Box - US', category: 'Pets', payout_model: 'CPC', traffic: [], visibility: 'public', domain: 'demo.ourtracking.com' },
    ];
    for (const e of BASE_ENRICH) {
      await db.query(
        `UPDATE offers
            SET category = $3, payout_model = $4, allowed_traffic_types = $5,
                visibility = $6, tracking_domain_id = $7,
                preview_url = COALESCE(preview_url, 'https://preview.demo.test/' || regexp_replace(lower($2), '[^a-z0-9]+', '-', 'g'))
          WHERE network_id = $1 AND name = $2`,
        [netId, e.name, e.category, e.payout_model, e.traffic, e.visibility, dom(e.domain ?? '')],
      );
    }

    // ── 5. new offers — full spread of every filterable dimension ─────────────────────────────
    const CATEGORIES = ['Health & Beauty', 'Finance', 'Gaming', 'Sports & Outdoors', 'Streaming & Software', 'Nutrition', 'Home & Garden', 'Insurance', 'Dating', 'Travel'];
    const MODELS = ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'];
    const TRAFFIC = [[], ['mobile'], ['desktop'], ['mobile', 'tablet'], ['desktop', 'tablet'], ['mobile', 'desktop', 'tablet']];
    const VIS = ['public', 'public', 'private', 'ask'];
    const STATUS = ['active', 'active', 'active', 'active', 'paused', 'draft'];
    const NEW_OFFERS: { name: string; advertiser: string; currency: string }[] = [
      { name: 'Lumen Vitamin C Serum — US', advertiser: 'Lumen Skincare', currency: 'USD' },
      { name: 'Lumen Retinol Night Cream — CA', advertiser: 'Lumen Skincare', currency: 'USD' },
      { name: 'Sterling Personal Loan — UK', advertiser: 'Sterling Financial', currency: 'GBP' },
      { name: 'Sterling Balance-Transfer Card — UK', advertiser: 'Sterling Financial', currency: 'GBP' },
      { name: 'Fjord Trekking Poles 2-Pack — EU', advertiser: 'Fjord Outdoor Co', currency: 'EUR' },
      { name: 'Fjord All-Season Tent — DE/AT', advertiser: 'Fjord Outdoor Co', currency: 'EUR' },
      { name: 'Pixel Forge: Dragon Realm — Global Install', advertiser: 'Pixel Forge Games', currency: 'USD' },
      { name: 'Pixel Forge: Idle Tycoon — US/CA', advertiser: 'Pixel Forge Games', currency: 'USD' },
      { name: 'StreamVault Annual Plan — US', advertiser: 'Acme Corp', currency: 'USD' },
      { name: 'BrightMile Auto Insurance Quote — US', advertiser: 'Acme Corp', currency: 'USD' },
      { name: 'Northwind Meal-Prep Subscription — US', advertiser: 'Northwind Retail', currency: 'USD' },
      { name: 'Globex Keto Bundle — US', advertiser: 'Globex Nutrition', currency: 'USD' },
    ];
    const createdOffers: { id: string; name: string }[] = [];
    for (let i = 0; i < NEW_OFFERS.length; i++) {
      const o = NEW_OFFERS[i]!;
      const model = pick(MODELS, i);
      const rev = (8 + i * 3.5).toFixed(4);
      const pay = (4 + i * 2).toFixed(4);
      const row = (await db.query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, payout_model,
           default_payout, default_revenue, currency, objective, visibility, category,
           allowed_traffic_types, tracking_domain_id, preview_url, daily_click_cap, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'{"seed":"rich"}'::jsonb)
         RETURNING id`,
        [
          netId, advByName(o.advertiser), o.name, pick(STATUS, i),
          `https://lp.${o.advertiser.toLowerCase().replace(/[^a-z]+/g, '')}.test/offer?cid={click_id}`,
          model, pay, rev, o.currency,
          pick(['conversions', 'sale', 'leads', 'app_installs', 'clicks'], i),
          pick(VIS, i), pick(CATEGORIES, i),
          pick(TRAFFIC, i),
          i % 3 === 0 ? dom('demo.ourtracking.com') : i % 3 === 1 ? dom('localhost') : null,
          `https://preview.demo.test/${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          i % 4 === 0 ? 5000 + i * 250 : null,
        ],
      )).rows[0]!;
      createdOffers.push({ id: row.id, name: o.name });
    }

    // ── 6. per-country payout rules on a handful of offers (the "Country" backing) ─────────────
    const allOffers = (await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM offers WHERE network_id = $1 ORDER BY created_at`, [netId])).rows;
    const offer = (n: string) => allOffers.find((o) => o.name === n)!.id;
    type GRule = [offerName: string, country: string, action: 'allow' | 'deny', payoutOv: string | null, revenueOv: string | null, destOv: string | null];
    const GEO: GRule[] = [
      // allow-list: only US + GB (everything else denied via '*')
      ['Sterling Personal Loan — UK', 'GB', 'allow', null, null, null],
      ['Sterling Personal Loan — UK', 'US', 'allow', '35.0000', null, null],
      ['Sterling Personal Loan — UK', '*', 'deny', null, null, null],
      // block-list: allow everywhere except DE
      ['Fjord All-Season Tent — DE/AT', '*', 'allow', null, null, null],
      ['Fjord All-Season Tent — DE/AT', 'DE', 'deny', null, null, null],
      // payout + revenue overrides by country
      ['Lumen Vitamin C Serum — US', 'US', 'allow', '18.0000', '30.0000', null],
      ['Lumen Vitamin C Serum — US', 'CA', 'allow', '15.0000', '26.0000', null],
      ['Lumen Vitamin C Serum — US', 'AU', 'allow', '12.0000', '22.0000', 'https://lp.lumenskincare.test/au?cid={click_id}'],
      // multi-country allow-list on a game install offer
      ['Pixel Forge: Dragon Realm — Global Install', 'US', 'allow', null, null, null],
      ['Pixel Forge: Dragon Realm — Global Install', 'BR', 'allow', '2.5000', null, null],
      ['Pixel Forge: Dragon Realm — Global Install', 'IN', 'allow', '1.2000', null, null],
      ['Pixel Forge: Dragon Realm — Global Install', 'ID', 'allow', '1.0000', null, null],
      // base seed offer keeps its original US rule + gains GB (with a higher UK payout)
      ['Acme US CPA', 'US', 'allow', null, null, null],
      ['Acme US CPA', 'GB', 'allow', '9.5000', null, null],
      ['Globex Daily Greens Trial - US', 'US', 'allow', null, null, null],
      ['Globex Daily Greens Trial - US', 'CA', 'allow', null, '14.0000', null],
    ];
    for (const [oName, country, action, po, ro, dov] of GEO) {
      await db.query(
        `INSERT INTO offer_geo_rules (network_id, offer_id, country, action, payout_override, revenue_override, destination_override)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [netId, offer(oName), country, action, po, ro, dov],
      );
    }

    // ── 7. labels (tags) + assignments ───────────────────────────────────────────────────────
    const TAGS = [
      { name: 'Top Performer', color: '#16a34a' },
      { name: 'Seasonal', color: '#d97706' },
      { name: 'Exclusive', color: '#7c3aed' },
      { name: 'Q1 Priority', color: '#2563eb' },
      { name: 'Compliance Hold', color: '#dc2626' },
      { name: 'New', color: '#0891b2' },
    ];
    for (const t of TAGS) {
      await db.query(
        `INSERT INTO tags (network_id, name, color) VALUES ($1, $2, $3)
         ON CONFLICT (network_id, lower(name)) DO UPDATE SET color = EXCLUDED.color`,
        [netId, t.name, t.color],
      );
    }
    const tagRows = (await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM tags WHERE network_id = $1`, [netId])).rows;
    const tag = (n: string) => tagRows.find((t) => t.name === n)!.id;
    const TAGGING: [offerName: string, tags: string[]][] = [
      ['Acme US CPA', ['Top Performer', 'Q1 Priority']],
      ['Lumen Vitamin C Serum — US', ['Top Performer', 'New']],
      ['Lumen Retinol Night Cream — CA', ['New']],
      ['Sterling Personal Loan — UK', ['Exclusive', 'Compliance Hold']],
      ['Sterling Balance-Transfer Card — UK', ['Compliance Hold']],
      ['Fjord Trekking Poles 2-Pack — EU', ['Seasonal']],
      ['Pixel Forge: Dragon Realm — Global Install', ['Top Performer', 'Exclusive']],
      ['StreamVault Annual Plan — US', ['Q1 Priority']],
      ['Globex Keto Bundle — US', ['Seasonal', 'New']],
      ['Northwind Outdoor Gear - US', ['Exclusive']],
    ];
    for (const [oName, ts] of TAGGING) {
      for (const t of ts) {
        await db.query(
          `INSERT INTO taggings (network_id, tag_id, entity_type, entity_id) VALUES ($1, $2, 'offer', $3)
           ON CONFLICT (tag_id, entity_type, entity_id) DO NOTHING`,
          [netId, tag(t), offer(oName)],
        );
      }
    }

    // ── 8. offer groups ─────────────────────────────────────────────────────────────────────
    const GROUPS: [name: string, offerNames: string[]][] = [
      ['US Nutrition Portfolio', ['Globex Daily Greens Trial - US', 'Globex Sleep Formula - US', 'Globex Keto Bundle — US', 'Northwind Meal-Prep Subscription — US']],
      ['EU Finance Launch', ['Sterling Personal Loan — UK', 'Sterling Balance-Transfer Card — UK']],
      ['Mobile Gaming Bundle', ['Pixel Forge: Dragon Realm — Global Install', 'Pixel Forge: Idle Tycoon — US/CA']],
    ];
    for (const [name, offerNames] of GROUPS) {
      const ids = offerNames.map(offer);
      await db.query(
        `INSERT INTO offer_groups (network_id, name, offer_ids, status) VALUES ($1, $2, $3::jsonb, 'active')`,
        [netId, name, JSON.stringify(ids)],
      );
    }

    // ── 9. publisher-access grants on the non-public offers ─────────────────────────────────
    const pubs = (await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM publishers WHERE network_id = $1 AND status = 'active'`, [netId])).rows;
    const privateOffers = (await db.query<{ id: string }>(
      `SELECT id FROM offers WHERE network_id = $1 AND visibility IN ('private', 'ask')`, [netId])).rows;
    for (let i = 0; i < privateOffers.length; i++) {
      const grant = [pubs[i % pubs.length]!, pubs[(i + 1) % pubs.length]!];
      for (const p of grant) {
        await db.query(
          `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
           VALUES ($1, $2, $3, 'allow', 'approved')
           ON CONFLICT (offer_id, publisher_id) DO NOTHING`,
          [netId, privateOffers[i]!.id, p.id],
        );
      }
    }

    await db.query('COMMIT');

    // ── summary ─────────────────────────────────────────────────────────────────────────────
    const count = async (sql: string) => Number((await db.query<{ n: string }>(sql, [netId])).rows[0]!.n);
    const summary = {
      users_manager: await count(`SELECT count(*) n FROM users WHERE network_id=$1 AND role='manager'`),
      advertisers: await count(`SELECT count(*) n FROM advertisers WHERE network_id=$1`),
      advertisers_with_managers: await count(`SELECT count(*) n FROM advertisers WHERE network_id=$1 AND account_manager_id IS NOT NULL AND sales_manager_id IS NOT NULL`),
      offers: await count(`SELECT count(*) n FROM offers WHERE network_id=$1`),
      offers_by_model: (await db.query(`SELECT payout_model, count(*)::int n FROM offers WHERE network_id=$1 GROUP BY payout_model ORDER BY payout_model`, [netId])).rows,
      distinct_categories: await count(`SELECT count(DISTINCT category) n FROM offers WHERE network_id=$1 AND category IS NOT NULL`),
      offers_with_traffic_types: await count(`SELECT count(*) n FROM offers WHERE network_id=$1 AND allowed_traffic_types <> '{}'`),
      offers_with_tracking_domain: await count(`SELECT count(*) n FROM offers WHERE network_id=$1 AND tracking_domain_id IS NOT NULL`),
      visibility: (await db.query(`SELECT visibility, count(*)::int n FROM offers WHERE network_id=$1 GROUP BY visibility ORDER BY visibility`, [netId])).rows,
      status: (await db.query(`SELECT status, count(*)::int n FROM offers WHERE network_id=$1 GROUP BY status ORDER BY status`, [netId])).rows,
      geo_rules: await count(`SELECT count(*) n FROM offer_geo_rules WHERE network_id=$1`),
      offers_with_geo_rules: await count(`SELECT count(DISTINCT offer_id) n FROM offer_geo_rules WHERE network_id=$1`),
      distinct_geo_countries: await count(`SELECT count(DISTINCT country) n FROM offer_geo_rules WHERE network_id=$1 AND country <> '*'`),
      tags: await count(`SELECT count(*) n FROM tags WHERE network_id=$1`),
      offer_taggings: await count(`SELECT count(*) n FROM taggings WHERE network_id=$1 AND entity_type='offer'`),
      offer_groups: await count(`SELECT count(*) n FROM offer_groups WHERE network_id=$1`),
      publisher_access_rows: await count(`SELECT count(*) n FROM offer_publisher_access WHERE network_id=$1`),
    };
    // eslint-disable-next-line no-console
    console.log('seed-rich OK — demo network now has:\n' + JSON.stringify(summary, null, 2));
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
    console.error('seed-rich failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
