/**
 * Tracking domains — admin CRUD (spec §3D, §1). Subdomain mode is provisioned on our base
 * domain and activated immediately; custom mode is stored pending DNS/CNAME verification (the
 * actual verification + cert issuance is Phase 1A). Host resolution never trusts an
 * unverified/inactive host (spec §3D).
 */
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../../lib/http/pagination.js';
import { badRequest, notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { env } from '../../../config/env.js';
import type { TrackingDomainRow } from '../../../domain/entities.js';
import { requireRole } from '../auth.js';
import { createTrackingDomainSchema, type CreateTrackingDomain } from './schemas.js';
import { toDTO } from './dto.js';

const TABLE = 'tracking_domains';

export function trackingDomainsAdminRoutes(): Router {
  const r = Router();

  r.get(
    '/',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { limit, offset } = res.locals.query as PaginationQuery;
      const db = dbForRequest(req);
      const [rows, total] = await Promise.all([
        db.selectMany<TrackingDomainRow>(TABLE, { limit, offset, orderBy: 'created_at' }),
        db.count(TABLE),
      ]);
      sendOk(res, rows.map(toDTO), { limit, offset, total });
    }),
  );

  r.post(
    '/',
    requireRole('admin', 'manager'),
    validateBody(createTrackingDomainSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as CreateTrackingDomain;
      const db = dbForRequest(req);

      let values: Record<string, unknown>;
      if (b.mode === 'subdomain') {
        const host = `${b.subdomain.toLowerCase()}.${env.TRACKING_BASE_DOMAIN}`;
        values = {
          host,
          mode: 'subdomain',
          status: 'active',
          verification_state: 'verified',
          ssl_status: 'issued',
          is_primary: b.isPrimary,
        };
      } else {
        values = {
          host: b.host.toLowerCase(),
          mode: 'custom',
          status: 'pending',
          verification_state: 'unverified',
          verification_token: randomBytes(16).toString('hex'),
          ssl_status: 'none',
          is_primary: b.isPrimary,
        };
      }

      // At most one primary per network — clear existing before setting a new one.
      if (b.isPrimary) {
        await db.update(TABLE, { is_primary: false }, { is_primary: true });
      }

      let row: TrackingDomainRow;
      try {
        row = await db.insert<TrackingDomainRow>(TABLE, values);
      } catch (err) {
        // Unique violation on host (globally unique — maps 1:1 to a tenant).
        if (isUniqueViolation(err)) throw badRequest('That host is already registered');
        throw err;
      }
      await writeAudit(req, { action: 'tracking_domain.create', entityType: 'tracking_domain', entityId: row.id, after: row });
      res.status(201);
      sendOk(res, toDTO(row));
    }),
  );

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await dbForRequest(req).selectOne<TrackingDomainRow>(TABLE, { id: req.params.id });
      if (!row) throw notFound('Tracking domain not found');
      sendOk(res, toDTO(row));
    }),
  );

  r.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const before = await db.selectOne<TrackingDomainRow>(TABLE, { id: req.params.id });
      if (!before) throw notFound('Tracking domain not found');
      await db.delete(TABLE, { id: req.params.id });
      await writeAudit(req, { action: 'tracking_domain.delete', entityType: 'tracking_domain', entityId: req.params.id, before });
      sendOk(res, { deleted: true });
    }),
  );

  return r;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
