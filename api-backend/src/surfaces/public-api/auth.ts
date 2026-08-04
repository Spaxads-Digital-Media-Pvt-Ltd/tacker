/**
 * Public REST API auth + audience segregation (spec §2.1 surface #3, §8A).
 *
 *   1. `apiKeyAuth`      — resolves the API key → ApiKeyIdentity (audience + tenant + owner + scopes).
 *                          Key accepted ONLY via header, never query string (keys leak into logs).
 *                          Direct DB lookup every request → revocation is effective immediately.
 *   2. `requireAudience` — STRUCTURAL guard mounted per namespace. A key used against the wrong
 *                          namespace → 403 BEFORE any handler (spec §8A, non-negotiable #11).
 *   3. `requireScope`    — per-endpoint scope check; scopes only ever NARROW the audience ceiling.
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, forbidden, unauthorized } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { hashKey } from '../../lib/apikeys/keys.js';
import { checkRateLimit } from '../../lib/apikeys/rate-limit.js';
import type { ApiAudience, ApiKeyIdentity } from '../../middleware/types.js';

interface KeyRow {
  id: string; network_id: string; audience: ApiAudience; owner_id: string;
  scopes: string[]; rate_limit_tier: string;
}

function extractKey(req: Request): string | null {
  const x = req.header('x-api-key');
  if (x) return x.trim();
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = extractKey(req);
  if (!key) return next(unauthorized('Missing API key. Send X-Api-Key or Authorization: Bearer.'));

  query<KeyRow>(
    `SELECT id, network_id, audience, owner_id, scopes, rate_limit_tier
       FROM api_keys
      WHERE key_hash = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [hashKey(key)],
  )
    .then(async ({ rows }) => {
      const row = rows[0];
      if (!row) return next(unauthorized('Invalid or revoked API key.'));

      const rate = await checkRateLimit(row.id, row.rate_limit_tier);
      res.setHeader('X-RateLimit-Limit', String(rate.limit));
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      if (!rate.allowed) return next(new AppError('rate_limited', 'Rate limit exceeded.'));

      const identity: ApiKeyIdentity = {
        surface: 'public-api', audience: row.audience, networkId: row.network_id,
        ownerId: row.owner_id, keyId: row.id, scopes: row.scopes,
      };
      req.identity = identity;
      // Network keys have full network access (no owner filter). Advertiser/publisher keys are
      // owner-bound so every scoped query is also filtered by their own id (spec §3A).
      req.scope = row.audience === 'network'
        ? { networkId: row.network_id }
        : { networkId: row.network_id, ownerId: row.owner_id };

      // last_used_at updated async — never block the request on it (spec §8A).
      void query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
      return next();
    })
    .catch(next);
}

export function requireAudience(expected: ApiAudience) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.identity;
    if (!id || id.surface !== 'public-api') return next(unauthorized('API key identity not resolved.'));
    if (id.audience !== expected) {
      return next(forbidden(`This key (audience="${id.audience}") may not access the "${expected}" API.`));
    }
    return next();
  };
}

export function requireScope(...needed: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.identity;
    if (!id || id.surface !== 'public-api') return next(unauthorized('API key identity not resolved.'));
    const have = new Set(id.scopes);
    if (!needed.every((s) => have.has(s))) {
      return next(forbidden(`Key is missing required scope(s): ${needed.join(', ')}.`));
    }
    return next();
  };
}

/** Helper for handlers: the resolved API-key identity (throws if somehow absent). */
export function apiIdentity(req: Request): ApiKeyIdentity {
  const id = req.identity;
  if (!id || id.surface !== 'public-api') throw unauthorized('API key identity not resolved.');
  return id;
}
