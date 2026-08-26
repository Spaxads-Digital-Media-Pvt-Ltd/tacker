/**
 * Redis offer-config cache (spec §5 step 2). The hot path reads offer config from Redis; on a
 * miss it loads from Postgres (offer + geo rules), caches JSON, and returns. Invalidated on offer
 * / geo-rule writes (see cache-invalidation.ts). This is what keeps the click path off synchronous
 * Postgres reads for config.
 */
import { query } from '../../lib/db/pool.js';
import { getRedis } from '../../lib/redis.js';

export interface GeoRuleConfig {
  country: string;
  region: string | null;
  action: 'allow' | 'deny';
  payoutOverride: string | null;
  revenueOverride: string | null;
  destinationOverride: string | null;
}

export interface TrafficControlConfig {
  controlType: 'blacklist' | 'whitelist';
  action: 'block' | 'fail_traffic';
  variables: string[];
  comparisonMethod: string | null;
  values: string[];
  partnerScope: 'all' | 'specific';
  partnerIds: string[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface OfferConfig {
  id: string;
  networkId: string;
  advertiserId: string;
  status: string;
  destinationUrl: string;
  fallbackUrl: string | null;
  payoutModel: string;
  defaultPayout: string;
  defaultRevenue: string;
  currency: string;
  dailyConversionCap: number | null;
  totalConversionCap: number | null;
  dailyClickCap: number | null;
  attributionWindowS: number;
  dedupWindowS: number;
  allowedTrafficTypes: string[];
  geoRules: GeoRuleConfig[];
  /** Publisher ids explicitly BLOCKED from this offer (offer_publisher_access.access='deny'). */
  deniedPublishers: string[];
  /** Per-offer postback secure_code override (null → fall back to the network code). */
  securityCode: string | null;
  /** Network-wide postback secure_code (used when the offer has none). */
  networkSecurityCode: string | null;
  /** Active Traffic Controls that apply to this offer (by scope — direct, via advertiser, or all). */
  trafficControls: TrafficControlConfig[];
}

const TTL = 300;
const NEG = ' ';
const NEG_TTL = 30;

export const offerCacheKey = (networkId: string, offerId: string) => `offercfg:${networkId}:${offerId}`;

/** Bust the cached config after an offer / geo-rule write so the hot path reloads fresh (spec §5). */
export async function invalidateOfferConfig(networkId: string, offerId: string): Promise<void> {
  await getRedis().del(offerCacheKey(networkId, offerId));
}

export async function getOfferConfig(networkId: string, offerId: string): Promise<OfferConfig | null> {
  const redis = getRedis();
  const key = offerCacheKey(networkId, offerId);

  const cached = await redis.get(key);
  if (cached === NEG) return null;
  if (cached) return JSON.parse(cached) as OfferConfig;

  const cfg = await loadFromDb(networkId, offerId);
  if (!cfg) {
    await redis.set(key, NEG, 'EX', NEG_TTL);
    return null;
  }
  await redis.set(key, JSON.stringify(cfg), 'EX', TTL);
  return cfg;
}

interface Row {
  id: string; network_id: string; advertiser_id: string; status: string;
  destination_url: string; fallback_url: string | null; payout_model: string;
  default_payout: string; default_revenue: string; currency: string;
  daily_conversion_cap: number | null; total_conversion_cap: number | null; daily_click_cap: number | null;
  attribution_window_s: number; dedup_window_s: number; allowed_traffic_types: string[];
  geo_rules: GeoRuleConfig[] | null;
  denied_publishers: string[] | null;
  security_code: string | null;
  network_security_code: string | null;
}

async function loadFromDb(networkId: string, offerId: string): Promise<OfferConfig | null> {
  const { rows } = await query<Row>(
    `SELECT o.*, n.postback_security_code AS network_security_code,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'country', g.country, 'region', g.region, 'action', g.action,
              'payoutOverride', g.payout_override, 'revenueOverride', g.revenue_override,
              'destinationOverride', g.destination_override
            )) FILTER (WHERE g.id IS NOT NULL), '[]') AS geo_rules,
            COALESCE(array_agg(DISTINCT a.publisher_id) FILTER (WHERE a.access = 'deny'), '{}') AS denied_publishers
       FROM offers o
       LEFT JOIN networks n ON n.id = o.network_id
       LEFT JOIN offer_geo_rules g ON g.offer_id = o.id
       LEFT JOIN offer_publisher_access a ON a.offer_id = o.id
      WHERE o.id = $1 AND o.network_id = $2
      GROUP BY o.id, n.postback_security_code`,
    [offerId, networkId],
  );
  const r = rows[0];
  if (!r) return null;

  // Separate query: Traffic Controls aren't FK'd to an offer (their scope is All / specific
  // Offers / specific Advertisers), so this can't join cleanly onto the aggregate above.
  const tcRes = await query<{
    control_type: string; action: string; variables: string[]; comparison_method: string | null;
    control_values: string[]; partner_scope: string; partner_ids: string[];
    effective_from: string | null; effective_to: string | null;
  }>(
    `SELECT control_type, action, variables, comparison_method, control_values, partner_scope, partner_ids, effective_from, effective_to
       FROM traffic_controls
      WHERE network_id = $1 AND status = 'active'
        AND (offer_scope = 'all'
             OR (offer_scope = 'offers' AND offer_ids @> to_jsonb($2::text))
             OR (offer_scope = 'advertisers' AND advertiser_ids @> to_jsonb($3::text)))`,
    [networkId, offerId, r.advertiser_id],
  );

  return {
    id: r.id, networkId: r.network_id, advertiserId: r.advertiser_id, status: r.status,
    destinationUrl: r.destination_url, fallbackUrl: r.fallback_url, payoutModel: r.payout_model,
    defaultPayout: r.default_payout, defaultRevenue: r.default_revenue, currency: r.currency,
    dailyConversionCap: r.daily_conversion_cap, totalConversionCap: r.total_conversion_cap,
    dailyClickCap: r.daily_click_cap, attributionWindowS: r.attribution_window_s,
    dedupWindowS: r.dedup_window_s, allowedTrafficTypes: r.allowed_traffic_types,
    geoRules: r.geo_rules ?? [],
    deniedPublishers: r.denied_publishers ?? [],
    securityCode: r.security_code ?? null,
    networkSecurityCode: r.network_security_code ?? null,
    trafficControls: tcRes.rows.map((t) => ({
      controlType: t.control_type as 'blacklist' | 'whitelist', action: t.action as 'block' | 'fail_traffic',
      variables: t.variables, comparisonMethod: t.comparison_method, values: t.control_values,
      partnerScope: t.partner_scope as 'all' | 'specific', partnerIds: t.partner_ids,
      effectiveFrom: t.effective_from, effectiveTo: t.effective_to,
    })),
  };
}
