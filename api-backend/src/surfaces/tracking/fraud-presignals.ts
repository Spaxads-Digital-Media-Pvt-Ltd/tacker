/**
 * CHEAP fraud pre-signals only (spec §5 step 9, §10). Heavy scoring runs async later (Phase 6);
 * here we do a datacenter-IP flag, a per-IP velocity counter (one Redis INCR), a bot / headless /
 * scripted user-agent check (in-process regex) and — on offers with IPQualityScore on — the IP's
 * cached IPQS verdict (one Redis GET, sent alongside the INCR; the click-persist worker fills that
 * cache, so an IP's first click is scored without it). Points per signal and the velocity limit come
 * from the network's fraud rules (F-23). Never block on the hot path beyond these — capped work,
 * bounded latency.
 */
import { createHash } from 'node:crypto';
import { getRedis } from '../../lib/redis.js';
import type { FraudConfig, FraudWeights } from '../../lib/fraud/rules.js';
import { ipqsCacheKey, parseIpqsVerdict, type IpqsResult } from '../../lib/integrations/ipqs.js';

const VELOCITY_WINDOW_S = 60;

export interface PreSignals {
  score: number;
  flags: string[];
}

export interface PreSignalInput {
  networkId: string;
  ip: string | null;
  isDatacenter: boolean;
  userAgent: string | null;
  /** The offer has IPQualityScore fraud detection on: fold in the IP's cached verdict. */
  ipqs: boolean;
}

/**
 * Headless browsers and automation drivers, HTTP libraries and CLI tools, crawlers and link-preview
 * bots. "bot" only as its own word or a product token ("Googlebot/2.1", "AdsBot-Google"), so device
 * names that merely contain it (a "CUBOT X30" phone) don't match.
 */
const BOT_UA = /headlesschrome|phantomjs|slimerjs|selenium|webdriver|puppeteer|playwright|curl\/|wget\/|python-requests|python-urllib|aiohttp|go-http-client|apache-httpclient|java\/\d|libwww-perl|node-fetch|axios\/|scrapy|facebookexternalhit|\bbot\b|bot[/-]|crawler|spider|scraper/i;

export const isBotUserAgent = (ua: string): boolean => BOT_UA.test(ua);

const IPQS_WEIGHT: Record<string, keyof FraudWeights> = {
  ipqs_proxy: 'ipqsProxy', ipqs_vpn: 'ipqsVpn', ipqs_tor: 'ipqsTor', ipqs_bot: 'ipqsBot',
};

/**
 * Fold an IPQualityScore verdict into a click's signals: each of its flags not already on the click
 * adds that flag's weight, and the score is at least IPQS's own fraud_score. Idempotent, so the
 * click-persist worker can apply a verdict the click may already have been scored with.
 */
export function foldIpqsVerdict(base: PreSignals, verdict: IpqsResult, weights: FraudWeights): PreSignals {
  const flags = [...base.flags];
  let score = base.score;
  for (const f of verdict.flags) {
    if (flags.includes(f)) continue;
    flags.push(f);
    const w = IPQS_WEIGHT[f];
    if (w) score += weights[w];
  }
  return { score: Math.min(Math.max(score, verdict.score), 100), flags };
}

export async function fraudPreSignals(input: PreSignalInput, cfg: FraudConfig): Promise<PreSignals> {
  const w = cfg.weights;
  const flags: string[] = [];
  let score = 0;

  if (input.isDatacenter) {
    flags.push('datacenter_ip');
    score += w.datacenter;
  }

  const ua = input.userAgent?.trim() ?? '';
  if (!ua || isBotUserAgent(ua)) {
    flags.push(ua ? 'bot_user_agent' : 'no_user_agent');
    score += w.botUserAgent;
  }

  let verdict: IpqsResult | null = null;
  if (input.ip) {
    const redis = getRedis();
    // Per network (F-23): the limit is the network's own, so only its own clicks count toward it.
    const key = `vel:${input.networkId}:${createHash('sha1').update(input.ip).digest('hex').slice(0, 16)}`;
    const [n, cached] = await Promise.all([
      redis.incr(key),
      input.ipqs ? redis.get(ipqsCacheKey(input.networkId, input.ip)) : null,
    ]);
    if (n === 1) await redis.expire(key, VELOCITY_WINDOW_S);
    if (n > cfg.velocityPerMinute) {
      flags.push('high_velocity');
      score += w.velocity;
    }
    verdict = parseIpqsVerdict(cached);
  }

  const signals = { score: Math.min(score, 100), flags };
  return verdict ? foldIpqsVerdict(signals, verdict, w) : signals;
}
