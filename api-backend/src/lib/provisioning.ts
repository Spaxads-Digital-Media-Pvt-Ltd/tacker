/**
 * Auth provisioning (spec §1A, §3A). Creates Supabase Auth users and stamps the custom claims our
 * surfaces read from the JWT (`kind`, `network_id`, `role`, `owner_id`). Claims live in
 * `app_metadata` — settable ONLY via the service_role key, so a user can never elevate themselves.
 *
 * The DB row (users/publishers/advertisers) and the Auth user are linked via `auth_user_id`.
 * Platform admins (spec §3C) are NOT provisioned via Supabase Auth — they use a separate
 * HS256-signed local JWT flow. See scripts/bootstrap-platform-admin.ts and
 * lib/auth/platform-admin-token.ts.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase.js';
import { query } from './db/pool.js';
import { AppError, serviceUnavailable } from './http/errors.js';
import { generateSecureCode } from './security-code.js';

export interface ProvisionResult {
 authUserId: string;
}

interface BaseArgs {
 email: string;
 password: string;
}

/** A Supabase Auth admin call failed. `code` is Supabase's machine code (e.g. 'email_exists'). */
export class AuthProvisionError extends Error {
 constructor(message: string, readonly code?: string) {
 super(message);
 this.name = 'AuthProvisionError';
 }
}

async function createAuthUser(args: BaseArgs, appMetadata: Record<string, unknown>): Promise<string> {
 const supabase = getSupabaseAdmin();
 const { data, error } = await supabase.auth.admin.createUser({
 email: args.email,
 password: args.password,
 email_confirm: true,
 app_metadata: appMetadata,
 });
 if (error) throw new AuthProvisionError(`Auth user creation failed: ${error.message}`, error.code);
 const id = data.user?.id;
 if (!id) throw new Error('Auth user creation returned no id');
 return id;
}

/** Admin (network staff) login. Claims: network_id, kind=admin, role. */
export function provisionAdmin(
 args: BaseArgs & { networkId: string; role: 'admin' | 'manager' | 'finance' | 'read_only' },
): Promise<string> {
 return createAuthUser(args, { kind: 'admin', network_id: args.networkId, role: args.role });
}

/** Portal login for a publisher/advertiser. Claims: network_id, kind, owner_id (their party id). */
export function provisionPortalUser(
 args: BaseArgs & { networkId: string; kind: 'publisher' | 'advertiser'; ownerId: string },
): Promise<string> {
 return createAuthUser(args, {
 kind: args.kind,
 network_id: args.networkId,
 owner_id: args.ownerId,
 });
}

// ---------------------------------------------------------------------------------------------
// Portal logins for real accounts (audit F-04): invites and self-serve sign-up.
// ---------------------------------------------------------------------------------------------

export type PortalKind = 'publisher' | 'advertiser';

