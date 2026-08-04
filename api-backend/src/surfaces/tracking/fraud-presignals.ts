/**
 * CHEAP fraud pre-signals only (spec §5 step 9, §10). Heavy scoring runs async later (Phase 6);
 * here we do just a datacenter-IP flag and a per-IP velocity counter (one Redis INCR). Never
 * block on the hot path beyond these — capped work, bounded latency.
 */
import { createHash } from 'node:crypto';
import { getRedis } from '../../lib/redis.js';

const VELOCITY_WINDOW_S = 60;
const VELOCITY_THRESHOLD = 30; // clicks/min from one IP before we flag it

export interface PreSignals {
  score: number;
  flags: string[];
}

export async function fraudPreSignals(ip: string | null, isDatacenter: boolean): Promise<PreSignals> {
  const flags: string[] = [];
  let score = 0;

  if (isDatacenter) {
    flags.push('datacenter_ip');
    score += 40;
  }

  if (ip) {
    const key = `vel:${createHash('sha1').update(ip).digest('hex').slice(0, 16)}`;
    const n = await getRedis().incr(key);
    if (n === 1) await getRedis().expire(key, VELOCITY_WINDOW_S);
    if (n > VELOCITY_THRESHOLD) {
      flags.push('high_velocity');
      score += 30;
    }
  }

  return { score: Math.min(score, 100), flags };
}
