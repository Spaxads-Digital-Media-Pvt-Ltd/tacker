/**
 * Alert delivery (audit F-23): a newly raised alert goes to the channels its source configured —
 * email through the network's own SMTP (lib/mailer.ts) and/or a JSON POST to a webhook through the
 * SSRF guard (lib/net/safe-http.ts) — and the outcome is recorded on the alert itself
 * (metadata.delivery), so "was anyone told?" is answerable from the alert. Shared by the fraud scan
 * and automation alert rules (F-17a). Never throws: a channel that fails is recorded, not raised.
 */
import { query } from '../db/pool.js';
import { sendNetworkEmail } from '../mailer.js';
import { safeRequest } from '../net/safe-http.js';
import { BRAND } from '../../config/branding.js';
import { logger } from '../logger.js';

export interface AlertChannels {
  emails: string[];
  /** Plain (decrypted) URL — callers decrypt what they store. */
  webhookUrl: string | null;
}

export interface DeliverableAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AlertDelivery {
  at: string;
  email?: { sent: number; failed: number; error?: string };
  webhook?: { ok: boolean; status?: number; error?: string };
}

export const hasAlertChannels = (c: AlertChannels): boolean => c.emails.length > 0 || Boolean(c.webhookUrl);

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function alertEmail(a: DeliverableAlert): { subject: string; html: string } {
  return {
    subject: `[${BRAND.name}] ${a.severity.toUpperCase()} alert: ${a.title}`,
    html: [
      `<p><strong>${escapeHtml(a.title)}</strong> (${escapeHtml(a.severity)})</p>`,
      a.description ? `<p>${escapeHtml(a.description)}</p>` : '',
      a.entityType && a.entityId ? `<p>${escapeHtml(a.entityType)}: <code>${escapeHtml(a.entityId)}</code></p>` : '',
      `<p>Alert <code>${escapeHtml(a.type)}</code> · id <code>${escapeHtml(a.id)}</code>. Review it under Alerts in your ${escapeHtml(BRAND.name)} dashboard.</p>`,
    ].join(''),
  };
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export async function deliverAlert(networkId: string, alert: DeliverableAlert, channels: AlertChannels): Promise<AlertDelivery> {
  const delivery: AlertDelivery = { at: new Date().toISOString() };

  if (channels.emails.length) {
    try {
      const { subject, html } = alertEmail(alert);
      const r = await sendNetworkEmail(networkId, channels.emails, subject, html);
      const failed = r.results.filter((x) => !x.ok);
      delivery.email = r.configError
        ? { sent: 0, failed: channels.emails.length, error: r.configError }
        : { sent: r.sent, failed: failed.length, ...(failed[0]?.error ? { error: failed[0].error } : {}) };
    } catch (err) {
      delivery.email = { sent: 0, failed: channels.emails.length, error: message(err, 'Send failed') };
    }
  }

  if (channels.webhookUrl) {
    try {
      const res = await safeRequest(channels.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `${BRAND.slug}-alerts/1.0` },
        body: JSON.stringify({
          event: 'alert.raised',
          alert: {
            id: alert.id, type: alert.type, severity: alert.severity, title: alert.title,
            description: alert.description ?? null, entityType: alert.entityType ?? null, entityId: alert.entityId ?? null,
            metadata: alert.metadata ?? {}, raisedAt: delivery.at,
          },
        }),
        timeoutMs: 5000,
        deadlineMs: 10_000,
        maxBodyBytes: 4096,
      });
      delivery.webhook = { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch (err) {
      delivery.webhook = { ok: false, error: message(err, 'Request failed') };
    }
  }

  try {
    await query(
      `UPDATE alerts SET metadata = metadata || jsonb_build_object('delivery', $3::jsonb) WHERE id = $1 AND network_id = $2`,
      [alert.id, networkId, JSON.stringify(delivery)],
    );
  } catch (err) {
    logger.warn({ err, networkId, alertId: alert.id }, 'alert delivery result not recorded');
  }
  return delivery;
}
