/**
 * Per-network fraud rules (spec §10 — "make fraud rules configurable per network"). Stored as jsonb
 * in fraud_rules, merged over sane defaults so every network has a full config even before tuning.
 */
import { query } from '../db/pool.js';

export interface FraudConfig {
  enabled: boolean;
  /** Clicks/min from one IP before flagging high velocity (hot-path pre-signal + scan). */
  velocityPerMinute: number;
  /** Fraction (0..1) of a publisher's clicks from datacenter IPs to raise an alert. */
  datacenterRatioThreshold: number;
  /** A conversion faster than this many seconds after its click is suspicious. */
  minClickToConversionSeconds: number;
  /** Conversion rate above this (with enough volume) is a CR spike. */
  crSpikeThreshold: number;
  /** Minimum clicks in the window before a CR alert can fire (avoid tiny-sample noise). */
  minClicksForCrAlert: number;
  /** Lookback window for the async scan. */
  scanWindowHours: number;
}

export const DEFAULT_FRAUD_CONFIG: FraudConfig = {
  enabled: true,
  velocityPerMinute: 30,
  datacenterRatioThreshold: 0.5,
  minClickToConversionSeconds: 5,
  crSpikeThreshold: 0.5,
  minClicksForCrAlert: 20,
  scanWindowHours: 24,
};

export async function getFraudConfig(networkId: string): Promise<FraudConfig> {
  const { rows } = await query<{ config: Partial<FraudConfig> }>(
    `SELECT config FROM fraud_rules WHERE network_id = $1`, [networkId],
  );
  return { ...DEFAULT_FRAUD_CONFIG, ...(rows[0]?.config ?? {}) };
}

export async function setFraudConfig(networkId: string, patch: Partial<FraudConfig>): Promise<FraudConfig> {
  const merged = { ...(await getFraudConfig(networkId)), ...patch };
  await query(
    `INSERT INTO fraud_rules (network_id, config) VALUES ($1, $2)
     ON CONFLICT (network_id) DO UPDATE SET config = EXCLUDED.config`,
    [networkId, JSON.stringify(merged)],
  );
  return merged;
}
