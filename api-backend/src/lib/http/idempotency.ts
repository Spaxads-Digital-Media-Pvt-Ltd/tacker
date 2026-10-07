/**
 * Optional `Idempotency-Key` support for create endpoints (first user: POST /api/offers).
 *
 * Redis only, same SET NX EX pattern as conversion idempotency (tracking/conversions/record.ts).
 * Key: `idem:{scope}:{networkId}:{sha256(header)}`, so the same header value from another network
 * never collides — the network comes from the authenticated request, never from the client.
 *
 *   no header            → handler runs exactly as before.
 *   first request        → SET NX a short "pending" lock (60s), run the create, then store
 *                          {done, id, fingerprint} for 10 minutes.
 *   repeat (done)        → don't create again: load the original record (network-scoped) and
 *                          return it with `Idempotent-Replayed: true`.
 *   repeat (in flight)   → 409, so two concurrent requests can never both create.
 *   repeat, other body   → 422: the key was already used for a different request.
 *   create failed/threw  → the lock is released, so the client can retry with the SAME key.
 *   Redis unavailable    → fail open (create without the guard) and log — the same behaviour as
 *                          before this feature, rather than blocking all creates.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import { AppError, badRequest, conflict } from './errors.js';

const HEADER = 'idempotency-key';
const PENDING_TTL_S = 60;
const DONE_TTL_S = 600;
const KEY_RE = /^[\x21-\x7e]{1,200}$/; // 1–200 visible ASCII characters (UUIDs, ULIDs, etc.)

interface Entry { state: 'pending' | 'done'; fp: string; id?: string }

/** Order-independent JSON so the same body always fingerprints the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function idempotentCreate<T extends { id: string }>(
  req: Request,
  scope: string,
  create: () => Promise<T>,
  loadExisting: (id: string) => Promise<T | null>,
  attempt = 0,
): Promise<{ result: T; replayed: boolean }> {
  const header = req.header(HEADER);
  if (header === undefined) return { result: await create(), replayed: false };
  if (!KEY_RE.test(header)) throw badRequest('Idempotency-Key must be 1–200 visible ASCII characters.');

  const networkId = req.scope?.networkId;
  if (!networkId) throw new AppError('unauthorized', 'No tenant scope on request.');
  const key = `idem:${scope}:${networkId}:${sha256(header)}`;
  const fp = sha256(stable(req.body));
  const redis = getRedis();

  let acquired: string | null;
  try {
    acquired = await redis.set(key, JSON.stringify({ state: 'pending', fp } satisfies Entry), 'EX', PENDING_TTL_S, 'NX');
  } catch (err) {
    logger.warn({ err, scope }, 'idempotency: Redis unavailable — proceeding without the guard');
    return { result: await create(), replayed: false };
  }

  if (acquired !== 'OK') {
    const raw = await redis.get(key);
    const entry = raw ? (JSON.parse(raw) as Entry) : null;
    if (!entry) {
      // Lock released/expired between SET and GET (the other attempt failed) — try once more.
      if (attempt === 0) return idempotentCreate(req, scope, create, loadExisting, 1);
      throw conflict('The same create request is already being processed. Wait a moment and refresh before trying again.');
    }
    if (entry.fp !== fp) {
      throw new AppError('validation_failed', 'This Idempotency-Key was already used for a different request. Start a new form to create another record.');
    }
    if (entry.state === 'pending') {
      throw conflict('The same create request is already being processed. Wait a moment and refresh before trying again.');
    }
    const existing = entry.id ? await loadExisting(entry.id) : null;
    if (!existing) throw conflict('This request already created a record that no longer exists.');
    return { result: existing, replayed: true };
  }

  let result: T;
  try {
    result = await create();
  } catch (err) {
    // Failed or rejected — free the key so the same request can be retried.
    await redis.del(key).catch((e: unknown) => logger.warn({ err: e, scope }, 'idempotency: could not release key'));
    throw err;
  }
  await redis.set(key, JSON.stringify({ state: 'done', fp, id: result.id } satisfies Entry), 'EX', DONE_TTL_S)
    .catch((e: unknown) => logger.warn({ err: e, scope }, 'idempotency: could not record completed create'));
  return { result, replayed: false };
}
