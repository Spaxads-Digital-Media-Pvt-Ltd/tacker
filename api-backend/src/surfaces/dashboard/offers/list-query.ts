/**
 * Manage Offers — paged list (`GET /api/offers?paged=1`). Schema + PURE SQL builder: every filter the
 * Offers page offers, applied in SQL with bound parameters, network id always `$1`. Semantics mirror
 * the page's former client-side filters exactly (see frontend/src/pages/admin/Offers.tsx history):
 *   - Country: the offer's geo rules (collapsed to allow/deny the way tracking/geo-rules.ts does) AND
 *     its metadata.targeting.country include/exclude rule must both allow it; no rule = allows all.
 *   - Platform: metadata.targeting.platform include/exclude, case-insensitive; no rule = allows all.
 *   - Device type: allowed_traffic_types contains it, or is empty (no restriction = allows all).
 *   - Account / Sales manager: via the offer's advertiser.
 * Foreign ids (another network's advertiser/tag/group/domain/user) simply match nothing.
 */
import { z } from 'zod';
import { csvList } from '../../../lib/http/query-params.js';
import { containsPattern } from '../../../lib/db/like.js';
import {
  pagedBase, SqlParams, assemblePaged, groupedCount, type BuiltPagedList,
} from '../../../lib/http/paged-list.js';

export const OFFER_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export const OFFER_PAYOUT_MODELS = ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'] as const;
/** Revenue-side labels the page shows (R- prefix) → the stored payout_model they stand for. */
export const REVENUE_TYPE_TO_MODEL: Record<string, (typeof OFFER_PAYOUT_MODELS)[number]> = {
  RPA: 'CPA', RPL: 'CPL', RPC: 'CPC', RPI: 'CPI', RevShare: 'RevShare',
};
const REVENUE_TYPES = ['RPA', 'RPL', 'RPC', 'RPI', 'RevShare'] as const;
const OBJECTIVES = ['conversions', 'sale', 'app_installs', 'leads', 'impressions', 'clicks', ...OFFER_PAYOUT_MODELS] as const;

/** Sort key → SQL expression. The ONLY way request input reaches ORDER BY. */
export const OFFER_SORTS = {
  createdAt: 'o.created_at',
  updatedAt: 'o.updated_at',
  id: 'o.ref',
  name: 'lower(o.name)',
  status: 'o.status',
  advertiser: 'lower(a.name)',
  category: 'lower(o.category)',
  payoutModel: 'o.payout_model',
  payout: 'o.default_payout',
  revenue: 'o.default_revenue',
  visibility: 'o.visibility',
} as const;
const SORT_KEYS = Object.keys(OFFER_SORTS) as [keyof typeof OFFER_SORTS, ...(keyof typeof OFFER_SORTS)[]];

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((s) => (s ? s : undefined));

export const offerListQuerySchema = z.object({
  ...pagedBase(SORT_KEYS, 'createdAt'),
  /** Toolbar search, matched under `searchField`. */
  search: optText(200),
  searchField: z.enum(['name', 'advertiser', 'id']).default('name'),
  /** Drawer "Offer Name" — always by name. */
  name: optText(200),
  /** Drawer "Offer IDs": numeric refs or uuids, exact. */
  offerIds: csvList(z.string().trim().min(1).max(64)),
  status: csvList(z.enum(OFFER_STATUSES)),
  advertiserId: csvList(uuid),
  /** Free-text offers.category, matched case-insensitively (Control Center names vs stored text). */
  category: optText(200),
  tagId: csvList(uuid),
  offerGroupId: csvList(uuid),
  accountManagerId: csvList(uuid),
  salesManagerId: csvList(uuid),
  trackingDomainId: csvList(uuid),
  visibility: csvList(z.enum(['public', 'private', 'ask'])),
  payoutType: csvList(z.enum(OFFER_PAYOUT_MODELS)),
  revenueType: csvList(z.enum(REVENUE_TYPES)),
  objective: csvList(z.enum(OBJECTIVES)),
  deviceType: z.enum(['desktop', 'mobile', 'tablet']).optional(),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/, 'must be an ISO-3166 alpha-2 code').transform((s) => s.toUpperCase()).optional(),
  platform: optText(60),
});
export type OfferListQuery = z.infer<typeof offerListQuerySchema>;

export const OFFER_LIST_FROM = 'offers o\n  LEFT JOIN advertisers a ON a.id = o.advertiser_id AND a.network_id = o.network_id';

/** "(ref) name" — the advertiser label the page shows and the advertiser search matches. */
const ADVERTISER_LABEL = `(CASE WHEN a.ref IS NOT NULL THEN '(' || a.ref::text || ') ' || a.name ELSE a.name END)`;

/**
 * metadata.targeting.<key> allows `param`: no usable rule (not an object, bad mode, empty values)
 * → true; include → value listed; exclude → value not listed. Case-insensitive. `key` is one of two
 * constants, never request input. Nested CASE forces evaluation order so jsonb_array_length never
 * sees a non-array.
 */
function targetingAllows(key: 'country' | 'platform', param: string): string {
  const r = `o.metadata->'targeting'->'${key}'`;
  return `(CASE WHEN jsonb_typeof(${r}) = 'object' AND jsonb_typeof(${r}->'values') = 'array'
     THEN CASE WHEN (${r}->>'mode') IN ('include', 'exclude') AND jsonb_array_length(${r}->'values') > 0
       THEN ((${r}->>'mode') = 'include') = EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(${r}->'values') AS tv(v) WHERE lower(tv.v) = lower(${param}))
       ELSE true END
     ELSE true END)`;
}

