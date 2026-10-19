/**
 * Smart-Link KPI rotation (audit F-17b). A worker scores every item of each active KPI smart link
 * over the link's lookback window — CVR (conversions / clicks), EPC (payout / clicks) or Revenue
 * (revenue / clicks: per click, so an offer isn't favoured just for having had more traffic) — from
 * the link's own clicks and their approved conversions, and stores the weight /sl picks with.
 *
 * DECISION — the weights: once at least one item has kpi_min_clicks (default 50) clicks and a score
 * above zero, the best-scoring item(s) share 80% of the traffic and every other item shares the
 * remaining 20% (at least 1 point each) — so the winner gets most traffic while the rest keep being
 * measured and can overtake it. Before that (no qualified item, or nothing converts yet) nothing is
 * stored and /sl rotates evenly. A link is re-scored every kpi_run_frequency_hours (default 1h).
 */
import { query } from '../db/pool.js';
import { invalidateSmartLinkConfig } from '../../surfaces/tracking/smart-link-cache.js';
import { logger } from '../logger.js';
import { rejectedClickSql } from '../click-rejections.js';

export type KpiMetric = 'CVR' | 'EPC' | 'Revenue';
export interface KpiItemStats { id: string; clicks: number; conversions: number; payout: string; revenue: string }
export interface KpiResult { weight: number | null; score: number | null; clicks: number }

export const DEFAULT_MIN_CLICKS = 50;
const DEFAULT_LOOKBACK_H = 24;
const DEFAULT_EVERY_H = 1;
const WINNER_SHARE = 80;
const EXPLORE_SHARE = 20;

function score(s: KpiItemStats, metric: KpiMetric): number {
  if (s.clicks <= 0) return 0;
  const num = metric === 'CVR' ? s.conversions : Number(metric === 'EPC' ? s.payout : s.revenue);
  return num / s.clicks; // a ranking signal, not money that is stored or paid
}

/** Weights for one link's items (pure). */
export function kpiWeights(items: KpiItemStats[], metric: KpiMetric, minClicks = DEFAULT_MIN_CLICKS): Map<string, KpiResult> {
  const scored = items.map((s) => ({ s, qualified: s.clicks >= minClicks, score: score(s, metric) }));
  const best = Math.max(0, ...scored.filter((x) => x.qualified).map((x) => x.score));
  const out = new Map<string, KpiResult>();
  if (best <= 0) {
    for (const x of scored) out.set(x.s.id, { weight: null, score: x.qualified ? x.score : null, clicks: x.s.clicks });
    return out;
  }
  const winners = scored.filter((x) => x.qualified && x.score === best);
  const others = scored.filter((x) => !winners.includes(x));
  const winnerShare = others.length ? WINNER_SHARE : 100;
  for (const x of winners) out.set(x.s.id, { weight: Math.max(1, Math.round(winnerShare / winners.length)), score: x.score, clicks: x.s.clicks });
  for (const x of others) {
    out.set(x.s.id, { weight: Math.max(1, Math.round(EXPLORE_SHARE / others.length)), score: x.qualified ? x.score : null, clicks: x.s.clicks });
  }
  return out;
}

interface LinkRow {
  id: string; network_id: string; kpi_metric: string | null; kpi_lookback_hours: number | null; kpi_min_clicks: number | null;
}

async function scoreLink(link: LinkRow, now: Date): Promise<void> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - (link.kpi_lookback_hours ?? DEFAULT_LOOKBACK_H) * 3600_000).toISOString();
  // Per item: the link's clicks on its offer in the window, and those clicks' approved conversions.
  const { rows } = await query<{ id: string; clicks: number; conversions: number; payout: string; revenue: string }>(
    `WITH k AS (
       SELECT offer_id, COUNT(*)::int AS clicks FROM clicks
        WHERE network_id = $1 AND smart_link_id = $2 AND created_at >= $3 AND created_at <= $4 AND NOT ${rejectedClickSql()}
        GROUP BY offer_id
     ), c AS (
       SELECT cl.offer_id, COUNT(*)::int AS conversions,
              COALESCE(SUM(cv.payout), 0)::text AS payout, COALESCE(SUM(cv.revenue), 0)::text AS revenue
         FROM conversions cv JOIN clicks cl ON cl.network_id = cv.network_id AND cl.click_id = cv.click_id
        WHERE cv.network_id = $1 AND cv.status = 'approved'
          AND cl.smart_link_id = $2 AND cl.created_at >= $3 AND cl.created_at <= $4
        GROUP BY cl.offer_id
     )
     SELECT i.id, COALESCE(k.clicks, 0) AS clicks, COALESCE(c.conversions, 0) AS conversions,
            COALESCE(c.payout, '0') AS payout, COALESCE(c.revenue, '0') AS revenue
       FROM smart_link_items i
       LEFT JOIN k ON k.offer_id = i.offer_id
       LEFT JOIN c ON c.offer_id = i.offer_id
      WHERE i.network_id = $1 AND i.smart_link_id = $2`,
    [link.network_id, link.id, from, to]);
  const metric: KpiMetric = link.kpi_metric === 'EPC' || link.kpi_metric === 'Revenue' ? link.kpi_metric : 'CVR';
  const weights = kpiWeights(rows, metric, link.kpi_min_clicks ?? DEFAULT_MIN_CLICKS);
  for (const [id, w] of weights) {
    await query(
      'UPDATE smart_link_items SET kpi_weight = $3, kpi_score = $4, kpi_clicks = $5 WHERE network_id = $1 AND id = $2',
      [link.network_id, id, w.weight, w.score == null ? null : w.score.toFixed(8), w.clicks]);
  }
  await query('UPDATE smart_links SET kpi_computed_at = $3 WHERE network_id = $1 AND id = $2', [link.network_id, link.id, now]);
  await invalidateSmartLinkConfig(link.network_id, link.id);
}

/** Re-score every active KPI link that is due (never scored, or scored kpi_run_frequency_hours ago). */
export async function rescoreKpiSmartLinks(now: Date = new Date(), networkId?: string): Promise<{ links: number; errors: number }> {
  const { rows } = await query<LinkRow>(
    `SELECT id, network_id, kpi_metric, kpi_lookback_hours, kpi_min_clicks FROM smart_links
      WHERE status = 'active' AND redirect_mechanism = 'kpi'
        AND (kpi_computed_at IS NULL OR kpi_computed_at <= $1::timestamptz - make_interval(hours => COALESCE(kpi_run_frequency_hours, ${DEFAULT_EVERY_H})))
        ${networkId ? 'AND network_id = $2' : ''}`,
    networkId ? [now, networkId] : [now]);
  let errors = 0;
  for (const link of rows) {
    try {
      await scoreLink(link, now);
    } catch (err) {
      errors++;
      logger.warn({ err, smartLinkId: link.id }, 'smart link KPI scoring failed');
    }
  }
  return { links: rows.length, errors };
}
