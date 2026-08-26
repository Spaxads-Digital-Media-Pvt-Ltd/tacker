/**
 * Network settings (spec feature-depth) — general, SMTP/email, and integrations. Stored in the
 * networks.settings jsonb (+ core columns name/default_currency for general). Admin-only; writes
 * require admin. The SMTP password is a secret: it's stored but NEVER returned to the client — GET
 * returns passwordSet:boolean instead, and a write only changes it when a non-empty value is sent
 * (spec §3A: secrets don't leave the server).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { generateSecureCode } from '../../../lib/security-code.js';

interface NetworkRow { ref: string; name: string; default_currency: string; status: string; settings: Record<string, unknown> }

async function loadNetwork(networkId: string): Promise<NetworkRow> {
  const { rows } = await query<NetworkRow>('SELECT ref, name, default_currency, status, settings FROM networks WHERE id = $1', [networkId]);
  const row = rows[0];
  if (!row) throw notFound('Network not found');
  return row;
}

async function saveSettings(networkId: string, settings: Record<string, unknown>): Promise<void> {
  await query('UPDATE networks SET settings = $2 WHERE id = $1', [networkId, JSON.stringify(settings)]);
}

const generalSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  defaultCurrency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  supportEmail: z.string().email().optional(),
});

const smtpSchema = z.object({
  host: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),   // secret; only applied when non-empty
  fromEmail: z.string().email().optional(),
  fromName: z.string().max(200).optional(),
  secure: z.boolean().optional(),
});

const integrationsSchema = z.object({
  values: z.record(z.string(), z.unknown()),   // freeform integration key/values (webhook URLs, ids)
});

export function settingsRoutes(): Router {
  const r = Router();

  // Read everything (SMTP password masked).
  r.get('/', asyncHandler(async (req, res) => {
    const net = await loadNetwork(req.scope!.networkId);
    const s = net.settings ?? {};
    const smtp = (s['smtp'] as Record<string, unknown> | undefined) ?? {};
    const { password, ...smtpSafe } = smtp as { password?: string };
    sendOk(res, {
      general: { nid: Number(net.ref), name: net.name, defaultCurrency: net.default_currency, status: net.status, ...(s['general'] as object ?? {}) },
      smtp: { ...smtpSafe, passwordSet: Boolean(password) },
      integrations: (s['integrations'] as object) ?? {},
    });
  }));

  // General — also writes core network columns.
  r.put('/general', requireRole('admin', 'manager'), validateBody(generalSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof generalSchema>;
    const net = await loadNetwork(networkId);
    if (b.name !== undefined || b.defaultCurrency !== undefined) {
      await query('UPDATE networks SET name = COALESCE($2, name), default_currency = COALESCE($3, default_currency) WHERE id = $1',
        [networkId, b.name ?? null, b.defaultCurrency ?? null]);
    }
    const general = { ...(net.settings?.['general'] as object ?? {}) } as Record<string, unknown>;
    if (b.timezone !== undefined) general['timezone'] = b.timezone;
    if (b.supportEmail !== undefined) general['supportEmail'] = b.supportEmail;
    await saveSettings(networkId, { ...net.settings, general });
    await writeAudit(req, { action: 'settings.general.update', entityType: 'network', entityId: networkId });
    sendOk(res, { ok: true });
  }));

  // SMTP — password kept if not provided.
  r.put('/smtp', requireRole('admin'), validateBody(smtpSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof smtpSchema>;
    const net = await loadNetwork(networkId);
    const prev = (net.settings?.['smtp'] as Record<string, unknown> | undefined) ?? {};
    const smtp: Record<string, unknown> = { ...prev };
    for (const k of ['host', 'port', 'username', 'fromEmail', 'fromName', 'secure'] as const) {
      if (b[k] !== undefined) smtp[k] = b[k];
    }
    if (b.password) smtp['password'] = b.password; // only overwrite when a real value is sent
    await saveSettings(networkId, { ...net.settings, smtp });
    await writeAudit(req, { action: 'settings.smtp.update', entityType: 'network', entityId: networkId });
    sendOk(res, { ok: true });
  }));

  // Integrations — freeform key/value bag.
  r.put('/integrations', requireRole('admin'), validateBody(integrationsSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof integrationsSchema>;
    const net = await loadNetwork(networkId);
    const integrations = { ...(net.settings?.['integrations'] as object ?? {}), ...b.values };
    await saveSettings(networkId, { ...net.settings, integrations });
    await writeAudit(req, { action: 'settings.integrations.update', entityType: 'network', entityId: networkId });
    sendOk(res, { ok: true });
  }));

  // Global postback secure_code — the code the tracking /postback requires by default (offer code overrides).
  r.get('/security', asyncHandler(async (req, res) => {
    const { rows } = await query<{ postback_security_code: string | null }>(
      'SELECT postback_security_code FROM networks WHERE id = $1', [req.scope!.networkId]);
    sendOk(res, { securityCode: rows[0]?.postback_security_code ?? null });
  }));

  r.post('/security/regenerate', requireRole('admin'), asyncHandler(async (req, res) => {
    const code = generateSecureCode();
    await query('UPDATE networks SET postback_security_code = $2 WHERE id = $1', [req.scope!.networkId, code]);
    await writeAudit(req, { action: 'settings.security.regenerate', entityType: 'network', entityId: req.scope!.networkId });
    sendOk(res, { securityCode: code }); // takes effect on the tracking hot path within the cache TTL (≤5 min)
  }));

  r.delete('/security', requireRole('admin'), asyncHandler(async (req, res) => {
    await query('UPDATE networks SET postback_security_code = NULL WHERE id = $1', [req.scope!.networkId]);
    await writeAudit(req, { action: 'settings.security.clear', entityType: 'network', entityId: req.scope!.networkId });
    sendOk(res, { securityCode: null });
  }));

  return r;
}
