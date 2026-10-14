/**
 * Transactional email (audit F-24) — the platform's own emails as named events, each sent through the
 * network's SMTP (lib/mailer.ts) only while the network's toggle for it is on (Communication Hub ›
 * Automated System Emails; default on). A toggle that's off, SMTP that isn't configured, or no
 * address to send to is a clean no-op that says why — never an exception — so the action that
 * triggered the email (an invite, an invoice, a balance request) always completes.
 *
 * Templates live with their callers (escapeHtml below for any text that isn't the platform's own).
 * Some emails have no toggle and always go out (ALWAYS_ON_EMAILS): scheduled reports — their own
 * schedule is the opt-in — and account security mail (team invites, password resets).
 */
import { query } from '../db/pool.js';
import { sendNetworkEmail, type MailAttachment } from '../mailer.js';
import { logger } from '../logger.js';
import type { SystemEmailKey } from './system-emails.js';

/** Sent regardless of the Communication Hub toggles. */
export const ALWAYS_ON_EMAILS = ['scheduled_report', 'staff_invite', 'password_reset'] as const;
export type AlwaysOnEmail = (typeof ALWAYS_ON_EMAILS)[number];
const alwaysOn = (e: string): e is AlwaysOnEmail => (ALWAYS_ON_EMAILS as readonly string[]).includes(e);

export interface TransactionalResult {
  sent: boolean;
  /** Why nothing went out (absent when sent). */
  skipped?: 'disabled' | 'smtp_not_configured' | 'no_recipients' | 'send_failed';
  reason?: string;
  recipients: string[];
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Is this system email on for the network? (Unset = on, like the Communication Hub list shows.) */
export async function systemEmailEnabled(networkId: string, key: SystemEmailKey): Promise<boolean> {
  const { rows } = await query<{ on: boolean | null }>(
    `SELECT (settings->'communicationHub'->'systemEmails'->>$2)::boolean AS on FROM networks WHERE id = $1`, [networkId, key]);
  return rows[0]?.on ?? true;
}

export async function sendTransactional(
  networkId: string,
  event: SystemEmailKey | AlwaysOnEmail,
  recipients: (string | null | undefined)[],
  mail: { subject: string; html: string; attachments?: MailAttachment[] },
): Promise<TransactionalResult> {
  const to = Array.from(new Set(recipients.map((r) => r?.trim()).filter((r): r is string => !!r)));
  if (!alwaysOn(event) && !(await systemEmailEnabled(networkId, event))) {
    return { sent: false, skipped: 'disabled', reason: 'This email is turned off in Communication Hub › Automated System Emails.', recipients: to };
  }
  if (!to.length) return { sent: false, skipped: 'no_recipients', reason: 'No email address to send to.', recipients: to };
  try {
    const r = await sendNetworkEmail(networkId, to, mail.subject, mail.html, { attachments: mail.attachments });
    if (r.configError) return { sent: false, skipped: 'smtp_not_configured', reason: r.configError, recipients: to };
    if (r.sent === 0) return { sent: false, skipped: 'send_failed', reason: r.results.find((x) => !x.ok)?.error ?? 'Send failed', recipients: to };
    return { sent: true, recipients: to };
  } catch (err) {
    logger.warn({ err, networkId, event }, 'transactional email failed');
    return { sent: false, skipped: 'send_failed', reason: err instanceof Error ? err.message : 'Send failed', recipients: to };
  }
}

/** The network's display name (for email copy). */
export async function networkName(networkId: string): Promise<string> {
  const { rows } = await query<{ name: string }>('SELECT name FROM networks WHERE id = $1', [networkId]);
  return rows[0]?.name ?? 'your network';
}
