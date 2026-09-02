/**
 * Control Center — extended user list DTO (ref + metadata fields).
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { userDto, type UserRow } from '../control-center/routes.js';

export function usersRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<UserRow>('users', { where: {}, orderBy: 'name', limit: 500 });
    sendOk(res, rows.map(userDto));
  }));

  return r;
}
