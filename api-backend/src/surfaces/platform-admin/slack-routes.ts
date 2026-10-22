/**
 * Super Admin › Settings › Slack (lib/platform/slack.ts): the incoming webhook (never returned — only its
 * last characters), on / off, which events post; a test message. settings:read sees, settings:full changes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody } from '../../lib/http/validate.js';
import { AppError, validationFailed } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { decryptSecret } from '../../lib/crypto/secret-box.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { BRAND } from '../../config/branding.js';
import { SLACK_EVENTS, postToSlack, saveSlackSettings, slackSettings, slackWebhookError, type SlackEvent } from '../../lib/platform/slack.js';
import { requirePerm } from './auth.js';
import { meId } from './fields.js';

const schema = z.object({
  enabled: z.boolean(),
  webhookUrl: z.string().trim().max(500).nullable().optional(),
  events: z.object(Object.fromEntries(SLACK_EVENTS.map((e) => [e.key, z.boolean()])) as Record<SlackEvent, z.ZodBoolean>).partial().strict().optional(),
}).strict();

export function slackRoutes(): Router {
  const r = Router();
  r.get('/settings/slack', requirePerm('settings', 'read'), asyncHandler(async (_req, res) => {
    sendOk(res, { ...(await slackSettings()), eventList: SLACK_EVENTS });
  }));
  r.put('/settings/slack', requirePerm('settings', 'full'), validateBody(schema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof schema>;
    if (b.webhookUrl) {
      const bad = slackWebhookError(b.webhookUrl);
      if (bad) throw validationFailed(`The webhook URL ${bad}.`, { field: 'webhookUrl' });
    }
    const current = await slackSettings();
    if (b.enabled && !b.webhookUrl && (b.webhookUrl === null || !current.hasWebhook)) throw validationFailed('Add the webhook URL to turn Slack on.', { field: 'webhookUrl' });
    const after = await saveSlackSettings(b, meId(req));
    await writePlatformAudit(req, null, { action: 'settings.slack', entityType: 'platform_settings', entityId: 'slack', after: { ...after, webhookChanged: b.webhookUrl !== undefined } });
    sendOk(res, { ...after, eventList: SLACK_EVENTS });
  }));
  r.post('/settings/slack/test', requirePerm('settings', 'full'), asyncHandler(async (_req, res) => {
    const stored = (await query<{ value: { webhook?: string } }>(`SELECT value FROM platform_settings WHERE key = 'slack'`)).rows[0]?.value;
    let hook: string | null = null;
    try { hook = stored?.webhook ? decryptSecret(stored.webhook) : null; } catch { hook = null; }
    if (!hook) throw new AppError('conflict', 'Save a webhook URL first.');
    const err = await postToSlack(hook, `:white_check_mark: ${BRAND.name} Super Admin can post to this channel.`);
    if (err) throw new AppError('conflict', `Slack didn’t take the test message — ${err}`, { reason: 'slack_failed' });
    sendOk(res, { sent: true });
  }));
  return r;
}
