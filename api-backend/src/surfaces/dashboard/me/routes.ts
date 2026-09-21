/**
 * /me/* routes — authenticated user's own profile, account, settings, and preferences.
 * Extracted from dashboard/app.ts for maintainability. Every handler here operates on the
 * CALLING user's own data only (userId from the verified JWT); no admin-escalation needed.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { badRequest } from '../../../lib/http/errors.js';
import { getSupabaseAdmin } from '../../../lib/supabase.js';
import { query } from '../../../lib/db/pool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse JSON metadata that may arrive as a string or object from Postgres. */
function parseMeta(raw: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return { ...raw };
}

/** Extract userId from the identity attached by dashboardAuth. */
function userIdFrom(req: import('express').Request): string | null {
  return (req.identity as { userId?: string } | undefined)?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const themeSchema = z.object({ theme: z.enum(['A', 'B', 'C', 'D', 'E', 'F']) });

const profilePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  title: z.string().max(120).optional().nullable(),
  businessUnit: z.string().max(120).optional().nullable(),
  language: z.string().max(40).optional().nullable(),
  timezone: z.string().max(80).optional().nullable(),
  photoUrl: z.string().max(6_000_000).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  apartment: z.string().max(120).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  country: z.string().max(120).optional().nullable(),
  postalCode: z.string().max(40).optional().nullable(),
});

