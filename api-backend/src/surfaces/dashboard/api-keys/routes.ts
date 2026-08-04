/**
 * API key management (spec §8A) — humans mint/list/revoke keys here (Dashboard API); their code
 * USES the keys against the Public REST API. The full secret is shown EXACTLY ONCE at creation;
 * only the hash is stored. Every key is individually revocable (effective immediately). All
 * management actions are audit-logged. A factory serves all three audiences with the right owner.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { generateApiKey, sanitizeScopes, AUDIENCE_SCOPES } from '../../../lib/apikeys/keys.js';
import type { ApiAudience } from '../../../middleware/types.js';

interface KeyRow {
  id: string; key_prefix: string; name: string | null; scopes: string[]; status: string;
  rate_limit_tier: string; last_used_at: string | null; created_at: string; expires_at: string | null;
}
const toDTO = (r: KeyRow) => ({
  id: r.id, prefix: r.key_prefix, name: r.name, scopes: r.scopes, status: r.status,
  rateLimitTier: r.rate_limit_tier, lastUsedAt: r.last_used_at, createdAt: r.created_at, expiresAt: r.expires_at,
});

const createSchema = z.object({
  name: z.string().max(120).optional(),
  scopes: z.array(z.string().max(60)).max(30).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * @param audience     which key type this router mints.
 * @param getOwnerId   derives the owner the key acts as (user_id for network; publisher/advertiser id for portals).
 */
export function apiKeyManagementRoutes(audience: ApiAudience, getOwnerId: (req: Request) => string): Router {
  const r = Router();
  const TABLE = 'api_keys';

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const ownerId = getOwnerId(req);
      const rows = await dbForRequest(req).selectMany<KeyRow>(TABLE, {
        where: { audience, owner_id: ownerId }, orderBy: 'created_at', limit: 200,
      });
      sendOk(res, rows.map(toDTO));
    }),
  );

  r.get('/scopes', (_req, res) => sendOk(res, { audience, available: AUDIENCE_SCOPES[audience] }));

  r.post(
    '/',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const ownerId = getOwnerId(req);
      const b = req.body as z.infer<typeof createSchema>;
      const scopes = sanitizeScopes(audience, b.scopes);
      const generated = generateApiKey(audience);
      const createdBy = req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : null;

      const row = await dbForRequest(req).insert<KeyRow>(TABLE, {
        audience,
        owner_id: ownerId,
        key_prefix: generated.prefix,
        key_hash: generated.keyHash,
        name: b.name ?? null,
        scopes,
        created_by: createdBy,
        expires_at: b.expiresAt ?? null,
      });
      await writeAudit(req, { action: 'api_key.create', entityType: 'api_key', entityId: row.id, after: { audience, ownerId, prefix: generated.prefix } });
      res.status(201);
      // The ONLY time the full key is returned.
      sendOk(res, { ...toDTO(row), key: generated.fullKey });
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const ownerId = getOwnerId(req);
      // Owner isolation: revoke only a key you own.
      const rows = await dbForRequest(req).update<KeyRow>(
        TABLE, { status: 'revoked' }, { id: req.params.id, owner_id: ownerId, audience },
      );
      if (rows.length === 0) throw notFound('API key not found');
      await writeAudit(req, { action: 'api_key.revoke', entityType: 'api_key', entityId: req.params.id });
      sendOk(res, { revoked: true });
    }),
  );

  return r;
}
