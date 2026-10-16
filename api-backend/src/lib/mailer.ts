/**
 * Real SMTP sending — the first actual consumer of the SMTP settings that Settings › SMTP has
 * always stored but never used (`surfaces/dashboard/settings/routes.ts`). Communication Hub
 * email sends go through here for real, to each recipient's real contact_email.
 */
import nodemailer from 'nodemailer';
import { query } from './db/pool.js';
import { decryptSecret } from './crypto/secret-box.js';

interface SmtpSettings {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
  secure?: boolean;
}

async function loadSmtp(networkId: string): Promise<SmtpSettings> {
  const { rows } = await query<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM networks WHERE id = $1', [networkId],
  );
  return (rows[0]?.settings?.['smtp'] as SmtpSettings | undefined) ?? {};
}

export interface SendResult {
  recipient: string;
  ok: boolean;
  error?: string;
}

export interface MailAttachment { filename: string; content: string; contentType?: string }

const NOT_CONFIGURED = 'SMTP is not fully configured yet — set Host, Username, Password and From Email in Settings › SMTP before sending.';
const UNREADABLE = "The stored SMTP password can't be decrypted — re-enter it in Settings › SMTP.";

/** Why this network can't send email right now (SMTP not set up / password unreadable), or null. */
export async function smtpConfigError(networkId: string): Promise<string | null> {
  const smtp = await loadSmtp(networkId);
  if (!smtp.host || !smtp.username || !smtp.password || !smtp.fromEmail) return NOT_CONFIGURED;
  try { decryptSecret(smtp.password); } catch { return UNREADABLE; }
  return null;
}

/** Sends `subject`/`html` to every address in `recipients` via the network's own SMTP config. */
export async function sendNetworkEmail(
  networkId: string,
  recipients: string[],
  subject: string,
  html: string,
  opts: { attachments?: MailAttachment[] } = {},
): Promise<{ sent: number; results: SendResult[]; configError?: string }> {
  return sendWith(await loadSmtp(networkId), recipients, subject, html, opts, NOT_CONFIGURED, UNREADABLE);
}

// ---- The platform's own email (Super Admin › Settings › Email) ---------------------------------------

const PLATFORM_NOT_CONFIGURED = 'The platform’s email isn’t set up — Super Admin › Settings › Email (host, username, password, from address).';
const PLATFORM_UNREADABLE = "The platform's SMTP password can't be decrypted — re-enter it in Super Admin › Settings › Email.";

async function loadPlatformSmtp(): Promise<SmtpSettings> {
  const { rows } = await query<{ value: SmtpSettings }>(`SELECT value FROM platform_settings WHERE key = 'email'`);
  return rows[0]?.value ?? {};
}

/** Why the platform can't send email right now, or null. */
export async function platformSmtpConfigError(): Promise<string | null> {
  const smtp = await loadPlatformSmtp();
  if (!smtp.host || !smtp.username || !smtp.password || !smtp.fromEmail) return PLATFORM_NOT_CONFIGURED;
  try { decryptSecret(smtp.password); } catch { return PLATFORM_UNREADABLE; }
  return null;
}

/** Sends through the platform's SMTP (platform_settings 'email'). */
export async function sendPlatformEmail(recipients: string[], subject: string, html: string): Promise<{ sent: number; results: SendResult[]; configError?: string }> {
  return sendWith(await loadPlatformSmtp(), recipients, subject, html, {}, PLATFORM_NOT_CONFIGURED, PLATFORM_UNREADABLE);
}

async function sendWith(
  smtp: SmtpSettings, recipients: string[], subject: string, html: string, opts: { attachments?: MailAttachment[] },
  notConfigured: string, unreadable: string,
): Promise<{ sent: number; results: SendResult[]; configError?: string }> {
  if (!smtp.host || !smtp.username || !smtp.password || !smtp.fromEmail) {
    return { sent: 0, results: [], configError: notConfigured };
  }
  let pass: string;
  try {
    pass = decryptSecret(smtp.password); // stored encrypted (F-07); legacy plaintext passes through
  } catch {
    return { sent: 0, results: [], configError: unreadable };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port ?? 587,
    secure: Boolean(smtp.secure),
    auth: { user: smtp.username, pass },
  });

  const from = smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail;
  const results: SendResult[] = [];
  for (const recipient of recipients) {
    try {
      await transport.sendMail({ from, to: recipient, subject, html, ...(opts.attachments?.length ? { attachments: opts.attachments } : {}) });
      results.push({ recipient, ok: true });
    } catch (e) {
      results.push({ recipient, ok: false, error: e instanceof Error ? e.message : 'Send failed' });
    }
  }
  return { sent: results.filter((r) => r.ok).length, results };
}
