/**
 * Super Admin › Settings › Email — the platform's SMTP and its notifications, a test email, and the log of what
 * the platform sent (its own outbox rows: network_id NULL), with a retry for a failed one.
 * settings:read sees, settings:full changes. The SMTP password is write-only.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../lib/http/validate.js';
import { conflict, notFound } from '../../lib/http/errors.js';
import { paginationSchema } from '../../lib/http/pagination.js';
import { query } from '../../lib/db/pool.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { platformSmtpConfigError, sendPlatformEmail } from '../../lib/mailer.js';
import { queueOutboxRow } from '../../lib/email/outbox.js';
import { NOTIFICATIONS, platformEmailSettings, savePlatformEmailSettings } from '../../lib/platform/email.js';
import { layout } from '../../lib/platform/notify.js';
import { requirePerm } from './auth.js';
import { UUID_RE, meId } from './fields.js';

const settingsSchema = z.object({
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().max(200),
  password: z.string().max(500).nullable().optional(),
  fromEmail: z.string().trim().max(200).refine((v) => v === '' || z.string().email().safeParse(v).success, 'must be an email address'),
  fromName: z.string().trim().max(120),
  notify: z.object(Object.fromEntries(NOTIFICATIONS.map((n) => [n.key, z.boolean()])) as Record<(typeof NOTIFICATIONS)[number]['key'], z.ZodBoolean>).strict(),
}).strict();

export function emailRoutes(): Router {
  const r = Router();

  r.get('/settings/email', requirePerm('settings', 'read'), asyncHandler(async (_req, res) => {
    sendOk(res, { ...(await platformEmailSettings()), notifications: NOTIFICATIONS, configError: await platformSmtpConfigError() });
  }));

  r.put('/settings/email', requirePerm('settings', 'full'), validateBody(settingsSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof settingsSchema>;
    const after = await savePlatformEmailSettings(b, meId(req));
    await writePlatformAudit(req, null, { action: 'settings.email', entityType: 'platform_settings', entityId: 'email', after: { ...after, passwordChanged: b.password !== undefined && b.password !== '' } });
    sendOk(res, { ...after, notifications: NOTIFICATIONS, configError: await platformSmtpConfigError() });
  }));

  // Sent at once (not queued) so the answer says whether the SMTP works.
  r.post('/settings/email/test', requirePerm('settings', 'full'), validateBody(z.object({ to: z.string().trim().email() }).strict()), asyncHandler(async (req, res) => {
    const configError = await platformSmtpConfigError();
    if (configError) throw conflict(configError);
    const { to } = req.body as { to: string };
    const r1 = await sendPlatformEmail([to], 'Test email from your platform', layout({ heading: 'It works', paragraphs: ['Your platform’s email is set up — notifications will be sent from this address.'] }));
    const result = r1.results[0];
    sendOk(res, { sent: r1.sent === 1, error: result?.ok ? null : result?.error ?? r1.configError ?? 'Send failed' });
  }));

  r.get('/emails', requirePerm('settings', 'read'), validateQuery(paginationSchema.extend({ status: z.enum(['queued', 'sent', 'failed']).optional() }).strict()), asyncHandler(async (_req, res) => {
    const f = res.locals.query as { limit: number; offset: number; status?: string };
    const { rows } = await query(
      `SELECT o.id, o.event, o.recipient, o.subject, o.status, o.attempts, o.last_error, o.created_at, o.sent_at, o.about_network_id, n.name AS network_name
         FROM email_outbox o LEFT JOIN networks n ON n.id = o.about_network_id
        WHERE o.network_id IS NULL AND ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [f.status ?? null, f.limit, f.offset]);
    sendOk(res, rows, { limit: f.limit, offset: f.offset });
  }));

  r.post('/emails/:id/retry', requirePerm('settings', 'full'), asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const row = UUID_RE.test(id) ? (await query<{ status: string }>(`SELECT status FROM email_outbox WHERE id = $1 AND network_id IS NULL`, [id])).rows[0] : undefined;
    if (!row) throw notFound('Email not found');
    if (row.status !== 'failed') throw conflict(`This email is ${row.status} — only a failed one is retried.`);
    await query(`UPDATE email_outbox SET status = 'queued', last_error = NULL WHERE id = $1`, [id]);
    await queueOutboxRow(id);
    sendOk(res, { queued: true });
  }));

  return r;
}
