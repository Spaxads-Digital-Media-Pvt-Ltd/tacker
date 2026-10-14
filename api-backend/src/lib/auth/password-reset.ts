/**
 * Password reset by email (O1) — "Forgot password?" for everyone who signs in with a password: team
 * members, partners and advertisers.
 *
 * Supabase issues the one-time recovery token (admin generateLink, which also tells us whether the
 * address has a login), but the link points at OUR page (/reset-password?token=…) and the email goes
 * out through the account's network SMTP like every other email — Supabase never emails anyone. The
 * page posts the token with the new password; the server redeems it (verifyOtp on a throwaway client),
 * sets the password, clears "must change password" and signs the account out everywhere else. A link
 * works once and expires with Supabase's email-OTP lifetime (1 hour by default).
 *
 * Accounts that are switched off (a disabled team member, an inactive or deleted partner / advertiser)
 * get no link, and can't redeem one. The public endpoint never says whether an address has an account.
 */
import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin, createEphemeralAuthClient } from '../supabase.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import { appUrl } from '../app-url.js';
import { AppError } from '../http/errors.js';
import { sendTransactional, networkName, type TransactionalResult } from '../email/transactional.js';
import { passwordResetEmail } from '../email/templates.js';
import { staffState } from './staff-state.js';
import { portalAccountStatus, portalAccessAllowed } from './portal-state.js';

/** Supabase's default email-OTP lifetime (GOTRUE_MAILER_OTP_EXP), shown in the email. */
export const RESET_LINK_MINUTES = 60;

export interface ResetRequestResult {
  /** The address has a login that may reset its password. */
  account: boolean;
  /** What happened to the email (when there was one to send). */
  email?: TransactionalResult;
}

/** Is this login's account switched on? (The login's claims say which account it is.) */
async function accountUsable(user: User): Promise<boolean> {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const networkId = typeof meta['network_id'] === 'string' ? meta['network_id'] : null;
  if (!networkId) return false;
  if (meta['kind'] === 'admin') return (await staffState(networkId, user.id))?.status !== 'disabled';
  if (meta['kind'] === 'publisher' || meta['kind'] === 'advertiser') {
    const owner = typeof meta['owner_id'] === 'string' ? meta['owner_id'] : '';
    const status = await portalAccountStatus(networkId, meta['kind'], owner);
    return status !== null && portalAccessAllowed(status);
  }
  return false;
}

/**
 * Email a reset link to `email` if it has a usable login. Throws only when Supabase Auth isn't
 * configured; an unknown address is `{ account: false }`.
 */
export async function sendPasswordReset(email: string): Promise<ResetRequestResult> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email: email.trim().toLowerCase() });
  if (error || !data?.user || !data.properties?.hashed_token) {
    if (error && error.status !== 404 && error.code !== 'user_not_found') logger.warn({ err: error.message }, 'password reset: generateLink failed');
    return { account: false };
  }
  if (!(await accountUsable(data.user))) return { account: false };
  const networkId = String((data.user.app_metadata as Record<string, unknown>)['network_id']);
  const mail = passwordResetEmail({
    networkName: await networkName(networkId),
    resetUrl: appUrl(`/reset-password?token=${encodeURIComponent(data.properties.hashed_token)}`),
    expiresInMinutes: RESET_LINK_MINUTES,
  });
  return { account: true, email: await sendTransactional(networkId, 'password_reset', [data.user.email ?? email], mail, { sensitive: true }) };
}

const invalidLink = () => new AppError('bad_request', 'This reset link is invalid or has expired — request a new one.', { reason: 'reset_link_invalid' });

/** Redeem a reset link: set the new password, clear "must change password", end other sessions. */
export async function completePasswordReset(token: string, password: string): Promise<void> {
  const { data, error } = await createEphemeralAuthClient().auth.verifyOtp({ token_hash: token, type: 'recovery' });
  if (error || !data.user) throw invalidLink();
  if (!(await accountUsable(data.user))) {
    throw new AppError('forbidden', 'This account is switched off, so its password can’t be reset. Contact the network.', { reason: 'account_inactive' });
  }
  const sb = getSupabaseAdmin();
  const updated = await sb.auth.admin.updateUserById(data.user.id, { password, app_metadata: { must_change_password: false } });
  if (updated.error) throw new AppError('bad_request', updated.error.message);
  // Every other session of this login ends (stolen refresh tokens die with the old password).
  if (data.session?.access_token) {
    const out = await sb.auth.admin.signOut(data.session.access_token, 'global');
    if (out.error) logger.warn({ err: out.error.message }, 'password reset: global sign-out failed');
  }
}

// ---------------------------------------------------------------------------------------------
// Rate limits: per client IP and per address, fixed windows in Redis. Fails open (a Redis outage
// must not stop people resetting) like the login limiter.
// ---------------------------------------------------------------------------------------------

const hash = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

async function hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.set(key, '0', 'EX', windowSeconds, 'NX');
    return (await redis.incr(key)) > limit;
  } catch (err) {
    logger.warn({ err }, 'password reset rate limiter: Redis unavailable — failing open');
    return false;
  }
}

/** Reset requests: 10 per IP per 15 min, 5 per address per hour. True = refuse. */
export async function resetRequestLimited(ip: string, email: string): Promise<boolean> {
  const [byIp, byEmail] = await Promise.all([
    hit(`pr:ip:${hash(ip)}`, 10, 15 * 60),
    hit(`pr:acct:${hash(email.trim().toLowerCase())}`, 5, 60 * 60),
  ]);
  return byIp || byEmail;
}

/** Link redemptions: 20 per IP per 15 min. True = refuse. */
export const resetRedeemLimited = (ip: string): Promise<boolean> => hit(`pr:redeem:${hash(ip)}`, 20, 15 * 60);
