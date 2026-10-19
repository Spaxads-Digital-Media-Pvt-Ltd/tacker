/**
 * Portal invites (audit F-04) — give a publisher/advertiser account a working portal login and send
 * it to them. Shared by the admin "invite" action, invite-on-create and partner self-serve sign-up.
 *
 * The SPA has no magic-link/OTP callback (it only does email + password at /api/auth/login), so an
 * invite is a login with a TEMPORARY PASSWORD emailed to the account's contact email through the
 * network's own SMTP (lib/mailer.ts). Receiving the password is what proves the address belongs to
 * the person signing in. The user changes it after signing in (PATCH /api/me/password).
 *
 * The email goes through the transactional layer (F-24), so the network's "Partner / Advertiser
 * Portal Invite" system-email toggle applies. When the email isn't sent (toggle off, SMTP not
 * configured, or the send failed) the login still exists;
 * outside production the response carries the credentials so dev/staging can proceed (never in
 * production — there, fix SMTP and invite again, which re-issues a fresh temporary password).
 */
import { isProd } from '../config/env.js';
import { appUrl } from './app-url.js';
import { query } from './db/pool.js';
import { ScopedDb } from './db/scoped-db.js';
import { AppError } from './http/errors.js';
import { sendTransactional } from './email/transactional.js';
import { ensurePortalLogin, type PortalKind, type PortalLogin } from './provisioning.js';
import { logger } from './logger.js';

const TABLE: Record<PortalKind, string> = { publisher: 'publishers', advertiser: 'advertisers' };
const LABEL: Record<PortalKind, string> = { publisher: 'partner', advertiser: 'advertiser' };

export interface PortalInviteResult {
 outcome: PortalLogin['outcome'];
 authUserId: string;
 email: string;
 /** The invite email went out. Always false for `linked` (they already have a password). */
 emailed: boolean;
 /** Why it didn't (SMTP not configured / the send failed). */
 emailError?: string;
 /** Non-production only, when the email couldn't be sent: what the email would have carried. */
 credentials?: { loginUrl: string; email: string; temporaryPassword: string };
}

/** The SPA's login page (lib/app-url.ts). */
export const portalLoginUrl = (): string => appUrl('/login');

const escapeHtml = (s: string): string =>
 s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Invite email. Only network-controlled text plus the credentials — nothing a sign-up form typed. */
function inviteEmail(p: { kind: PortalKind; networkName: string; loginUrl: string; email: string; password: string; signup?: 'pending' | 'active' }) {
 const net = escapeHtml(p.networkName);
 const label = LABEL[p.kind];
 const intro = p.signup === 'pending'
 ? `Thanks for signing up with <strong>${net}</strong>. Your ${label} application is pending review — you can sign in now, and you can start running offers once it's approved.`
 : p.signup === 'active'
 ? `Thanks for signing up with <strong>${net}</strong>. Your ${label} account is active.`
 : `You've been invited to the <strong>${net}</strong> ${label} portal.`;
 const url = escapeHtml(p.loginUrl);
 return {
 subject: `Your ${p.networkName} ${label} portal login`,
 html: [
 `<p>Hello,</p>`,
 `<p>${intro}</p>`,
 `<p>Sign in at <a href="${url}">${url}</a></p>`,
 `<p>Email: ${escapeHtml(p.email)}<br>Temporary password: <code>${escapeHtml(p.password)}</code></p>`,
 `<p>You'll be asked to choose your own password when you first sign in.</p>`,
 ].join('\n'),
 };
}

/**
 * Provision (or re-issue / link) the account's portal login, store auth_user_id on the row, and
 * email the temporary password. Errors: no contact email → 400 (reason email_required); see
 * ensurePortalLogin for 409 (already_active / email_in_use) and 503 (Supabase not configured).
 */
export async function invitePortalUser(args: {
 networkId: string;
 kind: PortalKind;
 ownerId: string;
 email: string | null;
 linkedAuthUserId: string | null;
 /** Self-serve sign-up: the status the new account got (changes the email's wording). */
 signup?: 'pending' | 'active';
}): Promise<PortalInviteResult> {
 if (!args.email?.trim()) {
 throw new AppError('bad_request', `Add a contact email to this ${LABEL[args.kind]} before sending a portal invite.`, { reason: 'email_required' });
 }
 const login = await ensurePortalLogin({
 networkId: args.networkId, kind: args.kind, ownerId: args.ownerId,
 email: args.email, linkedAuthUserId: args.linkedAuthUserId,
 });
 await ScopedDb.forNetwork(args.networkId).update(TABLE[args.kind], { auth_user_id: login.authUserId }, { id: args.ownerId });

 const base = { outcome: login.outcome, authUserId: login.authUserId, email: login.email };
 if (!login.temporaryPassword) return { ...base, emailed: false };

 const { rows } = await query<{ name: string }>('SELECT name FROM networks WHERE id = $1', [args.networkId]);
 const loginUrl = portalLoginUrl();
 const mail = inviteEmail({
 kind: args.kind, networkName: rows[0]?.name ?? 'your network', loginUrl,
 email: login.email, password: login.temporaryPassword, signup: args.signup,
 });
 // Carries a temporary password: stored encrypted on the email queue, wiped once sent (O11).
 const sent = await sendTransactional(args.networkId, args.kind === 'publisher' ? 'partner_portal_invite' : 'advertiser_portal_invite', [login.email], mail, { sensitive: true });
 if (sent.sent) return { ...base, emailed: true };
 return {
 ...base,
 emailed: false,
 emailError: sent.reason ?? 'The invite email could not be sent.',
 ...(isProd ? {} : { credentials: { loginUrl, email: login.email, temporaryPassword: login.temporaryPassword } }),
 };
}

/** What the audit log keeps of an invite — never the temporary password. */
export const inviteAuditView = (r: PortalInviteResult) => ({
 email: r.email, outcome: r.outcome, authUserId: r.authUserId, emailed: r.emailed,
 ...(r.emailError ? { emailError: r.emailError } : {}),
});

/**
 * Invite-on-create (audit F-04 step 2): when a partner/advertiser is created with a contact email,
 * invite them too — unless the body says `invite: false` or the account is created inactive.
 * Best effort: a failed invite (Supabase down/unconfigured, email taken, SMTP) never fails the
 * create; the response says what happened (`invited` + `invite` or `inviteError`).
 */
export async function inviteOnCreate(args: {
 networkId: string;
 kind: PortalKind;
 row: { id: string; contact_email: string | null; auth_user_id: string | null; status: string };
 requested: boolean | undefined;
}): Promise<{ invited: boolean; invite?: PortalInviteResult; inviteError?: string }> {
 if (args.requested === false || !args.row.contact_email || args.row.status === 'inactive') return { invited: false };
 try {
 const invite = await invitePortalUser({
 networkId: args.networkId, kind: args.kind, ownerId: args.row.id,
 email: args.row.contact_email, linkedAuthUserId: args.row.auth_user_id,
 });
 return { invited: true, invite };
 } catch (err) {
 logger.warn({ err, kind: args.kind, ownerId: args.row.id }, 'invite-on-create failed (account created without a portal login)');
 return { invited: false, inviteError: err instanceof Error ? err.message : 'Invite failed' };
 }
}
