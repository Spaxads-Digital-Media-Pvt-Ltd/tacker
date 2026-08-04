/**
 * Async fraud scan (spec §10 — "heavy scoring runs async"). Aggregates recent clicks/conversions
 * per publisher and raises alerts for datacenter-heavy traffic, conversion-rate spikes, and
 * fast-conversion clusters — all against the network's configurable thresholds. Runs off the hot
 * path (scheduled repeatable job + `npm run fraud-scan`). Alerts feed the AI ops layer (Phase 7).
 */
import { query } from '../db/pool.js';
import { getFraudConfig } from './rules.js';
import { raiseAlert } from './alerts.js';

export interface ScanResult {
  networksScanned: number;
  alertsRaised: number;
}

interface ClickAgg { publisher_id: string; clicks: number; dc: number }
interface ConvAgg { publisher_id: string; conv: number; fast: number }

async function scanNetwork(networkId: string): Promise<number> {
  const cfg = await getFraudConfig(networkId);
  if (!cfg.enabled) return 0;

  const since = new Date(Date.now() - cfg.scanWindowHours * 3600_000).toISOString();

  const clicks = (await query<ClickAgg>(
    `SELECT publisher_id,
            COUNT(*)::int AS clicks,
            COUNT(*) FILTER (WHERE 'datacenter_ip' = ANY(fraud_flags))::int AS dc
       FROM clicks
      WHERE network_id = $1 AND publisher_id IS NOT NULL AND created_at >= $2
      GROUP BY publisher_id`,
    [networkId, since],
  )).rows;

  const convs = (await query<ConvAgg>(
    `SELECT publisher_id,
            COUNT(*)::int AS conv,
            COUNT(*) FILTER (WHERE 'too_fast' = ANY(fraud_flags))::int AS fast
       FROM conversions
      WHERE network_id = $1 AND publisher_id IS NOT NULL AND status = 'approved' AND created_at >= $2
      GROUP BY publisher_id`,
    [networkId, since],
  )).rows;

  const convByPub = new Map(convs.map((c) => [c.publisher_id, c]));
  let raised = 0;

  for (const c of clicks) {
    const cv = convByPub.get(c.publisher_id);
    const conv = cv?.conv ?? 0;
    const fast = cv?.fast ?? 0;
    if (c.clicks < cfg.minClicksForCrAlert) continue; // need volume before alerting

    const dcRatio = c.clicks > 0 ? c.dc / c.clicks : 0;
    if (dcRatio >= cfg.datacenterRatioThreshold) {
      if (await raiseAlert(networkId, {
        type: 'high_datacenter_traffic', severity: 'high', entityType: 'publisher', entityId: c.publisher_id,
        title: 'High datacenter traffic',
        description: `${(dcRatio * 100).toFixed(0)}% of ${c.clicks} clicks came from datacenter IPs.`,
        metadata: { clicks: c.clicks, datacenter: c.dc, ratio: Number(dcRatio.toFixed(3)) },
      })) raised++;
    }

    const cr = c.clicks > 0 ? conv / c.clicks : 0;
    if (cr >= cfg.crSpikeThreshold) {
      if (await raiseAlert(networkId, {
        type: 'cr_spike', severity: 'high', entityType: 'publisher', entityId: c.publisher_id,
        title: 'Conversion-rate spike',
        description: `CR of ${(cr * 100).toFixed(0)}% over ${c.clicks} clicks / ${conv} conversions.`,
        metadata: { clicks: c.clicks, conversions: conv, cr: Number(cr.toFixed(3)) },
      })) raised++;
    }

    if (conv > 0 && fast / conv >= 0.5) {
      if (await raiseAlert(networkId, {
        type: 'fast_conversions', severity: 'medium', entityType: 'publisher', entityId: c.publisher_id,
        title: 'Fast-conversion cluster',
        description: `${fast} of ${conv} conversions fired faster than the click-to-conversion threshold.`,
        metadata: { conversions: conv, fast },
      })) raised++;
    }
  }
  return raised;
}

export async function runFraudScan(networkId?: string): Promise<ScanResult> {
  const targets = networkId
    ? [networkId]
    : (await query<{ id: string }>(`SELECT id FROM networks WHERE status = 'active'`)).rows.map((r) => r.id);
  let alertsRaised = 0;
  for (const n of targets) alertsRaised += await scanNetwork(n);
  return { networksScanned: targets.length, alertsRaised };
}
