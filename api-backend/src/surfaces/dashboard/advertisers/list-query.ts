/**
 * Manage Advertisers — paged list (`GET /api/advertisers?paged=1`). Schema + PURE SQL builder,
 * network id always `$1`, every value bound. Semantics mirror the page's former client-side filters:
 *   - Tabs: pending = status pending; existing = not pending + linked portal account; unverified =
 *     not pending + no portal account.
 *   - Search: name contains (case-insensitive).
 * Foreign ids (another network's user/tag) simply match nothing.
 */
import { z } from 'zod';
import { csvList } from '../../../lib/http/query-params.js';
import { containsPattern } from '../../../lib/db/like.js';
import {
  pagedBase, textList, SqlParams, assemblePaged, groupedCount, type BuiltPagedList,
} from '../../../lib/http/paged-list.js';

export const ADVERTISER_SORTS = {
  createdAt: 'a.created_at',
  updatedAt: 'a.updated_at',
  id: 'a.ref',
  name: 'lower(a.name)',
  status: 'a.status',
} as const;
const SORT_KEYS = Object.keys(ADVERTISER_SORTS) as [keyof typeof ADVERTISER_SORTS, ...(keyof typeof ADVERTISER_SORTS)[]];
const uuid = z.string().uuid();

export const advertiserListQuerySchema = z.object({
  ...pagedBase(SORT_KEYS, 'createdAt'),
  tab: z.enum(['existing', 'pending', 'unverified']).optional(),
  search: z.string().trim().max(200).optional().transform((s) => (s ? s : undefined)),
  status: csvList(z.enum(['active', 'pending', 'inactive'])),
  accountManagerId: csvList(uuid),
  salesManagerId: csvList(uuid),
  billingFrequency: textList(60),
  label: csvList(uuid),
});
export type AdvertiserListQuery = z.infer<typeof advertiserListQuerySchema>;

function tabWhere(tab: AdvertiserListQuery['tab']): string | null {
  if (tab === 'pending') return `a.status = 'pending'`;
  if (tab === 'unverified') return `(a.status <> 'pending' AND a.auth_user_id IS NULL)`;
  if (tab === 'existing') return `(a.status <> 'pending' AND a.auth_user_id IS NOT NULL)`;
  return null;
}

export function advertiserWhere(p: SqlParams, q: AdvertiserListQuery, opts: { skipStatus?: boolean } = {}): string[] {
  const w: string[] = ['a.network_id = $1'];
  const tab = tabWhere(q.tab);
  if (tab) w.push(tab);
  if (q.status && !opts.skipStatus) w.push(`a.status = ANY(${p.add(q.status)}::text[])`);
  if (q.search) w.push(`a.name ILIKE ${p.add(containsPattern(q.search))} ESCAPE '\\'`);
  if (q.accountManagerId) w.push(`a.account_manager_id = ANY(${p.add(q.accountManagerId)}::uuid[])`);
  if (q.salesManagerId) w.push(`a.sales_manager_id = ANY(${p.add(q.salesManagerId)}::uuid[])`);
  if (q.billingFrequency) w.push(`a.billing_frequency = ANY(${p.add(q.billingFrequency)}::text[])`);
  if (q.label) {
    w.push(`EXISTS (SELECT 1 FROM taggings t WHERE t.network_id = $1 AND t.entity_type = 'advertiser'
       AND t.entity_id = a.id AND t.tag_id = ANY(${p.add(q.label)}::uuid[]))`);
  }
  return w;
}

/** Page + total (identical WHERE) + tab badges (whole network, as the page always showed) + status
 * counts for the current tab and non-status filters. */
export function buildAdvertiserListQuery(networkId: string, q: AdvertiserListQuery): BuiltPagedList {
  const p = new SqlParams(networkId);
  const { page, total } = assemblePaged({
    select: 'a.*',
    from: 'advertisers a',
    where: advertiserWhere(p, q),
    params: p,
    orderExpr: ADVERTISER_SORTS[q.sort],
    dir: q.dir,
    idExpr: 'a.id',
    page: q.page,
    pageSize: q.pageSize,
  });
  const sp = new SqlParams(networkId);
  const statuses = groupedCount('advertisers a', advertiserWhere(sp, q, { skipStatus: true }), sp, 'a.status');
  const tp = new SqlParams(networkId);
  const tabs = groupedCount('advertisers a', ['a.network_id = $1'], tp,
    `CASE WHEN a.status = 'pending' THEN 'pending' WHEN a.auth_user_id IS NULL THEN 'unverified' ELSE 'existing' END`);
  return { page, total, counts: { statuses, tabs } };
}
