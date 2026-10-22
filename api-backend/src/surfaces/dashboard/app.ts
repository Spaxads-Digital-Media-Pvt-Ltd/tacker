/**
 * Dashboard API surface (spec §2.1 #2) — what the `frontend` repo calls.
 * Auth: Supabase JWT + RBAC (./auth). Route tree is distinct from all other surfaces.
 *
 * Layout:
 *   /api/me                     — any authenticated dashboard user
 *   /api/<entity>               — admin-only, RBAC-gated CRUD (network-scoped)
 *   /api/portal/<kind>/...      — publisher/advertiser portal, owner-scoped self-reads
 *   /api/auth, /api/signup      — unauthenticated: login/refresh/logout, partner sign-up
 */
import express, { Router, type Express } from 'express';
import { z } from 'zod';
import cookieParser from 'cookie-parser';
import { createBaseApp, finalizeApp } from '../../lib/http/express-app.js';
import { sendOk } from '../../lib/http/envelope.js';
import { warnIfCapped } from '../../lib/http/list-cap.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { validateBody } from '../../lib/http/validate.js';
import { badRequest, conflict, notFound } from '../../lib/http/errors.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';
import { query } from '../../lib/db/pool.js';
import { dashboardAuth, requireAdmin, requireRole, requirePortal, notWhileImpersonating } from './auth.js';
import { auditImpersonatedWrites } from '../../lib/audit.js';
import { passwordSchema } from '../../lib/auth/password-policy.js';
import { ownerIdOf } from '../../lib/db/from-request.js';
import { apiKeyManagementRoutes } from './api-keys/routes.js';
import { authRoutes, respondWithSession, LOGIN_TIMEOUT_MS } from './auth-routes.js';
import { withTimeout } from '../../lib/timeout.js';
import { logger } from '../../lib/logger.js';
import { advertisersAdminRoutes, advertiserPortalRoutes } from './advertisers/routes.js';
import { publishersAdminRoutes, publisherPortalRoutes } from './publishers/routes.js';
import { offersAdminRoutes, offerPortalRoutes } from './offers/routes.js';
import { trackingDomainsAdminRoutes } from './tracking-domains/routes.js';
import { subscriptionRoutes } from './subscription/routes.js';
import { supportTenantRoutes } from './support/routes.js';
import { featuresFor, requireFeature } from '../../lib/platform/flags.js';
import { announcementsFor } from '../../lib/platform/announcements.js';
import { financeRoutes } from './finance/routes.js';
import { adminReportsRoutes } from './reports/routes.js';
import { alertsRoutes, fraudRulesRoutes } from './alerts/routes.js';
import { aiRoutes } from './ai/routes.js';
import { tagsRoutes } from './tags/routes.js';
import { customFieldRoutes } from './custom-fields/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { smartLinksRoutes } from './smart-links/routes.js';
import { savedReportsRoutes } from './saved-reports/routes.js';
import { reportRequestsRoutes } from './report-requests/routes.js';
import { offlineRoutes } from './offline/routes.js';
import { importExportRoutes } from './import-export/routes.js';
import { catalogRoutes, invoiceRoutes } from './catalog/routes.js';
import { offerTemplatesRoutes } from './offer-templates/routes.js';
import { offerGroupsRoutes } from './offer-groups/routes.js';
import { creativesRoutes } from './creatives/routes.js';
import { customMetricsRoutes } from './custom-metrics/routes.js';
import { conversionImportsRoutes } from './conversion-imports/routes.js';
import { marketplaceProfileRoutes } from './marketplace-profile/routes.js';
import { communicationHubRoutes } from './communication-hub/routes.js';
import { customerValueRoutes } from './customer-value/routes.js';
import { trafficHealthRoutes } from './traffic-health/routes.js';
import { investigatorRoutes } from './investigator/routes.js';
import { automationRoutes } from './automation/routes.js';
import { auditLogRoutes } from './audit-log/routes.js';
import { trafficControlsRoutes } from './traffic-controls/routes.js';
import { offerCustomSettingsRoutes } from './offer-custom-settings/routes.js';
import { smartSwitchRoutes } from './smartswitch/routes.js';
import { usersRoutes } from './users/routes.js';
import { postbacksRoutes } from './postbacks/routes.js';
import { partnerTiersRoutes } from './partner-tiers/routes.js';
import { offerApplicationsRoutes } from './offer-applications/routes.js';
import { questionnairesRoutes } from './questionnaires/routes.js';
import { trafficBlockingRoutes } from './traffic-blocking/routes.js';
import { trafficSourcesRoutes } from './traffic-sources/routes.js';
import { reportingAdjustmentsRoutes } from './reporting-adjustments/routes.js';
import { couponCodesRoutes } from './coupon-codes/routes.js';
import { partnerInvoicesRoutes } from './partner-invoices/routes.js';
import { linkTemplatesRoutes } from './link-templates/routes.js';
import { postbackControlsRoutes } from './postback-controls/routes.js';
import { advertiserInvoicesRoutes } from './advertiser-invoices/routes.js';
import { tieredCommissionsRoutes } from './tiered-commissions/routes.js';
import { controlCenterRoutes } from './control-center/routes.js';
import { signupRoutes } from './signup/routes.js';
import { whiteLabelRoutes, publicBrandRoutes } from './white-label/routes.js';
import { helpRoutes, publicStatusRoutes } from './help/routes.js';
import { publicQuoteRoutes } from './quotes/routes.js';
import { networkTimeZone } from '../../lib/reporting/network-zone.js';
import { IMAGE_MAX_BYTES, IMAGE_UPLOAD_CONTENT_TYPES, assertImageValue, imageTypesFor, imageTypesText, uploadContentType, uploadImage } from '../../lib/storage/images.js';
import { networkBranding } from './control-center/config.js';

