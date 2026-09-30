/**
 * Control Center — extended user list DTO (ref + metadata fields).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { getSupabaseAdmin } from '../../../lib/supabase.js';
import { userDto, type UserRow } from '../control-center/routes.js';

const createUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  role: z.enum(['admin', 'manager', 'finance', 'read_only']).default('read_only'),
  businessUnit: z.string().max(100).optional(),
  partnerManager: z.boolean().optional(),
  advertiserManager: z.boolean().optional(),
  primaryPhone: z.string().max(50).optional(),
  title: z.string().max(100).optional(),
  superUser: z.boolean().optional(),
});

export function usersRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<UserRow>('users', { where: {}, orderBy: 'name', limit: 500 });
    sendOk(res, rows.map(userDto));
  }));

  r.post(
    '/',
    requireRole('admin'),
    validateBody(createUserSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const b = req.body as z.infer<typeof createUserSchema>;
      const networkId = req.scope!.networkId;
      const metadata = {
        businessUnit: b.businessUnit ?? null,
        partnerManager: b.partnerManager ?? false,
        advertiserManager: b.advertiserManager ?? false,
        primaryPhone: b.primaryPhone ?? null,
        title: b.title ?? null,
        superUser: b.superUser ?? false,
      };
      const tempPassword = `Tmp${Math.random().toString(36).slice(2)}!9Aa`;
      const sb = getSupabaseAdmin();
      const { data: authData, error } = await sb.auth.admin.createUser({
        email: b.email,
        password: tempPassword,
        email_confirm: true,
        app_metadata: { kind: 'admin', network_id: networkId, role: b.role },
        user_metadata: { name: b.name },
      });
      if (error || !authData.user) throw badRequest(error?.message ?? 'Failed to create auth user');
      const row = await db.insert<UserRow>('users', {
        auth_user_id: authData.user.id,
        email: b.email,
        name: b.name,
        role: b.role,
        status: 'invited',
        metadata: JSON.stringify(metadata),
      });
      await writeAudit(req, { action: 'user.create', entityType: 'users', entityId: row.id, after: row });
      sendOk(res, userDto(row), undefined, 201);
    }),
  );

  return r;
}
