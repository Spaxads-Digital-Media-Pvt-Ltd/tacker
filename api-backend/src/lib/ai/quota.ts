/**
 * Per-network daily AI budget (audit F-25·F-28): every network may run at most AI_DAILY_CHAT_LIMIT
 * chats and AI_DAILY_TOKEN_LIMIT tokens (input + output, every tool-loop turn) per UTC day on
 * /api/ai/chat — the Anthropic bill is the platform's, and any admin / manager of any tenant could
 * otherwise run it up. Counters live in Redis (`ai:quota:{network}:{YYYYMMDD}:chats|tokens`, kept
 * two days). Over either limit → 429 `rate_limited` with Retry-After = seconds to UTC midnight.
 * 0 = no cap. If Redis is down the check fails open (logged), like the login limiter.
 */
import { env } from '../../config/env.js';
import { getRedis } from '../redis.js';
import { tooMany } from '../http/errors.js';
import { logger } from '../logger.js';

const TTL_S = 2 * 86_400;

const dayOf = (now: Date): string => now.toISOString().slice(0, 10).replace(/-/g, '');
const keys = (networkId: string, now: Date) => {
  const base = `ai:quota:${networkId}:${dayOf(now)}`;
  return { chats: `${base}:chats`, tokens: `${base}:tokens` };
};
const nextMidnight = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const secondsToMidnight = (now: Date): number => Math.max(1, Math.ceil((nextMidnight(now).getTime() - now.getTime()) / 1000));

export interface AiQuotaView {
  chats: { used: number; limit: number | null };
  tokens: { used: number; limit: number | null };
  resetsAt: string;
}

/** Today's usage against the limits (null limit = no cap). */
export async function aiQuota(networkId: string, now: Date = new Date()): Promise<AiQuotaView> {
  const k = keys(networkId, now);
  let chats = 0;
  let tokens = 0;
  try {
    const [c, t] = await getRedis().mget(k.chats, k.tokens);
    chats = Number(c ?? 0);
    tokens = Number(t ?? 0);
  } catch (err) {
    logger.warn({ err, networkId }, 'AI quota: Redis unavailable');
  }
  return {
    chats: { used: chats, limit: env.AI_DAILY_CHAT_LIMIT || null },
    tokens: { used: tokens, limit: env.AI_DAILY_TOKEN_LIMIT || null },
    resetsAt: nextMidnight(now).toISOString(),
  };
}

/**
 * Count one chat against today's budget, or refuse it (429) when the network has no chats or tokens
 * left. Call right before the first model call.
 */
export async function reserveAiChat(networkId: string, now: Date = new Date()): Promise<void> {
  const k = keys(networkId, now);
  const retryAfter = secondsToMidnight(now);
  const refuse = (what: string, limit: number) => tooMany(
    `This network has used today's AI ${what} (${limit.toLocaleString('en-US')} per day). It resets at 00:00 UTC.`,
    { retryAfter, limit },
  );
  try {
    const redis = getRedis();
    const tokenLimit = env.AI_DAILY_TOKEN_LIMIT;
    if (tokenLimit && Number((await redis.get(k.tokens)) ?? 0) >= tokenLimit) throw refuse('token budget', tokenLimit);
    const chatLimit = env.AI_DAILY_CHAT_LIMIT;
    const n = await redis.incr(k.chats);
    if (n === 1) await redis.expire(k.chats, TTL_S);
    if (chatLimit && n > chatLimit) {
      await redis.decr(k.chats);
      throw refuse('chat limit', chatLimit);
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'rate_limited') throw err;
    logger.warn({ err, networkId }, 'AI quota: Redis unavailable — failing open');
  }
}

/** Add the tokens a chat used (every turn of its tool loop). */
export async function recordAiTokens(networkId: string, tokens: number, now: Date = new Date()): Promise<void> {
  if (!(tokens > 0)) return;
  const k = keys(networkId, now);
  try {
    const redis = getRedis();
    const total = await redis.incrby(k.tokens, Math.round(tokens));
    if (total === Math.round(tokens)) await redis.expire(k.tokens, TTL_S);
  } catch (err) {
    logger.warn({ err, networkId, tokens }, 'AI quota: could not record token usage');
  }
}
