/**
 * Automation — Scheduled Actions, Alert rules, and Webhooks.
 * Scheduled-action execution, alert firing, and webhook delivery are not wired yet — CRUD only.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import {
  createScheduledActionSchema,
  updateScheduledActionSchema,
  type CreateScheduledAction,
} from '../offers/asset-schemas.js';

const TABLE = 'offer_scheduled_actions';
const ALERT_RULES_TABLE = 'automation_alert_rules';
const WEBHOOKS_TABLE = 'automation_webhooks';

interface ScheduledActionRow {
  id: string;
  network_id: string;
  offer_id: string;
  action_type: string;
  partner_ids: string[] | string;
  event: string | null;
  scheduled_time: string | null;
  internal_notes: string | null;
  created_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  offer_name?: string | null;
  offer_ref?: string | null;
}

function parsePartnerIds(v: string[] | string): string[] {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v) as string[]; } catch { return []; }
}

function toDto(r: ScheduledActionRow, displayId?: number) {
  const partnerIds = parsePartnerIds(r.partner_ids);
  return {
    id: r.id,
    displayId: displayId ?? null,
    offerId: r.offer_id,
    offerName: r.offer_name ?? null,
    offerRef: r.offer_ref != null ? Number(r.offer_ref) : null,
    actionType: r.action_type,
    partnerIds,
    partnerCount: partnerIds.length,
    offerGroupCount: 0,
    creativeCount: 0,
    event: r.event,
    scheduledTime: r.scheduled_time,
    internalNotes: r.internal_notes,
    createdBy: r.created_by,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function actorLabel(req: import('express').Request): string | null {
  return req.identity?.surface === 'dashboard' ? req.identity.userId : null;
}

const listQuery = z.object({
  status: z.enum(['all', 'pending', 'executed', 'cancelled']).optional(),
});

const createNetworkSchema = createScheduledActionSchema.extend({
  offerId: z.string().uuid(),
});

interface AlertRuleRow {
  id: string; ref: string; name: string; conditions: string;
  notify_in_app: boolean; notify_email: boolean; status: string;
  created_at: string; updated_at: string;
}

const alertRuleDto = (r: AlertRuleRow) => ({
  id: r.id,
  ref: Number(r.ref),
  name: r.name,
  conditions: r.conditions,
  inApp: r.notify_in_app,
  email: r.notify_email,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const alertListQuery = z.object({
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional(),
});

const createAlertRuleSchema = z.object({
  name: z.string().min(1).max(200),
  conditions: z.string().min(1).max(2000),
  inApp: z.boolean().default(true),
  email: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
});

const updateAlertRuleSchema = createAlertRuleSchema.partial();

interface WebhookRow {
  id: string; name: string; events: string; http_method: string; url: string;
  status: string; created_at: string; updated_at: string;
}

const webhookDto = (r: WebhookRow) => ({
  id: r.id,
  name: r.name,
  events: r.events,
  httpMethod: r.http_method,
  url: r.url,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const webhookListQuery = z.object({
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional(),
});

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const createWebhookSchema = z.object({
  name: z.string().min(1).max(200),
  events: z.string().max(2000).default(''),
  httpMethod: z.enum(HTTP_METHODS).default('POST'),
  url: z.string().min(1).max(2000).transform((s) => {
    const t = s.trim();
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }).pipe(z.string().url()),
  status: z.enum(['active', 'inactive']).default('active'),
});

const updateWebhookSchema = createWebhookSchema.partial();

export function automationRoutes(): Router {
  const r = Router();

  r.get('/scheduled-actions', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const status = (req.query.status as string | undefined) ?? 'all';
    const params: unknown[] = [networkId];
    let where = 'sa.network_id = $1';
    if (status && status !== 'all') {
      params.push(status);
      where += ` AND sa.status = $${params.length}`;
    }
    const { rows } = await query<ScheduledActionRow>(
      `SELECT sa.*, o.name AS offer_name, o.ref::text AS offer_ref
       FROM ${TABLE} sa
       JOIN offers o ON o.id = sa.offer_id AND o.network_id = sa.network_id
       WHERE ${where}
       ORDER BY sa.created_at DESC
       LIMIT 500`,
      params,
    );
    sendOk(res, rows.map((row, i) => toDto(row, rows.length - i)));
  }));

  r.post(
    '/scheduled-actions',
    requireRole('admin', 'manager'),
    validateBody(createNetworkSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const b = req.body as z.infer<typeof createNetworkSchema>;
      const offer = await db.selectOne<{ id: string }>('offers', { id: b.offerId });
      if (!offer) throw notFound('Offer not found');
      const row = await db.insert<ScheduledActionRow>(TABLE, {
        offer_id: b.offerId,
        action_type: b.actionType,
        partner_ids: JSON.stringify(b.partnerIds),
        event: b.event ?? null,
        scheduled_time: b.scheduledTime ?? null,
        internal_notes: b.internalNotes ?? null,
        created_by: actorLabel(req),
        status: b.status,
      });
      const full = await fetchRow(req.scope!.networkId, row.id);
      await writeAudit(req, {
        action: 'offer.scheduled_action.create',
        entityType: 'offer_scheduled_actions',
        entityId: row.id,
        after: row,
      });
      res.status(201);
      sendOk(res, toDto(full!));
    }),
  );

  r.patch(
    '/scheduled-actions/:id',
    requireRole('admin', 'manager'),
    validateBody(updateScheduledActionSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const id = req.params.id ?? '';
      const before = await db.selectOne<ScheduledActionRow>(TABLE, { id });
      if (!before) throw notFound('Scheduled action not found');
      const b = req.body as Partial<CreateScheduledAction>;
      const patch: Record<string, unknown> = {};
      if (b.actionType !== undefined) patch['action_type'] = b.actionType;
      if (b.partnerIds !== undefined) patch['partner_ids'] = JSON.stringify(b.partnerIds);
      if (b.event !== undefined) patch['event'] = b.event;
      if (b.scheduledTime !== undefined) patch['scheduled_time'] = b.scheduledTime;
      if (b.internalNotes !== undefined) patch['internal_notes'] = b.internalNotes;
      if (b.status !== undefined) patch['status'] = b.status;
      const [updated] = await db.update<ScheduledActionRow>(TABLE, patch, { id });
      await writeAudit(req, {
        action: 'offer.scheduled_action.update',
        entityType: 'offer_scheduled_actions',
        entityId: id,
        before,
        after: updated,
      });
      const full = await fetchRow(req.scope!.networkId, id);
      sendOk(res, toDto(full!));
    }),
  );

  r.delete('/scheduled-actions/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const id = req.params.id ?? '';
    const before = await db.selectOne<ScheduledActionRow>(TABLE, { id });
    if (!before) throw notFound('Scheduled action not found');
    const [updated] = await db.update<ScheduledActionRow>(TABLE, { status: 'cancelled' }, { id });
    await writeAudit(req, {
      action: 'offer.scheduled_action.delete',
      entityType: 'offer_scheduled_actions',
      entityId: id,
      before,
      after: updated,
    });
    sendOk(res, { deleted: true });
  }));

  // --- Alert rules (Automation › Alerts) ---
  r.get('/alert-rules', validateQuery(alertListQuery), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const status = (req.query.status as string | undefined) ?? 'all';
    const where = status === 'all' ? {} : { status };
    const rows = await db.selectMany<AlertRuleRow>(ALERT_RULES_TABLE, {
      where, orderBy: 'created_at', limit: 500,
    });
    sendOk(res, rows.map(alertRuleDto));
  }));

  r.post(
    '/alert-rules',
    requireRole('admin', 'manager'),
    validateBody(createAlertRuleSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const b = req.body as z.infer<typeof createAlertRuleSchema>;
      const row = await db.insert<AlertRuleRow>(ALERT_RULES_TABLE, {
        name: b.name,
        conditions: b.conditions,
        notify_in_app: b.inApp,
        notify_email: b.email,
        status: b.status,
      });
      await writeAudit(req, {
        action: 'automation_alert_rule.create',
        entityType: 'automation_alert_rules',
        entityId: row.id,
        after: row,
      });
      res.status(201);
      sendOk(res, alertRuleDto(row));
    }),
  );

  r.patch(
    '/alert-rules/:id',
    requireRole('admin', 'manager'),
    validateBody(updateAlertRuleSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const id = req.params.id ?? '';
      const before = await db.selectOne<AlertRuleRow>(ALERT_RULES_TABLE, { id });
      if (!before) throw notFound('Alert rule not found');
      const b = req.body as z.infer<typeof updateAlertRuleSchema>;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch['name'] = b.name;
      if (b.conditions !== undefined) patch['conditions'] = b.conditions;
      if (b.inApp !== undefined) patch['notify_in_app'] = b.inApp;
      if (b.email !== undefined) patch['notify_email'] = b.email;
      if (b.status !== undefined) patch['status'] = b.status;
      const [updated] = await db.update<AlertRuleRow>(ALERT_RULES_TABLE, patch, { id });
      await writeAudit(req, {
        action: 'automation_alert_rule.update',
        entityType: 'automation_alert_rules',
        entityId: id,
        before,
        after: updated,
      });
      sendOk(res, alertRuleDto(updated ?? before));
    }),
  );

  r.delete('/alert-rules/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const id = req.params.id ?? '';
    const before = await db.selectOne<AlertRuleRow>(ALERT_RULES_TABLE, { id });
    if (!before) throw notFound('Alert rule not found');
    const [updated] = await db.update<AlertRuleRow>(ALERT_RULES_TABLE, { status: 'deleted' }, { id });
    await writeAudit(req, {
      action: 'automation_alert_rule.delete',
      entityType: 'automation_alert_rules',
      entityId: id,
      before,
      after: updated,
    });
    sendOk(res, { deleted: true });
  }));

  // --- Webhooks (Automation › Webhooks) ---
  r.get('/webhooks', validateQuery(webhookListQuery), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const status = (req.query.status as string | undefined) ?? 'all';
    const where = status === 'all' ? {} : { status };
    const rows = await db.selectMany<WebhookRow>(WEBHOOKS_TABLE, {
      where, orderBy: 'created_at', limit: 500,
    });
    sendOk(res, rows.map(webhookDto));
  }));

  r.post(
    '/webhooks',
    requireRole('admin', 'manager'),
    validateBody(createWebhookSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const b = req.body as z.infer<typeof createWebhookSchema>;
      const row = await db.insert<WebhookRow>(WEBHOOKS_TABLE, {
        name: b.name,
        events: b.events,
        http_method: b.httpMethod,
        url: b.url,
        status: b.status,
      });
      await writeAudit(req, {
        action: 'automation_webhook.create',
        entityType: 'automation_webhooks',
        entityId: row.id,
        after: row,
      });
      res.status(201);
      sendOk(res, webhookDto(row));
    }),
  );

  r.patch(
    '/webhooks/:id',
    requireRole('admin', 'manager'),
    validateBody(updateWebhookSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const id = req.params.id ?? '';
      const before = await db.selectOne<WebhookRow>(WEBHOOKS_TABLE, { id });
      if (!before) throw notFound('Webhook not found');
      const b = req.body as z.infer<typeof updateWebhookSchema>;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch['name'] = b.name;
      if (b.events !== undefined) patch['events'] = b.events;
      if (b.httpMethod !== undefined) patch['http_method'] = b.httpMethod;
      if (b.url !== undefined) patch['url'] = b.url;
      if (b.status !== undefined) patch['status'] = b.status;
      const [updated] = await db.update<WebhookRow>(WEBHOOKS_TABLE, patch, { id });
      await writeAudit(req, {
        action: 'automation_webhook.update',
        entityType: 'automation_webhooks',
        entityId: id,
        before,
        after: updated,
      });
      sendOk(res, webhookDto(updated ?? before));
    }),
  );

  r.delete('/webhooks/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const id = req.params.id ?? '';
    const before = await db.selectOne<WebhookRow>(WEBHOOKS_TABLE, { id });
    if (!before) throw notFound('Webhook not found');
    const [updated] = await db.update<WebhookRow>(WEBHOOKS_TABLE, { status: 'deleted' }, { id });
    await writeAudit(req, {
      action: 'automation_webhook.delete',
      entityType: 'automation_webhooks',
      entityId: id,
      before,
      after: updated,
    });
    sendOk(res, { deleted: true });
  }));

  return r;
}

async function fetchRow(networkId: string, id: string): Promise<ScheduledActionRow | null> {
  const { rows } = await query<ScheduledActionRow>(
    `SELECT sa.*, o.name AS offer_name, o.ref::text AS offer_ref
     FROM ${TABLE} sa
     JOIN offers o ON o.id = sa.offer_id AND o.network_id = sa.network_id
     WHERE sa.network_id = $1 AND sa.id = $2`,
    [networkId, id],
  );
  return rows[0] ?? null;
}
