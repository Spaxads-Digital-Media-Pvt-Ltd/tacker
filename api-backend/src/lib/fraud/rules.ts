/**
 * Per-network fraud rules (spec §10 — "make fraud rules configurable per network"). Stored as jsonb
 * in fraud_rules, merged over sane defaults so every network has a full config even before tuning.
 */
import { query } from '../db/pool.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import { decryptSecret, encryptSecret, isEncrypted } from '../crypto/secret-box.js';
import type { AlertChannels } from '../alerts/deliver.js';

/** Points each click signal adds to its fraud score (the score is capped at 100). */
export interface FraudWeights {
  datacenter: number;
  velocity: number;
  /** Headless / automation / scripted user agents (and none at all). */
  botUserAgent: number;
  /** IPQualityScore verdicts for the click's IP (cached per IP by the click worker — F-23). */
  ipqsProxy: number;
  ipqsVpn: number;
  ipqsTor: number;
  ipqsBot: number;
}

export interface FraudConfig {
  enabled: boolean;
  /** Clicks/min from one IP before flagging high velocity (hot-path pre-signal + scan). */
  velocityPerMinute: number;
  /** Fraction (0..1) of a publisher's clicks from datacenter IPs to raise an alert. */
  datacenterRatioThreshold: number;
  /** Fraction (0..1) of a publisher's clicks flagged as bots (bot / no user agent, IPQS bot) to raise an alert. */
  botRatioThreshold: number;
  /** Fraction (0..1) of a publisher's clicks from proxies / VPNs / Tor (IPQS verdicts) to raise an alert. */
  proxyRatioThreshold: number;
  /** A conversion faster than this many seconds after its click is suspicious. */
  minClickToConversionSeconds: number;
  /** Conversion rate above this (with enough volume) is a CR spike. */
  crSpikeThreshold: number;
  /** Minimum clicks in the window before a CR alert can fire (avoid tiny-sample noise). */
  minClicksForCrAlert: number;
  /** Lookback window for the async scan. */
  scanWindowHours: number;
  /**
   * Divert a click at /click when its fraud score reaches this (0–100) — F-23. null = never block,
   * only flag (the default, so turning this on is the network's decision).
   */
  blockScore: number | null;
  weights: FraudWeights;
  /** Where newly raised fraud alerts are delivered (lib/alerts/deliver.ts). */
  alertEmails: string[];
  /** Stored encrypted (it often carries a token, e.g. a Slack hook); the API only ever shows it masked. */
  alertWebhookUrl: string | null;
}

export const DEFAULT_FRAUD_WEIGHTS: FraudWeights = {
  datacenter: 40, velocity: 30, botUserAgent: 50, ipqsProxy: 30, ipqsVpn: 25, ipqsTor: 50, ipqsBot: 50,
};

export const DEFAULT_FRAUD_CONFIG: FraudConfig = {
  enabled: true,
  velocityPerMinute: 30,
  datacenterRatioThreshold: 0.5,
  botRatioThreshold: 0.3,
  proxyRatioThreshold: 0.3,
  minClickToConversionSeconds: 5,
  crSpikeThreshold: 0.5,
  minClicksForCrAlert: 20,
  scanWindowHours: 24,
  blockScore: null,
  weights: DEFAULT_FRAUD_WEIGHTS,
  alertEmails: [],
  alertWebhookUrl: null,
};

export type FraudConfigPatch = Partial<Omit<FraudConfig, 'weights'>> & { weights?: Partial<FraudWeights> };

const merge = (base: FraudConfig, patch: FraudConfigPatch | null | undefined): FraudConfig => ({
  ...base, ...(patch ?? {}), weights: { ...base.weights, ...(patch?.weights ?? {}) },
});

export async function getFraudConfig(networkId: string): Promise<FraudConfig> {
  const { rows } = await query<{ config: FraudConfigPatch }>(
    `SELECT config FROM fraud_rules WHERE network_id = $1`, [networkId],
  );
  return merge(DEFAULT_FRAUD_CONFIG, rows[0]?.config);
}

const cacheKey = (networkId: string) => `fraudcfg:${networkId}`;

/**
 * The fraud config for the /click hot path: Redis first (load-through, 5 min, busted by
 * setFraudConfig), Postgres only on a cold key. Redis/DB trouble → the defaults (never blocks).
 */
export async function getFraudConfigCached(networkId: string): Promise<FraudConfig> {
  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey(networkId));
    if (cached) return JSON.parse(cached) as FraudConfig;
    const cfg = await getFraudConfig(networkId);
    await redis.set(cacheKey(networkId), JSON.stringify(cfg), 'EX', 300);
    return cfg;
  } catch (err) {
    logger.warn({ err, networkId }, 'fraud config unavailable — using defaults');
    return DEFAULT_FRAUD_CONFIG;
  }
}

export async function setFraudConfig(networkId: string, patch: FraudConfigPatch): Promise<FraudConfig> {
  const hook = patch.alertWebhookUrl;
  if (hook && !isEncrypted(hook)) patch = { ...patch, alertWebhookUrl: encryptSecret(hook) };
  const merged = merge(await getFraudConfig(networkId), patch);
  await query(
    `INSERT INTO fraud_rules (network_id, config) VALUES ($1, $2)
     ON CONFLICT (network_id) DO UPDATE SET config = EXCLUDED.config`,
    [networkId, JSON.stringify(merged)],
  );
  await getRedis().del(cacheKey(networkId));
  return merged;
}

/** Origin only ("https://hooks.example.com/…"), so the path/query — where a hook's token lives — never shows. */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' && !u.search ? u.origin : `${u.origin}/…`;
  } catch {
    return '…';
  }
}

/** The config as the API shows it: the webhook masked, plus whether one is set. */
export function fraudConfigView(cfg: FraudConfig): FraudConfig & { alertWebhookUrlSet: boolean } {
  let hook: string | null = null;
  if (cfg.alertWebhookUrl) {
    try { hook = maskUrl(decryptSecret(cfg.alertWebhookUrl)); } catch { hook = '…'; }
  }
  return { ...cfg, alertWebhookUrl: hook, alertWebhookUrlSet: Boolean(cfg.alertWebhookUrl) };
}

/** The alert delivery channels in a network's fraud rules (the webhook decrypted for sending). */
export function fraudAlertChannels(networkId: string, cfg: FraudConfig): AlertChannels {
  let webhookUrl: string | null = null;
  if (cfg.alertWebhookUrl) {
    try {
      webhookUrl = decryptSecret(cfg.alertWebhookUrl);
    } catch (err) {
      logger.warn({ err, networkId }, 'fraud alert webhook could not be decrypted — not sent');
    }
  }
  return { emails: cfg.alertEmails, webhookUrl };
}
