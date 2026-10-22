/**
 * Super Admin › Settings › Slack — the platform team's events posted to a Slack channel through an
 * incoming webhook (platform_settings 'slack'): a new network, a demo request, a quote answered, a new
 * support ticket, an invoice paid / overdue, a network suspended for an unpaid invoice — each switchable.
 *
 * The webhook URL is a secret: stored encrypted (secret-box), never returned (only its last characters),
 * and only a Slack webhook (https://hooks.slack.com/…) is accepted. Posts go through the SSRF-safe client
 * with a short timeout and never throw — Slack being down never fails what triggered the post.
 */
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { decryptSecret, encryptSecret } from '../crypto/secret-box.js';
import { safeRequest } from '../net/safe-http.js';
import { appUrl } from '../app-url.js';

export const SLACK_EVENTS = [
  { key: 'networkCreated', label: 'A new network (created, or converted from a lead)' },
  { key: 'leadInbound', label: 'A demo request' },
  { key: 'quoteResponded', label: 'A prospect accepted or declined a quote' },
  { key: 'ticketCreated', label: 'A new support ticket' },
  { key: 'invoicePaid', label: 'An invoice marked paid' },
  { key: 'invoiceOverdue', label: 'An invoice is overdue' },
  { key: 'networkSuspended', label: 'A network suspended for an unpaid invoice' },
] as const;
export type SlackEvent = (typeof SLACK_EVENTS)[number]['key'];

interface Stored { enabled?: boolean; webhook?: string; events?: Partial<Record<SlackEvent, boolean>> }
export interface SlackSettings { enabled: boolean; hasWebhook: boolean; webhookHint: string | null; events: Record<SlackEvent, boolean> }

const SLACK_WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9/_-]{10,}$/;
export const slackWebhookError = (url: string): string | null =>
  SLACK_WEBHOOK_RE.test(url.trim()) ? null : 'must be a Slack incoming webhook URL (https://hooks.slack.com/services/…)';

async function stored(): Promise<Stored> {
  return (await query<{ value: Stored }>(`SELECT value FROM platform_settings WHERE key = 'slack'`)).rows[0]?.value ?? {};
}

function webhookOf(s: Stored): string | null {
  if (!s.webhook) return null;
  try { return decryptSecret(s.webhook); } catch { return null; }
}

export async function slackSettings(): Promise<SlackSettings> {
  const s = await stored();
  const hook = webhookOf(s);
  return {
    enabled: s.enabled === true && !!hook, hasWebhook: !!hook, webhookHint: hook ? `…${hook.slice(-6)}` : null,
    events: Object.fromEntries(SLACK_EVENTS.map((e) => [e.key, s.events?.[e.key] !== false])) as Record<SlackEvent, boolean>,
  };
}

/** Save; `webhookUrl` undefined keeps the stored one, null removes it. */
export async function saveSlackSettings(v: { enabled: boolean; webhookUrl?: string | null; events?: Partial<Record<SlackEvent, boolean>> }, by: string | null): Promise<SlackSettings> {
  const cur = await stored();
  const next: Stored = {
    enabled: v.enabled,
    webhook: v.webhookUrl === null ? undefined : v.webhookUrl ? encryptSecret(v.webhookUrl.trim()) : cur.webhook,
    events: { ...(cur.events ?? {}), ...(v.events ?? {}) },
  };
  await query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('slack', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), by]);
  return slackSettings();
}

/** Slack's mrkdwn escapes (&, <, >). */
export const slackText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** POST one message to `webhook`; resolves to null on success, else why it failed. */
export async function postToSlack(webhook: string, text: string): Promise<string | null> {
  try {
    const r = await safeRequest(webhook, { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' }, timeoutMs: 5000 });
    return r.status >= 200 && r.status < 300 ? null : `Slack answered ${r.status}${r.body ? `: ${r.body.slice(0, 120)}` : ''}`;
  } catch (err) {
    return err instanceof Error ? err.message : 'Slack could not be reached';
  }
}

/**
 * Post an event, when Slack is on and the event is switched on. `link` is an in-app path. Never throws;
 * callers needn't wait for it.
 */
export async function notifySlack(event: SlackEvent, text: string, link?: { path: string; label: string }): Promise<void> {
  try {
    const s = await stored();
    const hook = webhookOf(s);
    if (!s.enabled || !hook || s.events?.[event] === false) return;
    const msg = `${slackText(text)}${link ? ` — <${appUrl(link.path)}|${slackText(link.label)}>` : ''}`;
    const err = await postToSlack(hook, msg);
    if (err) logger.warn({ event, err }, 'slack post failed');
  } catch (err) {
    logger.warn({ err, event }, 'slack post failed');
  }
}