/**
 * The offer's geo rules allow `param` (upper-case ISO code). Mirrors toOfferCountryDTO +
 * tracking/geo-rules.ts: '*' deny, or an allow-list without a '*' allow → only the allow-list;
 * otherwise everything except the deny-list. No rules at all → allows every country.
 */
function geoRulesAllow(param: string): string {
  return `COALESCE((
     SELECT CASE
              WHEN COALESCE(bool_or(g.country = '*' AND g.action = 'deny'), false)
                OR (COALESCE(bool_or(g.country <> '*' AND g.action = 'allow'), false)
                    AND NOT COALESCE(bool_or(g.country = '*' AND g.action = 'allow'), false))
              THEN COALESCE(bool_or(g.action = 'allow' AND g.country <> '*' AND upper(g.country) = ${param}), false)
              ELSE NOT COALESCE(bool_or(g.action = 'deny' AND g.country <> '*' AND upper(g.country) = ${param}), false)
            END
       FROM offer_geo_rules g
      WHERE g.network_id = $1 AND g.offer_id = o.id), true)`;
}

/** WHERE clauses for every filter (optionally without the status filter, for the status counts). */
export function offerWhere(p: SqlParams, q: OfferListQuery, opts: { skipStatus?: boolean } = {}): string[] {
  const w: string[] = ['o.network_id = $1'];
  if (q.search) {
    const pat = p.add(containsPattern(q.search));
    if (q.searchField === 'advertiser') w.push(`${ADVERTISER_LABEL} ILIKE ${pat} ESCAPE '\\'`);
    else if (q.searchField === 'id') w.push(`(o.ref::text ILIKE ${pat} ESCAPE '\\' OR o.id::text ILIKE ${pat} ESCAPE '\\')`);
    else w.push(`o.name ILIKE ${pat} ESCAPE '\\'`);
  }
  if (q.name) w.push(`o.name ILIKE ${p.add(containsPattern(q.name))} ESCAPE '\\'`);
  if (q.offerIds) {
    const ids = p.add(q.offerIds);
    w.push(`(o.ref::text = ANY(${ids}::text[]) OR o.id::text = ANY(${ids}::text[]))`);
  }
  if (q.status && !opts.skipStatus) w.push(`o.status = ANY(${p.add(q.status)}::text[])`);
  if (q.advertiserId) w.push(`o.advertiser_id = ANY(${p.add(q.advertiserId)}::uuid[])`);
  if (q.category) w.push(`lower(btrim(o.category)) = lower(btrim(${p.add(q.category)}::text))`);
  if (q.tagId) {
    w.push(`EXISTS (SELECT 1 FROM taggings t WHERE t.network_id = $1 AND t.entity_type = 'offer'
       AND t.entity_id = o.id AND t.tag_id = ANY(${p.add(q.tagId)}::uuid[]))`);
  }
  if (q.offerGroupId) {
    w.push(`EXISTS (SELECT 1 FROM offer_groups og WHERE og.network_id = $1
       AND og.id = ANY(${p.add(q.offerGroupId)}::uuid[]) AND og.offer_ids ? o.id::text)`);
  }
  if (q.accountManagerId) w.push(`a.account_manager_id = ANY(${p.add(q.accountManagerId)}::uuid[])`);
  if (q.salesManagerId) w.push(`a.sales_manager_id = ANY(${p.add(q.salesManagerId)}::uuid[])`);
  if (q.trackingDomainId) w.push(`o.tracking_domain_id = ANY(${p.add(q.trackingDomainId)}::uuid[])`);
  if (q.visibility) w.push(`COALESCE(o.visibility::text, 'public') = ANY(${p.add(q.visibility)}::text[])`);
  if (q.payoutType) w.push(`o.payout_model::text = ANY(${p.add(q.payoutType)}::text[])`);
  if (q.revenueType) {
    const models = Array.from(new Set(q.revenueType.map((t) => REVENUE_TYPE_TO_MODEL[t]!)));
    w.push(`o.payout_model::text = ANY(${p.add(models)}::text[])`);
  }
  if (q.objective) w.push(`COALESCE(o.objective::text, o.payout_model::text) = ANY(${p.add(q.objective)}::text[])`);
  if (q.deviceType) {
    w.push(`(COALESCE(cardinality(o.allowed_traffic_types), 0) = 0 OR ${p.add(q.deviceType)}::text = ANY(o.allowed_traffic_types))`);
  }
  if (q.country) {
    const cc = p.add(q.country);
    w.push(`${geoRulesAllow(`${cc}::text`)}`);
    w.push(targetingAllows('country', `${cc}::text`));
  }
  if (q.platform) w.push(targetingAllows('platform', `${p.add(q.platform)}::text`));
  return w;
}

/** Page + total (identical WHERE) + per-status counts for the current non-status filters. */
export function buildOfferListQuery(networkId: string, q: OfferListQuery): BuiltPagedList {
  const p = new SqlParams(networkId);
  const where = offerWhere(p, q);
  const { page, total } = assemblePaged({
    select: `o.*, a.name AS advertiser_name, a.ref::text AS advertiser_ref,
       a.account_manager_id AS advertiser_account_manager_id, a.sales_manager_id AS advertiser_sales_manager_id`,
    from: OFFER_LIST_FROM,
    where,
    params: p,
    orderExpr: OFFER_SORTS[q.sort],
    dir: q.dir,
    idExpr: 'o.id',
    page: q.page,
    pageSize: q.pageSize,
  });
  const sp = new SqlParams(networkId);
  const statuses = groupedCount(OFFER_LIST_FROM, offerWhere(sp, q, { skipStatus: true }), sp, 'o.status');
  return { page, total, counts: { statuses } };
}
