/**
 * View-through attribution (Attribution › Enable View-Through): a conversion that arrives with NO click id is
 * credited to the partner whose ad the visitor saw (an impression from /impression) within the offer's
 * view-through window (Attribution › viewThroughWindowHours, default 24 h). The impression is found by, in order:
 *
 *  1. its id on the conversion — `impression_id` / `imp_id` (the advertiser's or MMP's own view-through: the
 *     impression URL passed {imp_id} to them);
 *  2. the impression cookie the visitor's browser sends to the pixel (`_trkvt_<offer>`, set by /impression);
 *  3. the visitor's IP address on that offer (`offer_id` on the conversion; a postback passes the visitor's
 *     `ip`, a pixel / iframe uses the browser's) — the latest impression from it.
 *
 * Like a click, a matched impression becomes the conversion's "click" (record.ts input.click: offer, partner,
 * the rates frozen at impression time, sub ids, country / device); the conversion is marked 'view_through' and
 * its click_id is the impression id. A click always wins: this runs only when the conversion names no click.
 * Rejected impressions are never stored for it, and only offers with view-through on match.
 */
import { createHash } from 'node:crypto';
import { getRedis } from '../../../lib/redis.js';
import { query } from '../../../lib/db/pool.js';
import { getOfferConfig, type OfferConfig } from '../offer-cache.js';
import type { StoredClick } from '../click-store.js';

export const IMPRESSION_ID_PARAMS = ['impression_id', 'imp_id'] as const;
/** The impression cookie for an offer (its id without dashes). */
export const vtCookieName = (offerId: string) => `_trkvt_${offerId.replace(/-/g, '')}`;
const MAX_WINDOW_S = 30 * 86_400;

export const viewThroughWindowS = (offer: Pick<OfferConfig, 'attribution'> | null | undefined): number =>
  Math.min(Math.max(1, offer?.attribution?.viewThroughWindowHours ?? 24) * 3600, MAX_WINDOW_S);

const ipHash = (ip: string) => createHash('sha1').update(ip).digest('hex').slice(0, 16);
const impKey = (networkId: string, impressionId: string) => `imp:${networkId}:${impressionId}`;
const ipKey = (networkId: string, offerId: string, ip: string) => `vtip:${networkId}:${offerId}:${ipHash(ip)}`;
const IMP_ID_RE = /^[0-9a-f]{32}$/;

/** At /impression, for an offer with view-through on: keep the impression for its window (Redis only). */
export async function storeImpressionForViewThrough(
  networkId: string, impressionId: string, ip: string | null, rec: StoredClick, windowS: number,
): Promise<void> {
  const redis = getRedis();
  const multi = redis.multi().set(impKey(networkId, impressionId), JSON.stringify(rec), 'EX', windowS);
  if (ip) multi.set(ipKey(networkId, rec.offer_id, ip), impressionId, 'EX', windowS);
  await multi.exec();
}

interface ImpressionRow {
  impression_id: string; offer_id: string; publisher_id: string | null; created_at: string;
  resolved_payout: string | null; resolved_revenue: string | null; currency: string | null;
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  country: string | null; device: string | null; os: string | null; browser: string | null;
}

const COLS = `impression_id, offer_id, publisher_id, created_at, resolved_payout::text AS resolved_payout,
  resolved_revenue::text AS resolved_revenue, currency, sub1, sub2, sub3, sub4, sub5, country, device, os, browser`;
const VALID = 'array_length(fraud_flags, 1) IS NULL';

const toClick = (r: ImpressionRow): StoredClick => ({
  offer_id: r.offer_id, publisher_id: r.publisher_id, created_at: new Date(r.created_at).toISOString(),
  resolved_payout: r.resolved_payout, resolved_revenue: r.resolved_revenue, currency: r.currency,
  sub1: r.sub1, sub2: r.sub2, sub3: r.sub3, sub4: r.sub4, sub5: r.sub5,
  country: r.country, device: r.device, os: r.os, browser: r.browser,
});

/** The impression with this id — Redis, else the impressions table (valid ones only). */
async function byId(networkId: string, impressionId: string): Promise<StoredClick | null> {
  if (!IMP_ID_RE.test(impressionId)) return null;
  const cached = await getRedis().get(impKey(networkId, impressionId));
  if (cached) return JSON.parse(cached) as StoredClick;
  const { rows } = await query<ImpressionRow>(
    `SELECT ${COLS} FROM impressions WHERE impression_id = $1 AND network_id = $2 AND ${VALID} LIMIT 1`, [impressionId, networkId]);
  return rows[0] ? toClick(rows[0]) : null;
}

/** The offer's latest valid impression from this address within its window. */
async function byIp(networkId: string, offerId: string, ip: string, windowS: number): Promise<{ id: string; click: StoredClick } | null> {
  const id = await getRedis().get(ipKey(networkId, offerId, ip));
  if (id) {
    const click = await byId(networkId, id);
    if (click) return { id, click };
  }
  const { rows } = await query<ImpressionRow>(
    `SELECT ${COLS} FROM impressions
      WHERE network_id = $1 AND offer_id = $2 AND ip = $3::inet AND ${VALID} AND created_at >= now() - make_interval(secs => $4)
      ORDER BY created_at DESC LIMIT 1`, [networkId, offerId, ip, windowS]);
  return rows[0] ? { id: rows[0].impression_id, click: toClick(rows[0]) } : null;
}

export interface ViewThroughLookup {
  /** `impression_id` / `imp_id` on the conversion. */
  impressionId: string | null;
  /** The offer the conversion names (`offer_id`), for the cookie and address lookups. */
  offerId: string | null;
  /** The cookies the browser sent (pixel / iframe). */
  cookies: Record<string, string>;
  /** The visitor's address: the browser's, or a postback's `ip` parameter. */
  ip: string | null;
}

/**
 * The impression this click-less conversion is a view-through of, as its "click" — or null (no match, the offer
 * has view-through off, or the impression is older than the offer's window).
 */
export async function viewThroughClick(networkId: string, l: ViewThroughLookup): Promise<{ clickId: string; click: StoredClick } | null> {
  const within = async (impressionId: string, click: StoredClick | null) => {
    if (!click || (l.offerId && click.offer_id !== l.offerId)) return null;
    const offer = await getOfferConfig(networkId, click.offer_id);
    if (!offer?.attribution?.viewThrough) return null;
    const ageS = (Date.now() - new Date(click.created_at).getTime()) / 1000;
    return ageS <= viewThroughWindowS(offer) ? { clickId: impressionId, click } : null;
  };
  if (l.impressionId) return within(l.impressionId, await byId(networkId, l.impressionId));
  if (!l.offerId) return null;
  const cookie = l.cookies[vtCookieName(l.offerId)];
  if (cookie && IMP_ID_RE.test(cookie)) {
    const hit = await within(cookie, await byId(networkId, cookie));
    if (hit) return hit;
  }
  if (!l.ip) return null;
  const offer = await getOfferConfig(networkId, l.offerId);
  if (!offer?.attribution?.viewThrough) return null;
  const found = await byIp(networkId, l.offerId, l.ip, viewThroughWindowS(offer));
  return found ? within(found.id, found.click) : null;
}

/** The `Cookie` header as name → value (first wins). */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = Array.isArray(header) ? header.join('; ') : header ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}
