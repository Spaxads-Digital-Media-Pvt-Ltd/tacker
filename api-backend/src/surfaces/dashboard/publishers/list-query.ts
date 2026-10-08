/**
 * Manage Partners — paged list (`GET /api/publishers?paged=1`). Schema + PURE SQL builder, network id
 * always `$1`, every value bound. Semantics mirror the page's former client-side filters:
 *   - Tabs: pending = status pending; existing = not pending + linked portal account; unverified =
 *     not pending + no portal account.
 *   - Region: coarse buckets over the free-text `country` (ISO-2 code or English name, see
 *     COUNTRY_REGION); empty → "Unknown"; anything unmapped → "Other".
 *   - Payable (derived): portal account + payment method on file + active.
 *   - Payment method: case-insensitive on the trimmed value.
 *   - Tier: the publishers.tier text (exact), as the page always did.
 *   - Has Run Traffic / No Traffic: EXISTS a click for that publisher in this network (both = everyone).
 * Foreign ids (another network's user/tag/channel) simply match nothing.
 */
import { z } from 'zod';
import { csvList, queryBool } from '../../../lib/http/query-params.js';
import { containsPattern } from '../../../lib/db/like.js';
import {
  pagedBase, textList, SqlParams, assemblePaged, groupedCount, type BuiltPagedList,
} from '../../../lib/http/paged-list.js';

/** ISO-2 → region bucket. Same table the page used client-side. */
export const COUNTRY_REGION: Record<string, string> = {
  US: 'North America', CA: 'North America', MX: 'North America',
  GB: 'Europe', DE: 'Europe', FR: 'Europe', ES: 'Europe', IT: 'Europe', NL: 'Europe', IE: 'Europe',
  IN: 'Asia', CN: 'Asia', JP: 'Asia', SG: 'Asia', PH: 'Asia', KR: 'Asia',
  AU: 'Oceania', NZ: 'Oceania',
  BR: 'South America', AR: 'South America',
  AE: 'Middle East', IL: 'Middle East', SA: 'Middle East',
  ZA: 'Africa', NG: 'Africa', EG: 'Africa',
};
export const REGIONS = ['North America', 'Europe', 'Asia', 'Oceania', 'South America', 'Middle East', 'Africa', 'Other', 'Unknown'] as const;

/** Lower-case English names (and the page's aliases) for every mapped code. */
const NAME_ALIASES: Record<string, string> = { usa: 'US', 'united states of america': 'US', uk: 'GB' };
function englishNames(): Record<string, string> {
  const out: Record<string, string> = {};
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { dn = null; }
  for (const cc of Object.keys(COUNTRY_REGION)) {
    const name = dn?.of(cc);
    if (name && name !== cc) out[name.toLowerCase()] = cc;
  }
  return { ...out, ...NAME_ALIASES };
}
const NAME_TO_CODE = englishNames();

/** Region of one stored country value — the JS twin of the SQL predicate (used for option lists). */
export function regionOf(country: string | null | undefined): string {
  const v = (country ?? '').trim();
  if (!v) return 'Unknown';
  const cc = v.length === 2 ? v.toUpperCase() : null;
  const code = (cc && COUNTRY_REGION[cc] ? cc : null) ?? NAME_TO_CODE[v.toLowerCase()] ?? null;
  return (code && COUNTRY_REGION[code]) || 'Other';
}

/** Codes + lower-case names belonging to the given regions. */
function regionKeys(regions: readonly string[]): { codes: string[]; names: string[] } {
  const codes = Object.entries(COUNTRY_REGION).filter(([, r]) => regions.includes(r)).map(([c]) => c);
  const names = Object.entries(NAME_TO_CODE).filter(([, c]) => codes.includes(c)).map(([n]) => n);
  return { codes, names };
}

export const PUBLISHER_SORTS = {
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
  id: 'p.ref',
  name: 'lower(p.name)',
  status: 'p.status',
  country: 'lower(p.country)',
} as const;
const SORT_KEYS = Object.keys(PUBLISHER_SORTS) as [keyof typeof PUBLISHER_SORTS, ...(keyof typeof PUBLISHER_SORTS)[]];
const STATUSES = ['active', 'pending', 'inactive'] as const;
const uuid = z.string().uuid();

export const publisherListQuerySchema = z.object({
  ...pagedBase(SORT_KEYS, 'createdAt'),
  tab: z.enum(['existing', 'pending', 'unverified']).optional(),
  search: z.string().trim().max(200).optional().transform((s) => (s ? s : undefined)),
  status: csvList(z.enum(STATUSES)),
  accountExecutiveId: csvList(uuid),
  partnerManagerId: csvList(uuid),
  channelId: csvList(uuid),
  label: csvList(uuid),
  billingFrequency: textList(60),
  country: textList(100),
  region: csvList(z.enum(REGIONS)),
  tier: textList(60),
  paymentMethod: textList(60),
  paymentTerms: textList(500),
  payable: csvList(z.enum(['yes', 'no'])),
  hasRunTraffic: queryBool,
  noTraffic: queryBool,
});
export type PublisherListQuery = z.infer<typeof publisherListQuerySchema>;

export const PUBLISHER_LIST_FROM = `publishers p
  LEFT JOIN publishers rp ON rp.id = p.referred_by_id AND rp.network_id = p.network_id
  LEFT JOIN segmentation_channels sc ON sc.id = p.channel_id AND sc.network_id = p.network_id`;

