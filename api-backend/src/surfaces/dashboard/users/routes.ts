/**
 * /api/users — read-only list of this network's own dashboard team members (the `users` table).
 * Used to populate "Partner Manager" / "Account Executive" pickers on Manage Partners; this table
 * previously had no route at all. Tenant-scoped by network_id (spec §3A).
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { dbForRequest } from '../../../lib/db/from-request.js';

interface UserRow { id: string; name: string | null; email: string; role: string; status: string; created_at: string; updated_at: string }
const dto = (r: UserRow) => ({
  id: r.id, name: r.name ?? r.email, email: r.email, role: r.role, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function usersRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<UserRow>('users', { where: {}, orderBy: 'name', limit: 500 });
    sendOk(res, rows.map(dto));
  }));

  return r;
}