const PORTAL_TABLE: Record<PortalKind, string> = { publisher: 'publishers', advertiser: 'advertisers' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Supabase has no lookup-by-email: page through users (only after a create reports the email taken). */
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 50;

/** The service-role client, or a 503 when Supabase Auth isn't configured (no portal logins possible). */
export function requireAuthAdmin(): SupabaseClient {
 try {
 return getSupabaseAdmin();
 } catch {
 throw serviceUnavailable('Portal logins are unavailable: Supabase Auth is not configured on this server (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
 }
}

/**
 * Temporary password for an invite: four dash-separated groups of the unambiguous secure-code
 * alphabet (~93 bits), always with upper, lower and a digit so it passes stricter Supabase password
 * rules too. Easy to read out of an email; the user changes it after signing in.
 */
export function generateTemporaryPassword(): string {
 for (;;) {
 const pw = [0, 1, 2, 3].map(() => generateSecureCode(5)).join('-');
 if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
 }
}

const emailTaken = (err: { code?: string; message: string }): boolean =>
 err.code === 'email_exists' || /already (been )?registered/i.test(err.message);

const emailInUse = (email: string) =>
 new AppError('conflict', `${email} already has a login for another account. Use a different contact email.`, { reason: 'email_in_use' });

async function authUserById(sb: SupabaseClient, id: string): Promise<User | null> {
 const { data, error } = await sb.auth.admin.getUserById(id);
 if (error) {
 if (error.status === 404 || error.code === 'user_not_found') return null; // deleted in Supabase
 throw new AuthProvisionError(`Auth user lookup failed: ${error.message}`, error.code);
 }
 return data.user ?? null;
}

async function authUserByEmail(sb: SupabaseClient, email: string): Promise<User | null> {
 for (let page = 1; page <= LIST_MAX_PAGES; page++) {
 const { data, error } = await sb.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
 if (error) throw new AuthProvisionError(`Auth user lookup failed: ${error.message}`, error.code);
 const hit = data.users.find((u) => u.email?.toLowerCase() === email);
 if (hit) return hit;
 if (data.users.length < LIST_PAGE_SIZE) return null;
 }
 return null;
}

async function updateAuthUser(sb: SupabaseClient, id: string, email: string, attrs: Parameters<SupabaseClient['auth']['admin']['updateUserById']>[1]): Promise<void> {
 const { error } = await sb.auth.admin.updateUserById(id, attrs);
 if (!error) return;
 if (emailTaken(error)) throw emailInUse(email);
 throw new AuthProvisionError(`Auth user update failed: ${error.message}`, error.code);
}

/**
 * May this existing login become the portal login of `want`? Never take over network staff, another
 * kind or network, or another live account. A login with no claims yet, or whose claims point at an
 * account of the same kind that no longer exists in this network (deleted), is free to re-stamp.
 */
async function loginIsFreeFor(user: User, want: { networkId: string; kind: PortalKind; ownerId: string }): Promise<boolean> {
 const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
 if (!meta['kind'] && !meta['network_id']) return true;
 if (meta['kind'] !== want.kind || meta['network_id'] !== want.networkId) return false;
 const owner = meta['owner_id'];
 if (owner === want.ownerId) return true;
 if (typeof owner !== 'string' || !UUID_RE.test(owner)) return true; // unusable claims (no valid owner_id)
 const { rows } = await query(
 `SELECT 1 FROM ${PORTAL_TABLE[want.kind]} WHERE network_id = $1 AND id = $2`,
 [want.networkId, owner],
 );
 return rows.length === 0;
}

export interface PortalLogin {
 authUserId: string;
 /** The address the login now uses (the contact email it was issued to). */
 email: string;
 /**
 * created — a new login; reissued — an existing login nobody has signed into yet got a fresh
 * temporary password (a re-invite); linked — an existing login that is already in use was linked
 * to this account and keeps its own password.
 */
 outcome: 'created' | 'reissued' | 'linked';
 /** Hand this to the user (created/reissued); null when linked. Never log or audit it. */
 temporaryPassword: string | null;
}

/**
 * Make sure a publisher/advertiser account has a working portal login for `email` — idempotent by
 * email, so inviting twice never makes a second Supabase user:
 * - no login for the email → create one via provisionPortalUser (temporary password, claims);
 * - a login exists (or the row is already linked to one) that nobody has signed into → re-stamp its
 * claims, move it to `email` if the contact email changed, and issue a fresh temporary password;
 * - a login exists that has been used → re-stamp its claims and link it, password untouched. If it
 * is ALREADY this account's linked login, that's "already invited" → 409.
 * Logins that belong to someone else (see loginIsFreeFor) → 409. Supabase not configured → 503.
 * The caller stores `authUserId` on the row's auth_user_id.
 */
export async function ensurePortalLogin(args: {
 networkId: string;
 kind: PortalKind;
 ownerId: string;
 email: string;
 linkedAuthUserId: string | null;
}): Promise<PortalLogin> {
 const sb = requireAuthAdmin();
 const email = args.email.trim().toLowerCase();
 const claims = { kind: args.kind, network_id: args.networkId, owner_id: args.ownerId };

 let user = args.linkedAuthUserId ? await authUserById(sb, args.linkedAuthUserId) : null;
 if (!user) {
 const temporaryPassword = generateTemporaryPassword();
 try {
 const authUserId = await provisionPortalUser({
 email, password: temporaryPassword, networkId: args.networkId, kind: args.kind, ownerId: args.ownerId,
 });
 return { authUserId, email, outcome: 'created', temporaryPassword };
 } catch (err) {
 if (!(err instanceof AuthProvisionError && emailTaken({ code: err.code, message: err.message }))) throw err;
 }
 user = await authUserByEmail(sb, email);
 if (!user) throw emailInUse(email); // Supabase says taken but it isn't listable — don't guess
 }

 if (!(await loginIsFreeFor(user, args))) throw emailInUse(user.email ?? email);

 if (user.last_sign_in_at) {
 if (user.id === args.linkedAuthUserId) {
 throw new AppError(
 'conflict',
 `Already invited: this account's portal login (${user.email ?? email}) is active — they sign in with their own password.`,
 { reason: 'already_active' },
 );
 }
 await updateAuthUser(sb, user.id, email, { app_metadata: claims });
 return { authUserId: user.id, email: user.email ?? email, outcome: 'linked', temporaryPassword: null };
 }

 const temporaryPassword = generateTemporaryPassword();
 const moveEmail = (user.email ?? '').toLowerCase() !== email;
 await updateAuthUser(sb, user.id, email, {
 password: temporaryPassword,
 app_metadata: claims,
 ...(moveEmail ? { email, email_confirm: true } : {}),
 });
 return { authUserId: user.id, email, outcome: 'reissued', temporaryPassword };
}