const notificationsSchema = z.object({
  preferences: z.record(z.string(), z.record(z.string(), z.object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    scope: z.string().optional(),
  }).passthrough())),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function meRoutes(): Router {
  const r = Router();

  // Identity + scope snapshot (lightweight "who am I?").
  r.get('/', (req, res) => sendOk(res, { identity: req.identity, scope: req.scope }));

  // My Account (Profile) General tab — this user's own real row + metadata profile fields.
  r.get('/account', asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId) return sendOk(res, null);
    const { rows } = await query<{
      id: string; ref: string; name: string | null; email: string; role: string; status: string;
      metadata: Record<string, unknown> | string; created_at: string; updated_at: string;
    }>(
      'SELECT id, ref, name, email, role, status, metadata, created_at, updated_at FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope!.networkId],
    );
    const u = rows[0];
    if (!u) return sendOk(res, null);
    const meta = parseMeta(u.metadata);
    sendOk(res, {
      id: u.id,
      ref: Number(u.ref),
      name: u.name ?? u.email,
      email: u.email,
      role: u.role,
      status: u.status,
      title: (meta['title'] as string) ?? null,
      businessUnit: (meta['businessUnit'] as string) ?? null,
      partnerManager: Boolean(meta['partnerManager']),
      advertiserManager: Boolean(meta['advertiserManager']),
      language: (meta['language'] as string) ?? 'English',
      timezone: (meta['timezone'] as string) ?? null,
      photoUrl: (meta['photoUrl'] as string) ?? null,
      phone: (meta['primaryPhone'] as string) ?? (meta['phone'] as string) ?? null,
      address: (meta['address'] as string) ?? null,
      apartment: (meta['apartment'] as string) ?? null,
      city: (meta['city'] as string) ?? null,
      region: (meta['region'] as string) ?? null,
      country: (meta['country'] as string) ?? null,
      postalCode: (meta['postalCode'] as string) ?? null,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    });
  }));

  // Per-user UI accent theme (Section 6). Persisted in Supabase user_metadata.
  r.patch('/theme', validateBody(themeSchema), asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId) return sendOk(res, { theme: 'A' });
    const { theme } = req.body as z.infer<typeof themeSchema>;
    const sb = getSupabaseAdmin();
    const { data } = await sb.auth.admin.getUserById(userId);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    await sb.auth.admin.updateUserById(userId, { user_metadata: { ...meta, theme } });
    sendOk(res, { theme });
  }));

  // Update own profile (name + metadata contact/prefs). Writes users.name + users.metadata.
  r.patch('/profile', validateBody(profilePatchSchema), asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId) return sendOk(res, {});
    const b = req.body as z.infer<typeof profilePatchSchema>;
    const { rows } = await query<{ metadata: Record<string, unknown> | string }>(
      'SELECT metadata FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope!.networkId],
    );
    if (!rows[0]) return sendOk(res, {});
    const meta = parseMeta(rows[0].metadata);
    if (b.title !== undefined) meta['title'] = b.title;
    if (b.businessUnit !== undefined) meta['businessUnit'] = b.businessUnit;
    if (b.language !== undefined) meta['language'] = b.language;
    if (b.timezone !== undefined) meta['timezone'] = b.timezone;
    if (b.photoUrl !== undefined) meta['photoUrl'] = b.photoUrl;
    if (b.phone !== undefined) { meta['primaryPhone'] = b.phone; meta['phone'] = b.phone; }
    if (b.address !== undefined) meta['address'] = b.address;
    if (b.apartment !== undefined) meta['apartment'] = b.apartment;
    if (b.city !== undefined) meta['city'] = b.city;
    if (b.region !== undefined) meta['region'] = b.region;
    if (b.country !== undefined) meta['country'] = b.country;
    if (b.postalCode !== undefined) meta['postalCode'] = b.postalCode;

    if (b.name !== undefined) {
      const sb = getSupabaseAdmin();
      const { data } = await sb.auth.admin.getUserById(userId);
      const umeta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      await sb.auth.admin.updateUserById(userId, { user_metadata: { ...umeta, name: b.name } });
      await query(
        'UPDATE users SET name = $3, metadata = $4 WHERE auth_user_id = $1 AND network_id = $2',
        [userId, req.scope!.networkId, b.name, JSON.stringify(meta)],
      );
    } else {
      await query(
        'UPDATE users SET metadata = $3 WHERE auth_user_id = $1 AND network_id = $2',
        [userId, req.scope!.networkId, JSON.stringify(meta)],
      );
    }
    sendOk(res, { ok: true, name: b.name, ...b });
  }));

  // Change own password (Profile → Change password).
  r.patch('/password', validateBody(z.object({ password: z.string().min(8).max(200) })), asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId) return sendOk(res, { ok: false });
    await getSupabaseAdmin().auth.admin.updateUserById(userId, { password: (req.body as { password: string }).password });
    sendOk(res, { ok: true });
  }));

  // Change own login email (auth + users row).
  r.patch('/email', validateBody(z.object({ email: z.string().email().max(200) })), asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId) return sendOk(res, { ok: false });
    const email = (req.body as { email: string }).email.trim().toLowerCase();
    const sb = getSupabaseAdmin();
    const { error } = await sb.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) throw badRequest(error.message);
    await query('UPDATE users SET email = $3 WHERE auth_user_id = $1 AND network_id = $2', [userId, req.scope!.networkId, email]);
    sendOk(res, { ok: true, email });
  }));

  // Own login history (Control Center › Security › Logins filtered to this user).
  r.get('/logins', asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId || !req.scope?.networkId) return sendOk(res, []);
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, ip, country, city, user_agent, platform, device_type, os_version, browser, existing_device, created_at
       FROM login_events
       WHERE network_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.scope.networkId, userId],
    );
    sendOk(res, rows.map((row) => ({
      id: row['id'],
      loginTime: row['created_at'],
      ip: row['ip'],
      location: [row['city'], row['country']].filter(Boolean).join(', ') || null,
      deviceType: row['device_type'],
      browser: row['browser'],
      platform: row['platform'],
      osVersion: row['os_version'],
      userAgent: row['user_agent'],
      existingDevice: row['existing_device'],
    })));
  }));

  // GDPR-style anonymize of own personal fields (keeps business history).
  r.post('/anonymize', asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId || !req.scope?.networkId) return sendOk(res, { ok: false });
    const { rows } = await query<{ id: string }>(
      'SELECT id FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope.networkId],
    );
    const u = rows[0];
    if (!u) return sendOk(res, { ok: false });
    const anonEmail = `anonymized-${u.id.slice(0, 8)}@anonymized.local`;
    const anonName = 'Anonymized User';
    const meta = {
      title: null, businessUnit: null, language: 'English', timezone: null, photoUrl: null,
      primaryPhone: null, phone: null, address: null, apartment: null, city: null, region: null,
      country: null, postalCode: null, anonymizedAt: new Date().toISOString(),
    };
    const sb = getSupabaseAdmin();
    await sb.auth.admin.updateUserById(userId, {
      email: anonEmail,
      email_confirm: true,
      user_metadata: { name: anonName },
    });
    await query(
      'UPDATE users SET name = $3, email = $4, metadata = $5 WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope.networkId, anonName, anonEmail, JSON.stringify(meta)],
    );
    sendOk(res, { ok: true, email: anonEmail, name: anonName });
  }));

  // My Notification Preferences — per-user overrides stored on users.metadata.notifications.
  r.get('/notifications', asyncHandler(async (req, res) => {
    const userId = userIdFrom(req);
    if (!userId) return sendOk(res, { preferences: {} });
    const { rows } = await query<{ metadata: Record<string, unknown> | string }>(
      'SELECT metadata FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope!.networkId],
    );
    const raw = rows[0]?.metadata;
    const meta = parseMeta(raw);
    const preferences = (meta['notifications'] as Record<string, unknown> | undefined) ?? {};
    sendOk(res, { preferences });
  }));

  r.put(
    '/notifications',
    validateBody(notificationsSchema),
    asyncHandler(async (req, res) => {
      const userId = userIdFrom(req);
      if (!userId) return sendOk(res, { preferences: {} });
      const patch = (req.body as { preferences: Record<string, unknown> }).preferences;
      const { rows } = await query<{ metadata: Record<string, unknown> | string }>(
        'SELECT metadata FROM users WHERE auth_user_id = $1 AND network_id = $2',
        [userId, req.scope!.networkId],
      );
      if (!rows[0]) return sendOk(res, { preferences: {} });
      const meta = parseMeta(rows[0].metadata);
      const prev = (meta['notifications'] as Record<string, unknown> | undefined) ?? {};
      const next = { ...prev, ...patch };
      meta['notifications'] = next;
      await query(
        'UPDATE users SET metadata = $3 WHERE auth_user_id = $1 AND network_id = $2',
        [userId, req.scope!.networkId, JSON.stringify(meta)],
      );
      sendOk(res, { preferences: next });
    }),
  );

  return r;
}