/** JS-style trim (spaces, tabs, newlines) of the free-text country. */
const COUNTRY = `btrim(p.country, ' ' || chr(9) || chr(10) || chr(13))`;
const PAYABLE = `(p.auth_user_id IS NOT NULL AND p.payment_method IS NOT NULL AND p.payment_method <> '' AND p.status = 'active')`;

export function tabWhere(tab: PublisherListQuery['tab'], alias = 'p'): string | null {
  if (tab === 'pending') return `${alias}.status = 'pending'`;
  if (tab === 'unverified') return `(${alias}.status <> 'pending' AND ${alias}.auth_user_id IS NULL)`;
  if (tab === 'existing') return `(${alias}.status <> 'pending' AND ${alias}.auth_user_id IS NOT NULL)`;
  return null;
}

export function publisherWhere(p: SqlParams, q: PublisherListQuery, opts: { skipStatus?: boolean } = {}): string[] {
  const w: string[] = ['p.network_id = $1'];
  const tab = tabWhere(q.tab);
  if (tab) w.push(tab);
  if (q.status && !opts.skipStatus) w.push(`p.status = ANY(${p.add(q.status)}::text[])`);
  if (q.search) w.push(`p.name ILIKE ${p.add(containsPattern(q.search))} ESCAPE '\\'`);
  if (q.accountExecutiveId) w.push(`p.account_executive_id = ANY(${p.add(q.accountExecutiveId)}::uuid[])`);
  if (q.partnerManagerId) w.push(`p.partner_manager_id = ANY(${p.add(q.partnerManagerId)}::uuid[])`);
  if (q.channelId) w.push(`p.channel_id = ANY(${p.add(q.channelId)}::uuid[])`);
  if (q.label) {
    w.push(`EXISTS (SELECT 1 FROM taggings t WHERE t.network_id = $1 AND t.entity_type = 'publisher'
       AND t.entity_id = p.id AND t.tag_id = ANY(${p.add(q.label)}::uuid[]))`);
  }
  if (q.billingFrequency) w.push(`p.billing_frequency = ANY(${p.add(q.billingFrequency)}::text[])`);
  if (q.country) w.push(`p.country = ANY(${p.add(q.country)}::text[])`);
  if (q.region) {
    const ors: string[] = [];
    if (q.region.includes('Unknown')) ors.push(`(p.country IS NULL OR ${COUNTRY} = '')`);
    const named = q.region.filter((r) => r !== 'Other' && r !== 'Unknown');
    if (named.length) {
      const k = regionKeys(named);
      ors.push(`(upper(${COUNTRY}) = ANY(${p.add(k.codes)}::text[]) OR lower(${COUNTRY}) = ANY(${p.add(k.names)}::text[]))`);
    }
    if (q.region.includes('Other')) {
      const all = regionKeys(REGIONS);
      ors.push(`(${COUNTRY} <> '' AND NOT (upper(${COUNTRY}) = ANY(${p.add(all.codes)}::text[])
         OR lower(${COUNTRY}) = ANY(${p.add(all.names)}::text[])))`);
    }
    w.push(`(${ors.join(' OR ')})`);
  }
  if (q.tier) w.push(`p.tier = ANY(${p.add(q.tier)}::text[])`);
  if (q.paymentMethod) {
    w.push(`lower(btrim(p.payment_method)) = ANY(${p.add(q.paymentMethod.map((m) => m.trim().toLowerCase()))}::text[])`);
  }
  if (q.paymentTerms) w.push(`p.payout_terms = ANY(${p.add(q.paymentTerms)}::text[])`);
  if (q.payable && q.payable.length === 1) w.push(q.payable[0] === 'yes' ? PAYABLE : `NOT ${PAYABLE}`);
  // "Has Run Traffic" + "No Traffic" together means everyone, not nobody.
  if (q.hasRunTraffic && !q.noTraffic) w.push(`EXISTS (SELECT 1 FROM clicks c WHERE c.network_id = $1 AND c.publisher_id = p.id)`);
  if (q.noTraffic && !q.hasRunTraffic) w.push(`NOT EXISTS (SELECT 1 FROM clicks c WHERE c.network_id = $1 AND c.publisher_id = p.id)`);
  return w;
}

/** Page + total (identical WHERE) + tab badges (whole network, like the page always showed) + status
 * counts for the current tab and non-status filters. */
export function buildPublisherListQuery(networkId: string, q: PublisherListQuery): BuiltPagedList {
  const p = new SqlParams(networkId);
  const { page, total } = assemblePaged({
    select: `p.*, rp.name AS referred_by_name, sc.name AS channel_name`,
    from: PUBLISHER_LIST_FROM,
    where: publisherWhere(p, q),
    params: p,
    orderExpr: PUBLISHER_SORTS[q.sort],
    dir: q.dir,
    idExpr: 'p.id',
    page: q.page,
    pageSize: q.pageSize,
  });
  const sp = new SqlParams(networkId);
  const statuses = groupedCount('publishers p', publisherWhere(sp, q, { skipStatus: true }), sp, 'p.status');
  const tp = new SqlParams(networkId);
  const tabs = groupedCount('publishers p', ['p.network_id = $1'], tp,
    `CASE WHEN p.status = 'pending' THEN 'pending' WHEN p.auth_user_id IS NULL THEN 'unverified' ELSE 'existing' END`);
  return { page, total, counts: { statuses, tabs } };
}
