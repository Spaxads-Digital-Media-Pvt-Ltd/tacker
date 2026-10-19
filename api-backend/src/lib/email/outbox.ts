/**
 * The email queue (O11). Emails are recorded in `email_outbox` — one row per recipient — and sent by
 * the email worker through the network's own SMTP, retried with backoff when the mail server fails,
 * so a slow or flaky server never slows down or fails the action that triggered the email. Each row
 * keeps its outcome (Communication Hub › Email log).
 *
 * A row whose email carries a credential (a temporary password, a reset link) is `sensitive`: its
 * body is stored encrypted (enc:v1) and wiped once sent, and nothing ever shows a body.
 */
import { UnrecoverableError } from 'bullmq';
import { query } from '../db/pool.js';
import { getQueue, QUEUE } from '../queues.js';
import { encryptSecret, decryptSecret } from '../crypto/secret-box.js';
import { sendNetworkEmail, sendPlatformEmail, type MailAttachment } from '../mailer.js';
import { logger } from '../logger.js';

/** Attempts per email — the gaps grow: 30 s, 1, 2, 4, 8 min (about a quarter of an hour in all). */
export const EMAIL_ATTEMPTS = 6;
const BACKOFF_MS = 30_000;

export interface EmailJob { outboxId: string }

interface OutboxRow {
  /** null = the platform's own email (its SMTP — Super Admin › Settings › Email). */
  id: string; network_id: string | null; recipient: string; subject: string; html: string;
  sensitive: boolean; attachments: MailAttachment[] | null; status: 'queued' | 'sent' | 'failed';
}

/** Queue a job for an outbox row (also used to retry a failed one). */
export async function queueOutboxRow(id: string): Promise<void> {
  await getQueue(QUEUE.email).add('email', { outboxId: id } satisfies EmailJob, {
    jobId: `${id}-${Date.now()}`,
    attempts: EMAIL_ATTEMPTS,
    backoff: { type: 'exponential', delay: BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/**
 * Record and queue one email per recipient. Returns the outbox ids, or `error` when the queue
 * couldn't take them (those rows are marked failed, so the log says so).
 */
export async function enqueueEmails(
  networkId: string,
  event: string,
  recipients: string[],
  mail: { subject: string; html: string; attachments?: MailAttachment[] },
  opts: { sensitive?: boolean } = {},
): Promise<{ ids: string[]; error?: string }> {
  const sensitive = Boolean(opts.sensitive);
  const ids: string[] = [];
  for (const recipient of recipients) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO email_outbox (network_id, event, recipient, subject, html, sensitive, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [networkId, event, recipient, mail.subject, sensitive ? encryptSecret(mail.html) : mail.html, sensitive,
        mail.attachments?.length ? JSON.stringify(mail.attachments) : null],
    );
    ids.push(rows[0]!.id);
  }
  try {
    for (const id of ids) await queueOutboxRow(id);
    return { ids };
  } catch (err) {
    const error = `The email couldn't be queued: ${err instanceof Error ? err.message : 'queue unavailable'}`;
    logger.warn({ err, networkId, event }, 'email queue unavailable');
    await query(`UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = ANY($1::uuid[]) AND status = 'queued'`, [ids, error]);
    return { ids, error };
  }
}

/**
 * Record and queue the platform's own emails (no network_id; `aboutNetworkId` for its log). Same queue,
 * retries and log as the networks' emails; sent through the platform's SMTP.
 */
export async function enqueuePlatformEmails(
  event: string, recipients: string[], mail: { subject: string; html: string }, opts: { aboutNetworkId?: string | null } = {},
): Promise<{ ids: string[]; error?: string }> {
  const ids: string[] = [];
  for (const recipient of [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))]) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO email_outbox (network_id, about_network_id, event, recipient, subject, html) VALUES (NULL, $1, $2, $3, $4, $5) RETURNING id`,
      [opts.aboutNetworkId ?? null, event, recipient, mail.subject, mail.html]);
    ids.push(rows[0]!.id);
  }
  try {
    for (const id of ids) await queueOutboxRow(id);
    return { ids };
  } catch (err) {
    const error = `The email couldn't be queued: ${err instanceof Error ? err.message : 'queue unavailable'}`;
    logger.warn({ err, event }, 'platform email queue unavailable');
    await query(`UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = ANY($1::uuid[]) AND status = 'queued'`, [ids, error]);
    return { ids, error };
  }
}

/**
 * One send attempt for an outbox row (`attempt` is 1-based; the worker says whether it's the last).
 * Throws so BullMQ retries a mail-server failure; SMTP that isn't set up, or a body that can't be
 * decrypted, is final (retrying can't help) — UnrecoverableError stops the retries.
 */
export async function deliverOutboxEmail(outboxId: string, attempt: number, lastAttempt: boolean): Promise<void> {
  const { rows } = await query<OutboxRow>(
    `SELECT id, network_id, recipient, subject, html, sensitive, attachments, status FROM email_outbox WHERE id = $1`, [outboxId]);
  const row = rows[0];
  if (!row || row.status === 'sent') return;

  const fail = async (error: string, final: boolean) => {
    await query(
      `UPDATE email_outbox SET attempts = $2, last_error = $3, status = $4 WHERE id = $1`,
      [row.id, attempt, error, final ? 'failed' : 'queued']);
  };

  let html = row.html;
  if (row.sensitive) {
    try { html = decryptSecret(row.html); } catch {
      await fail("The stored email can't be decrypted (the settings encryption key changed).", true);
      throw new UnrecoverableError('undecryptable email body');
    }
  }
  const result = row.network_id
    ? await sendNetworkEmail(row.network_id, [row.recipient], row.subject, html, { attachments: row.attachments ?? undefined })
    : await sendPlatformEmail([row.recipient], row.subject, html);
  if (result.configError) {
    await fail(result.configError, true);
    throw new UnrecoverableError(result.configError);
  }
  if (result.sent === 0) {
    const error = result.results[0]?.error ?? 'Send failed';
    await fail(error, lastAttempt);
    throw new Error(error);
  }
  await query(
    `UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = $2, last_error = NULL,
            html = CASE WHEN sensitive THEN '' ELSE html END
      WHERE id = $1`,
    [row.id, attempt]);
}
