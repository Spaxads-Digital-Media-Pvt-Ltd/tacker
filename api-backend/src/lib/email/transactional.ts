/**
 * Transactional email (audit F-24) — the platform's own emails as named events, each sent through the
 * network's SMTP (lib/mailer.ts) only while the network's toggle for it is on (Communication Hub ›
 * Automated System Emails; default on). A toggle that's off, SMTP that isn't configured, or no
 * address to send to is a clean no-op that says why — never an exception — so the action that
 * triggered the email (an invite, an invoice, a balance request) always completes.
 *
 * Sending goes through the email queue (O11, lib/email/outbox.ts): those checks run here, at once,
 * and the email worker sends — retrying a failing mail server with backoff — so the request never
 * waits on SMTP. `sent: true` means accepted for delivery (`queued`); the outcome is in the email log.
 * Senders that are already off the request path and report the outcome themselves (scheduled reports
 * and their "Send now") use sendTransactionalNow.
 *
 * Templates live with their callers (escapeHtml below for any text that isn't the platform's own).
 * Some emails have no toggle and always go out (ALWAYS_ON_EMAILS): scheduled reports — their own
 * schedule is the opt-in — and account security mail (team invites, password resets).
 */
import { query } from '../db/pool.js';
import { sendNetworkEmail, smtpConfigError, type MailAttachment } from '../mailer.js';
import { enqueueEmails } from './outbox.js';
import { logger } from '../logger.js';
import { systemEmailDefault, type SystemEmailKey } from './system-emails.js';

/** Sent regardless of the Communication Hub toggles. */
export const ALWAYS_ON_EMAILS = ['scheduled_report', 'staff_invite', 'password_reset'] as const;
export type AlwaysOnEmail = (typeof ALWAYS_ON_EMAILS)[number];
const alwaysOn = (e: string): e is AlwaysOnEmail => (ALWAYS_ON_EMAILS as readonly string[]).includes(e);

export interface TransactionalResult {
  /** Accepted for delivery (queued for the email worker), or sent (sendTransactionalNow). */
  sent: boolean;
  /** On the email queue (the email log has the delivery outcome). */
  queued?: boolean;
  /** Why nothing went out (absent when sent). */
  skipped?: 'disabled' | 'smtp_not_configured' | 'no_recipients' | 'send_failed';
  reason?: string;
  recipients: string[];
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Is this system email on for the network? (Unset = its default — on for most; lib/email/system-emails.ts.) */
export async function systemEmailEnabled(networkId: string, key: SystemEmailKey): Promise<boolean> {
  const { rows } = await query<{ on: boolean | null }>(
    `SELECT (settings->'communicationHub'->'systemEmails'->>$2)::boolean AS on FROM networks WHERE id = $1`, [networkId, key]);
  return rows[0]?.on ?? systemEmailDefault(key);
}

type Mail = { subject: string; html: string; attachments?: MailAttachment[] };
const uniqueRecipients = (recipients: (string | null | undefined)[]) =>
  Array.from(new Set(recipients.map((r) => r?.trim()).filter((r): r is string => !!r)));

/** The checks every send makes first: the toggle, and an address to send to. */
async function precheck(networkId: string, event: SystemEmailKey | AlwaysOnEmail, to: string[]): Promise<TransactionalResult | null> {
  if (!alwaysOn(event) && !(await systemEmailEnabled(networkId, event))) {
    return { sent: false, skipped: 'disabled', reason: 'This email is turned off in Communication Hub › Automated System Emails.', recipients: to };
  }
  if (!to.length) return { sent: false, skipped: 'no_recipients', reason: 'No email address to send to.', recipients: to };
  return null;
}

/**
 * Queue a system email for the email worker. `sensitive` = it carries a credential (temporary
 * password, reset link): stored encrypted until sent, then wiped.
 */
export async function sendTransactional(
  networkId: string,
  event: SystemEmailKey | AlwaysOnEmail,
  recipients: (string | null | undefined)[],
  mail: Mail,
  opts: { sensitive?: boolean } = {},
): Promise<TransactionalResult> {
  const to = uniqueRecipients(recipients);
  const refused = await precheck(networkId, event, to);
  if (refused) return refused;
  try {
    const configError = await smtpConfigError(networkId);
    if (configError) return { sent: false, skipped: 'smtp_not_configured', reason: configError, recipients: to };
    const q = await enqueueEmails(networkId, event, to, mail, opts);
    if (q.error) return { sent: false, skipped: 'send_failed', reason: q.error, recipients: to };
    return { sent: true, queued: true, recipients: to };
  } catch (err) {
    logger.warn({ err, networkId, event }, 'transactional email could not be queued');
    return { sent: false, skipped: 'send_failed', reason: err instanceof Error ? err.message : 'Send failed', recipients: to };
  }
}

/**
 * The same email, personalised, to many people (partner notifications): the toggle and SMTP are
 * checked once, then each person gets their own queued email. People without an address are skipped.
 */
export async function sendTransactionalEach(
  networkId: string,
  event: SystemEmailKey,
  people: { email: string | null; name: string }[],
  render: (name: string) => Mail,
): Promise<TransactionalResult> {
  const withEmail = people.filter((p) => p.email?.trim());
  const to = uniqueRecipients(withEmail.map((p) => p.email));
  const refused = await precheck(networkId, event, to);
  if (refused) return refused;
  try {
    const configError = await smtpConfigError(networkId);
    if (configError) return { sent: false, skipped: 'smtp_not_configured', reason: configError, recipients: to };
    const seen = new Set<string>();
    for (const p of withEmail) {
      const email = p.email!.trim();
      if (seen.has(email)) continue;
      seen.add(email);
      const q = await enqueueEmails(networkId, event, [email], render(p.name));
      if (q.error) return { sent: false, skipped: 'send_failed', reason: q.error, recipients: to };
    }
    return { sent: true, queued: true, recipients: to };
  } catch (err) {
    logger.warn({ err, networkId, event }, 'notification emails could not be queued');
    return { sent: false, skipped: 'send_failed', reason: err instanceof Error ? err.message : 'Send failed', recipients: to };
  }
}

/** Send now, in this process, and report the outcome (scheduled reports and their "Send now"). */
export async function sendTransactionalNow(
  networkId: string,
  event: SystemEmailKey | AlwaysOnEmail,
  recipients: (string | null | undefined)[],
  mail: Mail,
): Promise<TransactionalResult> {
  const to = uniqueRecipients(recipients);
  const refused = await precheck(networkId, event, to);
  if (refused) return refused;
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
