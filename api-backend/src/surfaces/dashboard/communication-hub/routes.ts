/**
 * Communication Hub (spec feature-depth) — mirrors the live reference's structure (Emails,
 * Partner Banners, Audiences, Templates, Settings) with genuinely real data and behavior:
 *
 *  - Audiences are saved filters over the REAL publishers/advertisers tables (status + Partner
 *    Tier), with a live, queried recipient count — not a fabricated number.
 *  - Email Messages actually send, via `lib/mailer.ts`, to each recipient's real contact_email,
 *    using the network's own SMTP settings (Settings › SMTP) — previously stored but unused by
 *    anything in this app. "Schedule" is intentionally not offered: there is no worker to fire a
 *    scheduled send, and a control that silently does nothing would be dishonest, so the compose
 *    flow only supports Save Draft / Send Now (the reference's own default counters — "0
 *    Scheduled" — show this is a legitimately empty state there too).
 *  - Partner Banners' Published/Scheduled/Drafts/Expired status is derived on read from
 *    publish_at/expire_at vs. now(), so the tabs are always accurate without a cron job.
 *  - "Automated System Emails" lists real events this app's own data model can fire on
 *    (Partner sign-up, Offer Applications, Offer Creatives, Invoices, Postbacks, Alerts) —
 *    the enabled/disabled toggle persists for real, but actually wiring a send into each of
 *    those ~14 action handlers is a separate, much larger project than Communication Hub itself,
 *    so toggling does not yet trigger a send (same "real state, not yet wired" honesty already
 *    used elsewhere in this app for out-of-scope automation).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { sendNetworkEmail } from '../../../lib/mailer.js';
import type { Request } from 'express';

const STATUSES = ['active', 'pending', 'inactive'] as const;

// Real events this app's own data model can already fire on — see file header for why the
// enabled toggle is real but not yet wired to an actual send.
export const SYSTEM_EMAIL_CATALOG = [
  { key: 'partner_signup_approved', label: 'Partner Sign-Up Approved', category: 'partner' },
  { key: 'partner_signup_rejected', label: 'Partner Sign-Up Rejected', category: 'partner' },
  { key: 'offer_application_approved', label: 'Offer Application Approved', category: 'partner' },
  { key: 'offer_application_denied', label: 'Offer Application Denied', category: 'partner' },
  { key: 'new_offer_creative_available', label: 'New Offer Creative Available', category: 'partner' },
  { key: 'partner_offer_now_available', label: 'Partner Offer Now Available', category: 'partner' },
  { key: 'partner_offer_now_unavailable', label: 'Partner Offer Now Unavailable', category: 'partner' },
  { key: 'partner_invoice_generated', label: 'Partner Invoice Generated', category: 'partner' },
  { key: 'advertiser_invoice_generated', label: 'Advertiser Invoice Generated', category: 'advertiser' },
  { key: 'advertiser_postback_received', label: 'Advertiser Postback Received', category: 'advertiser' },
  { key: 'new_conversion_recorded', label: 'New Conversion Recorded', category: 'advertiser' },
  { key: 'alert_threshold_triggered', label: 'Alert Threshold Triggered', category: 'misc' },
  { key: 'payout_batch_completed', label: 'Payout Batch Completed', category: 'misc' },
  { key: 'fraud_rule_triggered', label: 'Fraud Rule Triggered', category: 'misc' },
] as const;

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
    sql += ` AND id IN (SELECT publisher_id FROM partner_tier_members WHERE tier_id = $${params.length})`;
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
    sql += ` AND id IN (SELECT publisher_id FROM partner_tier_members WHERE tier_id = $${params.length})`;
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
  const result = await sendNetworkEmail(networkId, recipients, row.subject, row.body);
  if (result.configError) {
    const [updated] = await dbForRequest(req).update<EmailRow>('email_messages',
      { send_error: result.configError }, { id: row.id });
    return updated!;
  }
  const failed = result.results.filter((r) => !r.ok);
  if (result.sent === 0) {
    // Every attempt failed (bad host/credentials/etc.) — this did not actually send anything,
    // so it stays a draft with the real error surfaced, rather than a false "Sent" entry.
    const [updated] = await dbForRequest(req).update<EmailRow>('email_messages',
      { send_error: `Send failed for all ${recipients.length} recipient(s): ${failed[0]?.error ?? 'unknown error'}` }, { id: row.id });
    return updated!;
  }
  const [updated] = await dbForRequest(req).update<EmailRow>('email_messages', {
    status: 'sent', sent_at: new Date().toISOString(), recipient_count: result.sent,
    send_error: failed.length ? `Sent to ${result.sent}/${recipients.length}. Failed: ${failed.map((f) => f.recipient).join(', ')}` : null,
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
        `SELECT COUNT(*)::int AS n FROM email_messages WHERE network_id=$1 AND status='sent' AND sent_at >= date_trunc('month', now())`,
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

    const categoryCounts = SYSTEM_EMAIL_CATALOG.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {});

    sendOk(res, {
      emails: { drafts, scheduledThisWeek: scheduledThisWeekEmails, sentThisMonth },
      banners: { publishedLive, scheduledThisWeek: scheduledThisWeekBanners, drafts: bannerDrafts },
      topAudiences, audiencesTotal,
      templates: templateRows.map((t) => ({ id: t.id, name: t.name, messageType: t.message_type })), templatesTotal,
      systemEmailCategories: categoryCounts, systemEmailsTotal: SYSTEM_EMAIL_CATALOG.length,
      recentEmails: recentEmails.map((e) => ({
        id: e.id, subject: e.subject, messageType: e.message_type, recipientCount: e.recipient_count, sentAt: e.sent_at,
      })),
      recentBanners,
    });
  }));

  // ---- Templates ----
  r.get('/templates', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<TemplateRow>('email_templates', { orderBy: 'updated_at', orderDir: 'desc', limit: 200 });
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
    res.status(201);
    sendOk(res, { id: row.id });
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
    const rows = await db.selectMany<AudienceRow>('audiences', { orderBy: 'created_at', orderDir: 'desc', limit: 200 });
    const withCounts = await Promise.all(rows.map(async (a) => ({
      id: a.id, name: a.name, groupType: a.group_type, statusFilter: a.status_filter, tierId: a.tier_id,
      recipientCount: await countRecipients(networkId, a.group_type, a.status_filter, a.tier_id),
      createdAt: a.created_at, updatedAt: a.updated_at,
    })));
    sendOk(res, withCounts);
  }));
  r.post('/audiences', requireRole('admin', 'manager'), validateBody(audienceSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof audienceSchema>;
    const row = await dbForRequest(req).insert<AudienceRow>('audiences', {
      name: b.name, group_type: b.groupType, status_filter: b.statusFilter, tier_id: b.tierId ?? null,
    });
    await writeAudit(req, { action: 'audience.create', entityType: 'audience', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, { id: row.id });
  }));
  r.put('/audiences/:id', requireRole('admin', 'manager'), validateBody(audienceSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof audienceSchema>;
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
  r.get('/emails', asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const rows = await dbForRequest(req).selectMany<EmailRow>('email_messages', {
      where: status ? { status } : {}, orderBy: 'updated_at', orderDir: 'desc', limit: 200,
    });
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
    res.status(201);
    sendOk(res, { id: row.id, status: row.status, recipientCount: row.recipient_count, sendError: row.send_error });
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
    const rows = await dbForRequest(req).selectMany<BannerRow>('banners', { orderBy: 'created_at', orderDir: 'desc', limit: 200 });
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
    res.status(201);
    sendOk(res, bannerDto(row));
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
    sendOk(res, SYSTEM_EMAIL_CATALOG.map((e) => ({ ...e, enabled: stored[e.key] ?? true })));
  }));
  r.put('/system-emails/:key', requireRole('admin'), validateBody(z.object({ enabled: z.boolean() })), asyncHandler(async (req, res) => {
    const key = req.params.key ?? '';
    const catalogEntry = SYSTEM_EMAIL_CATALOG.find((e) => e.key === key);
    if (!catalogEntry) throw notFound('Unknown system email');
    const networkId = req.scope!.networkId;
    const { rows } = await query<{ settings: Record<string, unknown> }>('SELECT settings FROM networks WHERE id = $1', [networkId]);
    const settings = rows[0]?.settings ?? {};
    const ch = (settings['communicationHub'] as { systemEmails?: Record<string, boolean> } | undefined) ?? {};
    const systemEmails: Record<string, boolean> = { ...(ch.systemEmails ?? {}), [key]: (req.body as { enabled: boolean }).enabled };
    await query('UPDATE networks SET settings = $2 WHERE id = $1', [networkId, JSON.stringify({ ...settings, communicationHub: { ...ch, systemEmails } })]);
    await writeAudit(req, { action: 'system_email.toggle', entityType: 'system_email', entityId: key });
    sendOk(res, { key, enabled: systemEmails[key] });
  }));

  return r;
}