export function buildDashboardApp(): Express {
  const app = createBaseApp('dashboard');
  app.use(cookieParser());

  // Unauthenticated auth exchange (login/refresh/logout) and partner self-serve sign-up (F-04).
  // Everything else requires an identity.
  app.use('/api/auth', authRoutes());
  app.use('/api/signup', signupRoutes());
  app.use('/api/public', publicBrandRoutes());
  app.use('/api/public', publicStatusRoutes());
  app.use('/api/public', publicQuoteRoutes());

  const authed = Router();
  authed.use(dashboardAuth);
  // Writes made while an admin impersonates a portal account are audited to that admin (F-10).
  authed.use(auditImpersonatedWrites);

  // `impersonation` is set while an admin is impersonating this portal account (F-10) — the SPA
  // shows a persistent "impersonating" banner from it.
  authed.get('/me', asyncHandler(async (req, res) => {
    const id = req.identity;
    let impersonation: { impersonatedBy: string; adminEmail: string | null; account: string | null; expiresAt: number; support?: true } | null = null;
    if (id && id.surface === 'dashboard' && id.kind !== 'admin' && id.impersonatedBy) {
      const [admin, account] = await Promise.all([
        // The network admin who started it — or a Super Admin, when started from a support session.
        query<{ email: string | null }>(
          `SELECT COALESCE((SELECT email FROM users WHERE network_id = $1 AND auth_user_id::text = $2 LIMIT 1),
                           (SELECT email FROM platform_admins WHERE id::text = $2)) AS email`, [id.networkId, id.impersonatedBy]),
        query<{ name: string }>(`SELECT name FROM ${id.kind === 'publisher' ? 'publishers' : 'advertisers'} WHERE network_id = $1 AND id = $2`, [id.networkId, id.ownerId]),
      ]);
      impersonation = {
        impersonatedBy: id.impersonatedBy, adminEmail: admin.rows[0]?.email ?? null,
        account: account.rows[0]?.name ?? null, expiresAt: id.impersonationExpiresAt ?? 0,
      };
    } else if (id && id.surface === 'dashboard' && id.kind === 'admin' && id.platformSupport) {
      // A Super Admin support session: whose network this is, and which Super Admin is in it.
      const [admin, net] = await Promise.all([
        query<{ email: string }>('SELECT email FROM platform_admins WHERE id::text = $1', [id.userId]),
        query<{ name: string }>('SELECT name FROM networks WHERE id = $1', [id.networkId]),
      ]);
      impersonation = {
        impersonatedBy: id.userId, adminEmail: admin.rows[0]?.email ?? null,
        account: net.rows[0]?.name ?? null, expiresAt: id.impersonationExpiresAt ?? 0, support: true,
      };
    }
    // D7: the network's report time zone — every report page (staff and portals) defaults to it.
    // O12: its branding images (stored URLs) — the shell shows the logo and favicon to everyone.
    const nid = req.scope?.networkId;
    const [reportTimeZone, branding] = nid
      ? await Promise.all([networkTimeZone(nid), networkBranding(nid)])
      : ['UTC', { logoUrl: null, faviconUrl: null }];
    // Staff see their network's oldest overdue platform invoice (the shell warns before a suspension).
    const overdue = nid && id && id.surface === 'dashboard' && id.kind === 'admin'
      ? (await query<{ id: string; number: string; total: string; currency: string; due_at: Date; suspend_at: Date }>(
        `SELECT id, number, total, currency, due_at, suspend_at FROM platform_invoices
          WHERE network_id = $1 AND status = 'open' AND due_at <= now() ORDER BY due_at LIMIT 1`, [nid])).rows[0] ?? null
      : null;
    // Feature flags (Super Admin › Feature flags: keys without a flag are on) and announcements for this person.
    const kind = id && id.surface === 'dashboard' ? id.kind : null;
    const [features, announcements] = nid && kind
      ? await Promise.all([featuresFor(nid), announcementsFor(nid, kind, id!.surface === 'dashboard' ? id!.userId : '')])
      : [{}, []];
    sendOk(res, { identity: id, scope: req.scope, impersonating: impersonation !== null, impersonation, reportTimeZone, branding, billing: { overdue }, features, announcements });
  }));

  // Dismiss an announcement (a dismissible one this person can see) — it stays hidden for them.
  authed.post('/announcements/:id/dismiss', asyncHandler(async (req, res) => {
    const id = req.identity;
    const aid = req.params['id'] ?? '';
    if (!id || id.surface !== 'dashboard' || !/^[0-9a-f-]{36}$/i.test(aid)) throw notFound('Announcement not found');
    const visible = (await announcementsFor(id.networkId, id.kind, id.userId)).find((a) => a.id === aid);
    if (!visible) throw notFound('Announcement not found');
    if (!visible.dismissible) throw conflict('This announcement can’t be dismissed.');
    await query(`INSERT INTO platform_announcement_dismissals (announcement_id, user_key, network_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [aid, id.userId, id.networkId]);
    sendOk(res, { dismissed: true });
  }));

  // My Account (Profile) General tab — this user's own real row + metadata profile fields.
  authed.get('/me/account', asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
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
    const raw = u.metadata;
    const meta = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })() : (raw ?? {});
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

  // Per-user UI accent theme (Section 6). Any authenticated dashboard user; persisted in the
  // Supabase user_metadata (the frontend never writes it directly — Option A).
  const themeSchema = z.object({ theme: z.enum(['A', 'B', 'C', 'D', 'E', 'F']) });
  authed.patch('/me/theme', validateBody(themeSchema), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, { theme: 'A' });
    const { theme } = req.body as z.infer<typeof themeSchema>;
    const sb = getSupabaseAdmin();
    const { data } = await sb.auth.admin.getUserById(userId);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    await sb.auth.admin.updateUserById(userId, { user_metadata: { ...meta, theme } });
    sendOk(res, { theme });
  }));

  // Profile photo upload (O12): the raw image (≤ 2 MB; PNG / JPEG / WebP / GIF) → object storage → its
  // URL, which the profile form then saves as photoUrl.
  authed.post('/me/photo', notWhileImpersonating(), express.raw({ type: IMAGE_UPLOAD_CONTENT_TYPES, limit: IMAGE_MAX_BYTES }), asyncHandler(async (req, res) => {
    const type = uploadContentType(req.headers['content-type']);
    if (!imageTypesFor('photo')[type] || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest(`Upload a ${imageTypesText('photo')} image up to 2 MB`);
    }
    let url: string;
    try {
      url = await uploadImage(req.scope!.networkId, 'photo', req.body, type);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Upload failed');
    }
    sendOk(res, { url }, undefined, 201);
  }));

  const profilePatchSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    title: z.string().max(120).optional().nullable(),
    businessUnit: z.string().max(120).optional().nullable(),
    language: z.string().max(40).optional().nullable(),
    timezone: z.string().max(80).optional().nullable(),
    // O12: the URL of a photo uploaded with POST /api/me/photo (checked below) — never the file itself.
    photoUrl: z.string().max(2000).optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
    address: z.string().max(200).optional().nullable(),
    apartment: z.string().max(120).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    region: z.string().max(120).optional().nullable(),
    country: z.string().max(120).optional().nullable(),
    postalCode: z.string().max(40).optional().nullable(),
  });

  // Update own profile (name + metadata contact/prefs). Writes users.name + users.metadata.
  authed.patch('/me/profile', validateBody(profilePatchSchema), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, {});
    const b = req.body as z.infer<typeof profilePatchSchema>;
    const { rows } = await query<{ metadata: Record<string, unknown> | string }>(
      'SELECT metadata FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope!.networkId],
    );
    if (!rows[0]) return sendOk(res, {});
    const raw = rows[0].metadata;
    const meta = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })() : { ...(raw ?? {}) };
    if (b.title !== undefined) meta['title'] = b.title;
    if (b.businessUnit !== undefined) meta['businessUnit'] = b.businessUnit;
    if (b.language !== undefined) meta['language'] = b.language;
    if (b.timezone !== undefined) meta['timezone'] = b.timezone;
    if (b.photoUrl !== undefined) { assertImageValue(b.photoUrl, meta['photoUrl'], 'photoUrl'); meta['photoUrl'] = b.photoUrl; }
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

  // Change own password (Profile → Change password, and the first sign-in with an invite's temporary
  // password: this also clears `must_change_password`, O1). Supabase ends EVERY session of a login whose
  // password changes (its refresh tokens are revoked), so the new password signs in again here and the
  // answer is that fresh session — access token + refresh cookie, as from /api/auth/login — keeping this
  // tab signed in. Should that sign-in fail, the change still stands: `{ ok: true }`, sign in again.
  authed.patch('/me/password', notWhileImpersonating(), validateBody(z.object({ password: passwordSchema })), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, { ok: false });
    const { password } = req.body as { password: string };
    const sb = getSupabaseAdmin();
    const { data: updated, error } = await sb.auth.admin.updateUserById(userId, {
      password,
      app_metadata: { must_change_password: false },
    });
    if (error) throw badRequest(error.message);
    const email = updated.user?.email;
    const fresh = email
      ? await withTimeout(sb.auth.signInWithPassword({ email, password }), LOGIN_TIMEOUT_MS, 'Sign-in with the new password timed out.')
        .catch((err: unknown) => ({ data: { session: null, user: null }, error: err }))
      : null;
    if (!email || !fresh?.data.session || !fresh.data.user) {
      logger.warn({ userId, err: fresh?.error }, 'password changed, but signing in with it failed — the user signs in again');
      return sendOk(res, { ok: true });
    }
    respondWithSession(res, fresh.data.session, fresh.data.user, email);
  }));

  // Change own login email (auth + users row).
  authed.patch('/me/email', notWhileImpersonating(), validateBody(z.object({ email: z.string().email().max(200) })), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, { ok: false });
    const email = (req.body as { email: string }).email.trim().toLowerCase();
    const sb = getSupabaseAdmin();
    const { error } = await sb.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) throw badRequest(error.message);
    await query('UPDATE users SET email = $3 WHERE auth_user_id = $1 AND network_id = $2', [userId, req.scope!.networkId, email]);
    sendOk(res, { ok: true, email });
  }));

  // Own login history (Control Center › Security › Logins filtered to this user).
  authed.get('/me/logins', asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId || !req.scope?.networkId) return sendOk(res, []);
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, ip, country, city, user_agent, platform, device_type, os_version, browser, existing_device, created_at
       FROM login_events
       WHERE network_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.scope.networkId, userId],
    );
    // Recent-activity log — intentionally bounded to the newest 200 logins.
    warnIfCapped(rows, 200, 'me.logins');
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
  authed.post('/me/anonymize', notWhileImpersonating(), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
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
  authed.get('/me/notifications', asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, { preferences: {} });
    const { rows } = await query<{ metadata: Record<string, unknown> | string }>(
      'SELECT metadata FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope!.networkId],
    );
    const raw = rows[0]?.metadata;
    const meta = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })() : (raw ?? {});
    const preferences = (meta['notifications'] as Record<string, unknown> | undefined) ?? {};
    sendOk(res, { preferences });
  }));

  authed.put(
    '/me/notifications',
    validateBody(z.object({
      preferences: z.record(z.string(), z.record(z.string(), z.object({
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
        scope: z.string().optional(),
      }).passthrough())),
    })),
    asyncHandler(async (req, res) => {
      const userId = (req.identity as { userId?: string }).userId;
      if (!userId) return sendOk(res, { preferences: {} });
      const patch = (req.body as { preferences: Record<string, unknown> }).preferences;
      const { rows } = await query<{ metadata: Record<string, unknown> | string }>(
        'SELECT metadata FROM users WHERE auth_user_id = $1 AND network_id = $2',
        [userId, req.scope!.networkId],
      );
      if (!rows[0]) return sendOk(res, { preferences: {} });
      const raw = rows[0].metadata;
      const meta = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })() : { ...(raw ?? {}) };
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

  // The network's plan and its bill: staff only — never a partner / advertiser portal.
  authed.use('/subscription', requireAdmin, subscriptionRoutes());
  authed.use('/support', requireAdmin, supportTenantRoutes());

  // Admin-only, network-scoped CRUD.
  authed.use('/advertisers', requireAdmin, advertisersAdminRoutes());
  authed.use('/publishers', requireAdmin, publishersAdminRoutes());
  authed.use('/offers', requireAdmin, offersAdminRoutes());
  authed.use('/tracking-domains', requireAdmin, trackingDomainsAdminRoutes());
  authed.use('/finance', requireAdmin, financeRoutes());
  authed.use('/reports', requireAdmin, adminReportsRoutes());
  authed.use('/alerts', requireAdmin, alertsRoutes());
  authed.use('/fraud-rules', requireAdmin, fraudRulesRoutes());
  authed.use('/ai', requireAdmin, requireFeature('ai_assistant'), aiRoutes());
  authed.use('/tags', requireAdmin, tagsRoutes());
  authed.use('/custom-fields', requireAdmin, customFieldRoutes());
  authed.use('/settings', requireAdmin, settingsRoutes());
  authed.use('/smart-links', requireAdmin, smartLinksRoutes());
  authed.use('/saved-reports', requireAdmin, savedReportsRoutes());
  authed.use('/report-requests', requireAdmin, reportRequestsRoutes());
  authed.use('/white-label', requireAdmin, whiteLabelRoutes());
  authed.use('/help', helpRoutes());
  authed.use('/offline', requireAdmin, offlineRoutes());
  authed.use('/import-export', requireAdmin, importExportRoutes());
  authed.use('/catalog', requireAdmin, catalogRoutes());
  authed.use('/invoices', requireAdmin, invoiceRoutes());
  authed.use('/offer-templates', requireAdmin, offerTemplatesRoutes());
  authed.use('/offer-groups', requireAdmin, offerGroupsRoutes());
  authed.use('/creatives', requireAdmin, creativesRoutes());
  authed.use('/custom-metrics', requireAdmin, customMetricsRoutes());
  authed.use('/marketplace-profile', requireAdmin, requireFeature('marketplace'), marketplaceProfileRoutes());
  authed.use('/communication-hub', requireAdmin, communicationHubRoutes());
  authed.use('/customer-value', requireAdmin, customerValueRoutes());
  authed.use('/traffic-health', requireAdmin, requireFeature('traffic_health'), trafficHealthRoutes());
  authed.use('/investigator', requireAdmin, requireFeature('fraud_investigator'), investigatorRoutes());
  authed.use('/automation', requireAdmin, requireFeature('automation'), automationRoutes());
  authed.use('/audit-log', requireAdmin, auditLogRoutes());
  authed.use('/conversion-imports', requireAdmin, conversionImportsRoutes());
  authed.use('/traffic-controls', requireAdmin, trafficControlsRoutes());
  authed.use('/offer-custom-settings', requireAdmin, offerCustomSettingsRoutes());
  authed.use('/smartswitch', requireAdmin, requireFeature('smartswitch'), smartSwitchRoutes());
  authed.use('/users', requireAdmin, usersRoutes());
  authed.use('/postbacks', requireAdmin, postbacksRoutes());
  authed.use('/partner-tiers', requireAdmin, partnerTiersRoutes());
  authed.use('/offer-applications', requireAdmin, offerApplicationsRoutes());
  authed.use('/questionnaires', requireAdmin, questionnairesRoutes());
  authed.use('/traffic-blocking', requireAdmin, trafficBlockingRoutes());
  authed.use('/traffic-sources', requireAdmin, trafficSourcesRoutes());
  authed.use('/reporting-adjustments', requireAdmin, reportingAdjustmentsRoutes());
  authed.use('/coupon-codes', requireAdmin, couponCodesRoutes());
  authed.use('/partner-invoices', requireAdmin, partnerInvoicesRoutes());
  authed.use('/link-templates', requireAdmin, linkTemplatesRoutes());
  authed.use('/postback-controls', requireAdmin, postbackControlsRoutes());
  authed.use('/advertiser-invoices', requireAdmin, advertiserInvoicesRoutes());
  authed.use('/tiered-commissions', requireAdmin, tieredCommissionsRoutes());
  authed.use('/control-center', requireAdmin, controlCenterRoutes());

  // API key management (spec §8A) — humans mint keys; their code uses them on the Public REST API.
  const adminUserId = (req: import('express').Request): string =>
    req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : '';
  authed.use('/keys', requireAdmin, requireRole('admin'), apiKeyManagementRoutes('network', adminUserId));
  // Minting/revoking keys while impersonating would hand out credentials that outlive the session (F-10).
  authed.use('/portal/publisher/keys', requirePortal('publisher'), notWhileImpersonating({ writesOnly: true }), apiKeyManagementRoutes('publisher', ownerIdOf));
  authed.use('/portal/advertiser/keys', requirePortal('advertiser'), notWhileImpersonating({ writesOnly: true }), apiKeyManagementRoutes('advertiser', ownerIdOf));

  // Owner-scoped portals (guards enforced per-route inside).
  authed.use('/portal/advertiser', advertiserPortalRoutes());
  authed.use('/portal/publisher', publisherPortalRoutes());
  authed.use('/portal/offers', offerPortalRoutes());

  app.use('/api', authed);

  finalizeApp(app);
  return app;
}
