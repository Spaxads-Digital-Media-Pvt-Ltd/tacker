/**
 * Team members (Control Center › Accounts): list, create, invite.
 *
 * Creating a member makes their login and EMAILS THEM AN INVITE (O1): the sign-in address and a
 * temporary password, through the network's SMTP. The login carries `must_change_password`, so the
 * first sign-in asks them to choose their own password (dashboardAuth allows nothing else until
 * then). Until they sign in their status is `invited`; "Resend invite" issues a fresh temporary
 * password. Members who have signed in can be sent a password-reset link instead (they can also
 * use "Forgot password?" themselves). Edits: PATCH /api/control-center/users/:id.
 *
 * Outside production, when the invite email can't be sent (SMTP not configured, toggle, failure),
 * the response carries the credentials so dev/staging can proceed — never in production.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody } from '../../../lib/http/validate.js';
import { AppError, badRequest, conflict, notFound, serviceUnavailable } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { rejectMalformedIdParams } from '../../../lib/http/path-params.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { isProd } from '../../../config/env.js';
import { requireRole } from '../auth.js';
import { getSupabaseAdmin } from '../../../lib/supabase.js';
import { generateTemporaryPassword } from '../../../lib/provisioning.js';
import { appUrl } from '../../../lib/app-url.js';
import { sendTransactional, networkName } from '../../../lib/email/transactional.js';
import { staffInviteEmail } from '../../../lib/email/templates.js';
import { sendPasswordReset } from '../../../lib/auth/password-reset.js';
import { forgetStaffState } from '../../../lib/auth/staff-state.js';
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

export interface StaffInviteResult {
  /** The invite email went out. */
  emailed: boolean;
  /** Why it didn't. */
  emailError?: string;
  /** Non-production only, when the email couldn't be sent: what it would have carried. */
  credentials?: { loginUrl: string; email: string; temporaryPassword: string };
}

