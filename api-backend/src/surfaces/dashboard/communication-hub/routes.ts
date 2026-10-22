/**
 * Communication Hub (spec feature-depth) — mirrors the live reference's structure (Emails,
 * Partner Banners, Audiences, Templates, Settings) with genuinely real data and behavior:
 *
 *  - Audiences are saved filters over the REAL publishers/advertisers tables (status + Partner
 *    Tier), with a live, queried recipient count — not a fabricated number.
 *  - Email Messages actually send to each recipient's real contact_email, using the network's own
 *    SMTP settings (Settings › SMTP), through the email queue (O11): "Send Now" checks SMTP and
 *    queues one email per recipient; the email worker delivers them with retries, and the Email Log
 *    (GET /email-log) shows each one's outcome. "Schedule" is intentionally not offered: there is no worker to fire a
 *    scheduled send, and a control that silently does nothing would be dishonest, so the compose
 *    flow only supports Save Draft / Send Now (the reference's own default counters — "0
 *    Scheduled" — show this is a legitimately empty state there too).
 *  - Partner Banners' Published/Scheduled/Drafts/Expired status is derived on read from
 *    publish_at/expire_at vs. now(), so the tabs are always accurate without a cron job.
 *  - "Automated System Emails" lists the events that really send (SENT_SYSTEM_EMAILS — invites,
 *    balance requests, offer details, invoices, the partner notifications and the alert emails), each
 *    with a persisted on/off toggle the senders honour. Events with no send behind them yet are left
 *    out of the list (O11) rather than shown as toggles that do nothing.
 *  - Email Log: every queued email (system or campaign) with its status, attempts and last error;
 *    a failed one can be retried unless it carried a credential (an invite / reset — send a new one).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound, conflict } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { assertSameNetwork } from '../../../lib/db/ownership.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { requireRole } from '../auth.js';
import { smtpConfigError } from '../../../lib/mailer.js';
import { enqueueEmails, queueOutboxRow } from '../../../lib/email/outbox.js';
import { SYSTEM_EMAIL_CATALOG, SENT_SYSTEM_EMAILS, VISIBLE_SYSTEM_EMAILS, systemEmailDefault } from '../../../lib/email/system-emails.js';
import type { Request } from 'express';

const STATUSES = ['active', 'pending', 'inactive'] as const;

interface AudienceRow {
  id: string; name: string; group_type: 'publishers' | 'advertisers';
  status_filter: string[]; tier_id: string | null; created_at: string; updated_at: string;
}
interface TemplateRow {
  id: string; name: string; message_type: string; subject: string; body: string;
  created_at: string; updated_at: string;
}
interface EmailRow {
  id: string; subject: string; body: string; message_type: string; audience_id: string | null;
  status: string; scheduled_at: string | null; sent_at: string | null; recipient_count: number;
  send_error: string | null; created_at: string; updated_at: string;
}
interface BannerRow {
  id: string; name: string; message: string; priority: string; status: string;
  publish_at: string | null; expire_at: string | null; created_at: string; updated_at: string;
}

async function countRecipients(networkId: string, groupType: 'publishers' | 'advertisers', statusFilter: string[], tierId: string | null): Promise<number> {
  const table = groupType === 'publishers' ? 'publishers' : 'advertisers';
  const params: unknown[] = [networkId];
  let sql = `SELECT COUNT(*)::int AS n FROM ${table} WHERE network_id = $1 AND contact_email IS NOT NULL AND contact_email <> ''`;
  if (statusFilter.length) { params.push(statusFilter); sql += ` AND status = ANY($${params.length})`; }
  if (groupType === 'publishers' && tierId) {
    params.push(tierId);
    sql += ` AND id IN (SELECT publisher_id FROM partner_tier_members WHERE network_id = $1 AND tier_id = $${params.length})`;
  }
  const { rows } = await query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

async function recipientEmails(networkId: string, groupType: 'publishers' | 'advertisers', statusFilter: string[], tierId: string | null): Promise<string[]> {
  const table = groupType === 'publishers' ? 'publishers' : 'advertisers';
  const params: unknown[] = [networkId];
  let sql = `SELECT contact_email FROM ${table} WHERE network_id = $1 AND contact_email IS NOT NULL AND contact_email <> ''`;
  if (statusFilter.length) { params.push(statusFilter); sql += ` AND status = ANY($${params.length})`; }
  if (groupType === 'publishers' && tierId) {
    params.push(tierId);
    sql += ` AND id IN (SELECT publisher_id FROM partner_tier_members WHERE network_id = $1 AND tier_id = $${params.length})`;
  }
  const { rows } = await query<{ contact_email: string }>(sql, params);
  return rows.map((r) => r.contact_email);
}

function bannerEffectiveStatus(b: BannerRow, now = new Date()): 'draft' | 'scheduled' | 'published' | 'expired' {
  if (b.status === 'draft') return 'draft';
  if (b.expire_at && new Date(b.expire_at) <= now) return 'expired';
  if (b.publish_at && new Date(b.publish_at) > now) return 'scheduled';
  return 'published';
}
const bannerDto = (b: BannerRow) => ({
  id: b.id, name: b.name, message: b.message, priority: b.priority,
  status: bannerEffectiveStatus(b), publishAt: b.publish_at, expireAt: b.expire_at,
  createdAt: b.created_at, updatedAt: b.updated_at,
});

const audienceSchema = z.object({
  name: z.string().min(1).max(200),
  groupType: z.enum(['publishers', 'advertisers']),
  statusFilter: z.array(z.enum(STATUSES)).default([]),
  tierId: z.string().uuid().optional(),
});
const templateSchema = z.object({
  name: z.string().min(1).max(200),
  messageType: z.enum(['general', 'offer_details']).default('general'),
  subject: z.string().min(1).max(300),
  body: z.string().max(20000).default(''),
});
const emailSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().max(20000),
  messageType: z.enum(['general', 'offer_details']).default('general'),
  audienceId: z.string().uuid().optional(),
  action: z.enum(['draft', 'send']).default('draft'),
});
const bannerSchema = z.object({
  name: z.string().min(1).max(200),
  message: z.string().max(2000).default(''),
  priority: z.enum(['default', 'high']).default('default'),
  publishAt: z.string().optional(),
  expireAt: z.string().optional(),
  saveAsDraft: z.boolean().default(false),
});

async function performSend(req: Request, row: EmailRow): Promise<EmailRow> {
  const networkId = req.scope!.networkId;
  let recipients: string[] = [];
  if (row.audience_id) {
    const aud = await dbForRequest(req).selectOne<AudienceRow>('audiences', { id: row.audience_id });
    if (aud) recipients = await recipientEmails(networkId, aud.group_type, aud.status_filter, aud.tier_id);
  }
  if (recipients.length === 0) {
    const [updated] = await dbForRequest(req).update<EmailRow>('email_messages',
      { send_error: 'No recipients with an email address matched this audience.' }, { id: row.id });
    return updated!;
  }
  // SMTP not set up → nothing is queued and the message stays a draft with the reason.
  const configError = await smtpConfigError(networkId);
  if (configError) {
    const [updated] = await dbForRequest(req).update<EmailRow>('email_messages', { send_error: configError }, { id: row.id });
    return updated!;
  }
  // One queued email per recipient (O11): the email worker delivers them with retries; the Email Log
  // shows each one's outcome.
  const queued = await enqueueEmails(networkId, 'communication_message', recipients, { subject: row.subject, html: row.body });
  if (queued.error) {
    const [updated] = await dbForRequest(req).update<EmailRow>('email_messages', { send_error: queued.error }, { id: row.id });
    return updated!;
  }
  const [updated] = await dbForRequest(req).update<EmailRow>('email_messages', {
    status: 'sent', sent_at: new Date().toISOString(), recipient_count: recipients.length, send_error: null,
  }, { id: row.id });
  return updated!;
}

export function communicationHubRoutes(): Router {
  const r = Router();

  // ---- Overview (Communication Hub home) ----
  r.get('/overview', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;

    const [drafts, sentThisMonth, publishedLive, bannerDrafts] = await Promise.all([
      db.count('email_messages', { status: 'draft' }),
      query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM email_messages WHERE network_id=$1 AND status='sent' AND sent_at >= date_trunc('month', now(), 'UTC')`,
        [networkId],
      ).then((r2) => r2.rows[0]?.n ?? 0),
      query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM banners WHERE network_id=$1 AND status<>'draft' AND (publish_at IS NULL OR publish_at <= now()) AND (expire_at IS NULL OR expire_at > now())`,
        [networkId],
      ).then((r2) => r2.rows[0]?.n ?? 0),
      db.count('banners', { status: 'draft' }),
    ]);
    const scheduledThisWeekEmails = 0; // scheduling isn't offered yet (see file header)
    const scheduledThisWeekBanners = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM banners WHERE network_id=$1 AND status<>'draft' AND publish_at > now() AND publish_at <= now() + interval '7 days'`,
      [networkId],
    ).then((r2) => r2.rows[0]?.n ?? 0);

    const audienceRows = await db.selectMany<AudienceRow>('audiences', { orderBy: 'created_at', orderDir: 'desc', limit: 3 });
    const audiencesTotal = await db.count('audiences');
    const topAudiences = await Promise.all(audienceRows.map(async (a) => ({
      id: a.id, name: a.name, groupType: a.group_type,
      recipientCount: await countRecipients(networkId, a.group_type, a.status_filter, a.tier_id),
    })));

    const templateRows = await db.selectMany<TemplateRow>('email_templates', { orderBy: 'updated_at', orderDir: 'desc', limit: 3 });
    const templatesTotal = await db.count('email_templates');

    const recentEmails = await db.selectMany<EmailRow>('email_messages', { where: { status: 'sent' }, orderBy: 'sent_at', orderDir: 'desc', limit: 4 });
    const recentBanners = (await db.selectMany<BannerRow>('banners', { orderBy: 'created_at', orderDir: 'desc', limit: 4 })).map(bannerDto);

    const categoryCounts = VISIBLE_SYSTEM_EMAILS.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {});

    sendOk(res, {
      emails: { drafts, scheduledThisWeek: scheduledThisWeekEmails, sentThisMonth },
      banners: { publishedLive, scheduledThisWeek: scheduledThisWeekBanners, drafts: bannerDrafts },
      topAudiences, audiencesTotal,
      templates: templateRows.map((t) => ({ id: t.id, name: t.name, messageType: t.message_type })), templatesTotal,
      systemEmailCategories: categoryCounts, systemEmailsTotal: VISIBLE_SYSTEM_EMAILS.length,
      recentEmails: recentEmails.map((e) => ({
        id: e.id, subject: e.subject, messageType: e.message_type, recipientCount: e.recipient_count, sentAt: e.sent_at,
      })),
      recentBanners,
    });
  }));

  // ---- Templates ----
  r.get('/templates', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<TemplateRow>('email_templates', { orderBy: 'updated_at', orderDir: 'desc', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'communication-hub.templates');
    sendOk(res, rows.map((t) => ({
      id: t.id, name: t.name, messageType: t.message_type, subject: t.subject, body: t.body,
      createdAt: t.created_at, updatedAt: t.updated_at,
    })));
  }));
  r.post('/templates', requireRole('admin', 'manager'), validateBody(templateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof templateSchema>;
    const row = await dbForRequest(req).insert<TemplateRow>('email_templates', {
      name: b.name, message_type: b.messageType, subject: b.subject, body: b.body,
    });
    await writeAudit(req, { action: 'email_template.create', entityType: 'email_template', entityId: row.id, after: row });
    sendOk(res, { id: row.id }, undefined, 201);
  }));
  r.put('/templates/:id', requireRole('admin', 'manager'), validateBody(templateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof templateSchema>;
    const [row] = await dbForRequest(req).update<TemplateRow>('email_templates', {
      name: b.name, message_type: b.messageType, subject: b.subject, body: b.body,
    }, { id: req.params.id });
    if (!row) throw notFound('Template not found');
    await writeAudit(req, { action: 'email_template.update', entityType: 'email_template', entityId: row.id, after: row });
    sendOk(res, { id: row.id });
  }));
  r.delete('/templates/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete('email_templates', { id: req.params.id });
    if (!n) throw notFound('Template not found');
    await writeAudit(req, { action: 'email_template.delete', entityType: 'email_template', entityId: req.params.id });
    sendOk(res, { ok: true });
  }));

  // ---- Audiences ----
  r.get('/audiences', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const rows = await db.selectMany<AudienceRow>('audiences', { orderBy: 'created_at', orderDir: 'desc', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'communication-hub.audiences');
    const withCounts = await Promise.all(rows.map(async (a) => ({
      id: a.id, name: a.name, groupType: a.group_type, statusFilter: a.status_filter, tierId: a.tier_id,
      recipientCount: await countRecipients(networkId, a.group_type, a.status_filter, a.tier_id),
      createdAt: a.created_at, updatedAt: a.updated_at,
    })));
    sendOk(res, withCounts);
  }));
  r.post('/audiences', requireRole('admin', 'manager'), validateBody(audienceSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof audienceSchema>;
    await assertSameNetwork(req.scope!.networkId, 'partner_tiers', b.tierId, 'tierId');
    const row = await dbForRequest(req).insert<AudienceRow>('audiences', {
      name: b.name, group_type: b.groupType, status_filter: b.statusFilter, tier_id: b.tierId ?? null,
    });
    await writeAudit(req, { action: 'audience.create', entityType: 'audience', entityId: row.id, after: row });
    sendOk(res, { id: row.id }, undefined, 201);
  }));
  r.put('/audiences/:id', requireRole('admin', 'manager'), validateBody(audienceSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof audienceSchema>;
    await assertSameNetwork(req.scope!.networkId, 'partner_tiers', b.tierId, 'tierId');
    const [row] = await dbForRequest(req).update<AudienceRow>('audiences', {
      name: b.name, group_type: b.groupType, status_filter: b.statusFilter, tier_id: b.tierId ?? null,
    }, { id: req.params.id });
    if (!row) throw notFound('Audience not found');
    await writeAudit(req, { action: 'audience.update', entityType: 'audience', entityId: row.id, after: row });
    sendOk(res, { id: row.id });
  }));
  r.delete('/audiences/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete('audiences', { id: req.params.id });
    if (!n) throw notFound('Audience not found');
    await writeAudit(req, { action: 'audience.delete', entityType: 'audience', entityId: req.params.id });
    sendOk(res, { ok: true });
  }));

  // ---- Emails ----
  const emailsQuery = z.object({ status: z.enum(['all', 'draft', 'scheduled', 'sent']).optional() });
  r.get('/emails', validateQuery(emailsQuery), asyncHandler(async (req, res) => {
    const { status } = res.locals.query as z.infer<typeof emailsQuery>;
    const rows = await dbForRequest(req).selectMany<EmailRow>('email_messages', {
      where: status && status !== 'all' ? { status } : {}, orderBy: 'updated_at', orderDir: 'desc', limit: LIST_CAP, maxLimit: LIST_CAP,
    });
    warnIfCapped(rows, LIST_CAP, 'communication-hub.emails');
    sendOk(res, rows.map((e) => ({
      id: e.id, subject: e.subject, messageType: e.message_type, status: e.status,
      recipientCount: e.recipient_count, sentAt: e.sent_at, sendError: e.send_error,
      createdAt: e.created_at, updatedAt: e.updated_at,
    })));
  }));
  r.get('/emails/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<EmailRow>('email_messages', { id: req.params.id });
    if (!row) throw notFound('Email not found');
    sendOk(res, {
      id: row.id, subject: row.subject, body: row.body, messageType: row.message_type,
      audienceId: row.audience_id, status: row.status, recipientCount: row.recipient_count,
      sentAt: row.sent_at, sendError: row.send_error, createdAt: row.created_at, updatedAt: row.updated_at,
    });
  }));
  r.post('/emails', requireRole('admin', 'manager'), validateBody(emailSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof emailSchema>;
    let row = await dbForRequest(req).insert<EmailRow>('email_messages', {
      subject: b.subject, body: b.body, message_type: b.messageType, audience_id: b.audienceId ?? null, status: 'draft',
    });
    await writeAudit(req, { action: 'email_message.create', entityType: 'email_message', entityId: row.id, after: row });
    if (b.action === 'send') {
      row = await performSend(req, row);
      await writeAudit(req, { action: 'email_message.send', entityType: 'email_message', entityId: row.id, after: row });
    }
    sendOk(res, { id: row.id, status: row.status, recipientCount: row.recipient_count, sendError: row.send_error }, undefined, 201);
  }));
  r.put('/emails/:id', requireRole('admin', 'manager'), validateBody(emailSchema.omit({ action: true })), asyncHandler(async (req, res) => {
    const existing = await dbForRequest(req).selectOne<EmailRow>('email_messages', { id: req.params.id });
    if (!existing) throw notFound('Email not found');
    if (existing.status === 'sent') throw notFound('Sent messages cannot be edited');
    const b = req.body as Omit<z.infer<typeof emailSchema>, 'action'>;
    const [row] = await dbForRequest(req).update<EmailRow>('email_messages', {
      subject: b.subject, body: b.body, message_type: b.messageType, audience_id: b.audienceId ?? null,
    }, { id: req.params.id });
    await writeAudit(req, { action: 'email_message.update', entityType: 'email_message', entityId: row!.id, after: row });
    sendOk(res, { id: row!.id });
  }));
  r.post('/emails/:id/send', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    let row = await dbForRequest(req).selectOne<EmailRow>('email_messages', { id: req.params.id });
    if (!row) throw notFound('Email not found');
    if (row.status === 'sent') throw notFound('Already sent');
    row = await performSend(req, row);
    await writeAudit(req, { action: 'email_message.send', entityType: 'email_message', entityId: row.id, after: row });
    sendOk(res, { id: row.id, status: row.status, recipientCount: row.recipient_count, sendError: row.send_error });
  }));
  r.delete('/emails/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const existing = await dbForRequest(req).selectOne<EmailRow>('email_messages', { id: req.params.id });
    if (!existing) throw notFound('Email not found');
    if (existing.status === 'sent') throw notFound('Sent messages cannot be deleted');
    await dbForRequest(req).delete('email_messages', { id: req.params.id });
    await writeAudit(req, { action: 'email_message.delete', entityType: 'email_message', entityId: req.params.id });
    sendOk(res, { ok: true });
  }));

  // ---- Partner Banners ----
  r.get('/banners', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<BannerRow>('banners', { orderBy: 'created_at', orderDir: 'desc', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'communication-hub.banners');
    sendOk(res, rows.map(bannerDto));
  }));
  r.post('/banners', requireRole('admin', 'manager'), validateBody(bannerSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof bannerSchema>;
    const row = await dbForRequest(req).insert<BannerRow>('banners', {
      name: b.name, message: b.message, priority: b.priority,
      status: b.saveAsDraft ? 'draft' : 'published',
      publish_at: b.publishAt || null, expire_at: b.expireAt || null,
    });
    await writeAudit(req, { action: 'banner.create', entityType: 'banner', entityId: row.id, after: row });
    sendOk(res, bannerDto(row), undefined, 201);
  }));
  r.put('/banners/:id', requireRole('admin', 'manager'), validateBody(bannerSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof bannerSchema>;
    const [row] = await dbForRequest(req).update<BannerRow>('banners', {
      name: b.name, message: b.message, priority: b.priority,
      status: b.saveAsDraft ? 'draft' : 'published',
      publish_at: b.publishAt || null, expire_at: b.expireAt || null,
    }, { id: req.params.id });
    if (!row) throw notFound('Banner not found');
    await writeAudit(req, { action: 'banner.update', entityType: 'banner', entityId: row.id, after: row });
    sendOk(res, bannerDto(row));
  }));
  r.delete('/banners/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete('banners', { id: req.params.id });
    if (!n) throw notFound('Banner not found');
    await writeAudit(req, { action: 'banner.delete', entityType: 'banner', entityId: req.params.id });
    sendOk(res, { ok: true });
  }));

  // ---- Automated System Emails (Settings tab) ----
  r.get('/system-emails', asyncHandler(async (req, res) => {
    const { rows } = await query<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM networks WHERE id = $1', [req.scope!.networkId],
    );
    const stored = (rows[0]?.settings?.['communicationHub'] as { systemEmails?: Record<string, boolean> } | undefined)?.systemEmails ?? {};
    // Only emails that actually send are listed (O11) — `wired` stays for API compatibility.
    sendOk(res, VISIBLE_SYSTEM_EMAILS.map((e) => ({ ...e, enabled: stored[e.key] ?? systemEmailDefault(e.key), wired: true })));
  }));
  r.put('/system-emails/:key', requireRole('admin'), validateBody(z.object({ enabled: z.boolean() })), asyncHandler(async (req, res) => {
    const key = req.params.key ?? '';
    const catalogEntry = VISIBLE_SYSTEM_EMAILS.find((e) => e.key === key);
    if (!catalogEntry || !SENT_SYSTEM_EMAILS.has(catalogEntry.key)) throw notFound('Unknown system email');
    const networkId = req.scope!.networkId;
    const { rows } = await query<{ settings: Record<string, unknown> }>('SELECT settings FROM networks WHERE id = $1', [networkId]);
    const settings = rows[0]?.settings ?? {};
    const ch = (settings['communicationHub'] as { systemEmails?: Record<string, boolean> } | undefined) ?? {};
    const systemEmails: Record<string, boolean> = { ...(ch.systemEmails ?? {}), [key]: (req.body as { enabled: boolean }).enabled };
    await query('UPDATE networks SET settings = $2 WHERE id = $1', [networkId, JSON.stringify({ ...settings, communicationHub: { ...ch, systemEmails } })]);
    await writeAudit(req, { action: 'system_email.toggle', entityType: 'system_email', entityId: key });
    sendOk(res, { key, enabled: systemEmails[key] });
  }));

  // ---- Email Log (O11): the email queue's records, newest first — never a body. ----
  const logQuery = z.object({
    status: z.enum(['all', 'queued', 'sent', 'failed']).default('all'),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  });
  r.get('/email-log', requireRole('admin', 'manager'), validateQuery(logQuery), asyncHandler(async (req, res) => {
    const { status, limit } = res.locals.query as z.infer<typeof logQuery>;
    const params: unknown[] = [req.scope!.networkId];
    let where = 'network_id = $1';
    if (status !== 'all') { params.push(status); where += ` AND status = $${params.length}`; }
    params.push(limit);
    const { rows } = await query<{
      id: string; event: string; recipient: string; subject: string; status: string; attempts: number;
      last_error: string | null; sensitive: boolean; created_at: string; sent_at: string | null;
    }>(
      `SELECT id, event, recipient, subject, status, attempts, last_error, sensitive, created_at, sent_at
         FROM email_outbox WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    const counts = (await query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n FROM email_outbox WHERE network_id = $1 AND created_at >= now() - interval '7 days' GROUP BY status`,
      [req.scope!.networkId])).rows;
    sendOk(res, {
      rows: rows.map((e) => ({
        id: e.id, event: e.event, label: emailLabel(e.event), recipient: e.recipient, subject: e.subject, status: e.status,
        attempts: e.attempts, lastError: e.last_error, retryable: e.status === 'failed' && !e.sensitive, createdAt: e.created_at, sentAt: e.sent_at,
      })),
      last7Days: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    });
  }));

  // Retry a failed email. One that carried a credential (an invite's temporary password, a reset
  // link) isn't kept to resend — issue a new invite / reset instead.
  r.post('/email-log/:id/retry', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const { rows } = await query<{ id: string; status: string; sensitive: boolean }>(
      'SELECT id, status, sensitive FROM email_outbox WHERE network_id = $1 AND id = $2', [req.scope!.networkId, req.params.id]);
    const row = rows[0];
    if (!row) throw notFound('Email not found');
    if (row.status !== 'failed') throw conflict('Only a failed email can be retried.');
    if (row.sensitive) throw conflict('This email carried a temporary password or a reset link — send a new invite or reset instead.');
    await query(`UPDATE email_outbox SET status = 'queued', last_error = NULL WHERE network_id = $1 AND id = $2`, [req.scope!.networkId, row.id]);
    await queueOutboxRow(row.id);
    await writeAudit(req, { action: 'email.retry', entityType: 'email_outbox', entityId: row.id });
    sendOk(res, { queued: true });
  }));

  return r;
}

/** A readable name for an email log row's event. */
function emailLabel(event: string): string {
  const known = SYSTEM_EMAIL_CATALOG.find((e) => e.key === event)?.label;
  if (known) return known;
  return ({ communication_message: 'Email message', staff_invite: 'Team member invite', password_reset: 'Password reset', scheduled_report: 'Scheduled report' } as Record<string, string>)[event] ?? event;
}
