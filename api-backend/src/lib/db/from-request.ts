/**
 * Build a correctly-scoped ScopedDb from the authenticated request (spec §3A). Admins get a
 * network-scoped handle; portal users get a network+owner-scoped handle. Never construct a
 * ScopedDb from raw ids in a handler — always go through the request so scope can't be forged.
 */
import type { Request } from 'express';
import { ScopedDb } from './scoped-db.js';
import { AppError } from '../http/errors.js';

export function dbForRequest(req: Request): ScopedDb {
  const scope = req.scope;
  if (!scope?.networkId) {
    throw new AppError('unauthorized', 'No tenant scope on request.');
  }
  return scope.ownerId
    ? ScopedDb.forOwner(scope.networkId, scope.ownerId)
    : ScopedDb.forNetwork(scope.networkId);
}

/** The caller's owner id (publisher_id / advertiser_id), asserted present for portal handlers. */
export function ownerIdOf(req: Request): string {
  const ownerId = req.scope?.ownerId;
  if (!ownerId) throw new AppError('forbidden', 'Owner scope required.');
  return ownerId;
}