function authAdmin(): SupabaseClient {
  try {
    return getSupabaseAdmin();
  } catch {
    throw serviceUnavailable('Team logins are unavailable: Supabase Auth is not configured on this server (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }
}

/** Who's sending the invite (shown in the email), if they're a team member with a name. */
async function inviterName(req: Request): Promise<string | null> {
  const id = req.identity;
  if (!id || id.surface !== 'dashboard') return null;
  const { rows } = await query<{ name: string | null }>(
    'SELECT name FROM users WHERE network_id = $1 AND auth_user_id::text = $2', [req.scope!.networkId, id.userId]);
  return rows[0]?.name ?? null;
}

async function emailInvite(req: Request, member: { name: string; email: string }, temporaryPassword: string): Promise<StaffInviteResult> {
  const networkId = req.scope!.networkId;
  const loginUrl = appUrl('/login');
  const mail = staffInviteEmail({
    networkName: await networkName(networkId), name: member.name, inviterName: await inviterName(req),
    loginUrl, email: member.email, password: temporaryPassword,
  });
  const sent = await sendTransactional(networkId, 'staff_invite', [member.email], mail, { sensitive: true });
  if (sent.sent) return { emailed: true };
  return {
    emailed: false,
    emailError: sent.reason ?? 'The invite email could not be sent.',
    ...(isProd ? {} : { credentials: { loginUrl, email: member.email, temporaryPassword } }),
  };
}

/** What the audit log keeps of an invite — never the temporary password. */
const inviteAudit = (r: StaffInviteResult) => ({ emailed: r.emailed, ...(r.emailError ? { emailError: r.emailError } : {}) });

const emailTaken = (msg: string, code?: string) => code === 'email_exists' || /already (been )?registered/i.test(msg);

export function usersRoutes(): Router {
  const r = Router();
  rejectMalformedIdParams(r, 'id');

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<UserRow>('users', { where: {}, orderBy: 'name', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'users.list');
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
      const email = b.email.trim().toLowerCase();
      const metadata = {
        businessUnit: b.businessUnit ?? null,
        partnerManager: b.partnerManager ?? false,
        advertiserManager: b.advertiserManager ?? false,
        primaryPhone: b.primaryPhone ?? null,
        title: b.title ?? null,
        superUser: b.superUser ?? false,
      };
      const temporaryPassword = generateTemporaryPassword();
      const { data: authData, error } = await authAdmin().auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        app_metadata: { kind: 'admin', network_id: networkId, role: b.role, must_change_password: true },
        user_metadata: { name: b.name },
      });
      if (error || !authData.user) {
        if (error && emailTaken(error.message, error.code)) throw new AppError('conflict', `${email} already has a login. Use a different email address.`, { reason: 'email_in_use' });
        throw badRequest(error?.message ?? 'Failed to create auth user');
      }
      const row = await db.insert<UserRow>('users', {
        auth_user_id: authData.user.id,
        email,
        name: b.name,
        role: b.role,
        status: 'invited',
        metadata: JSON.stringify(metadata),
      });
      const invite = await emailInvite(req, { name: b.name, email }, temporaryPassword);
      await writeAudit(req, { action: 'user.create', entityType: 'users', entityId: row.id, after: { ...row, invite: inviteAudit(invite) } });
      sendOk(res, { ...userDto(row), invite }, undefined, 201);
    }),
  );

  // Resend invite: a fresh temporary password for a member who hasn't signed in yet (or whose login
  // is missing). Someone who has signed in gets a password reset instead → 409.
  r.post('/:id/invite', requireRole('admin'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.selectOne<UserRow>('users', { id: req.params.id });
    if (!row) throw notFound('User not found');
    if (row.status === 'disabled') throw conflict('This member is disabled — re-enable them before sending an invite.');
    const sb = authAdmin();
    const temporaryPassword = generateTemporaryPassword();
    let authUserId = row.auth_user_id ?? null;
    const existing = authUserId ? await sb.auth.admin.getUserById(authUserId) : null;
    if (existing?.data.user) {
      if (existing.data.user.last_sign_in_at) {
        throw new AppError('conflict', `${row.email} has already signed in — send them a password reset instead.`, { reason: 'already_active' });
      }
      const { error } = await sb.auth.admin.updateUserById(existing.data.user.id, {
        password: temporaryPassword, app_metadata: { kind: 'admin', network_id: req.scope!.networkId, role: row.role, must_change_password: true },
      });
      if (error) throw badRequest(error.message);
    } else {
      // No login yet (or it was deleted in Supabase): make one now and link it.
      const { data, error } = await sb.auth.admin.createUser({
        email: row.email, password: temporaryPassword, email_confirm: true,
        app_metadata: { kind: 'admin', network_id: req.scope!.networkId, role: row.role, must_change_password: true },
        user_metadata: { name: row.name ?? row.email },
      });
      if (error || !data.user) {
        if (error && emailTaken(error.message, error.code)) throw new AppError('conflict', `${row.email} already has a login for another account.`, { reason: 'email_in_use' });
        throw badRequest(error?.message ?? 'Failed to create auth user');
      }
      authUserId = data.user.id;
    }
    const [updated] = await db.update<UserRow>('users', { auth_user_id: authUserId, status: 'invited' }, { id: row.id });
    forgetStaffState(req.scope!.networkId, authUserId);
    const invite = await emailInvite(req, { name: row.name ?? row.email, email: row.email }, temporaryPassword);
    await writeAudit(req, { action: 'user.invite', entityType: 'users', entityId: row.id, after: inviteAudit(invite) });
    sendOk(res, { ...userDto(updated ?? row), invite });
  }));

  // Email a member a password-reset link (the same link "Forgot password?" sends).
  r.post('/:id/password-reset', requireRole('admin'), asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<UserRow>('users', { id: req.params.id });
    if (!row) throw notFound('User not found');
    if (row.status === 'disabled') throw conflict('This member is disabled — re-enable them before resetting their password.');
    if (!row.auth_user_id) throw conflict('This member has no login yet — send them an invite instead.');
    let result;
    try {
      result = await sendPasswordReset(row.email);
    } catch {
      authAdmin(); // a configuration problem → the same 503 as the other team-login routes
      throw serviceUnavailable('Password resets are unavailable right now.');
    }
    if (!result.account) throw conflict(`${row.email} has no login that can be reset — send them an invite instead.`);
    const emailed = result.email?.sent ?? false;
    await writeAudit(req, { action: 'user.password_reset', entityType: 'users', entityId: row.id, after: { emailed } });
    sendOk(res, { emailed, ...(emailed ? {} : { emailError: result.email?.reason ?? 'The reset email could not be sent.' }) });
  }));

  return r;
}
