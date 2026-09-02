/**
 * Dashboard API surface (spec §2.1 #2) — what the `frontend` repo calls.
 * Auth: Supabase JWT + RBAC (./auth). Route tree is distinct from all other surfaces.
 *
 * Layout:
 *   /api/me                     — any authenticated dashboard user
 *   /api/<entity>               — admin-only, RBAC-gated CRUD (network-scoped)
 *   /api/portal/<kind>/...      — publisher/advertiser portal, owner-scoped self-reads
 */
import { Router, type Express } from 'express';
import { z } from 'zod';
import cookieParser from 'cookie-parser';
import { createBaseApp, finalizeApp } from '../../lib/http/express-app.js';
import { sendOk } from '../../lib/http/envelope.js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { validateBody } from '../../lib/http/validate.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';
import { query } from '../../lib/db/pool.js';
import { dashboardAuth, requireAdmin, requireRole, requirePortal } from './auth.js';
import { ownerIdOf } from '../../lib/db/from-request.js';
import { apiKeyManagementRoutes } from './api-keys/routes.js';
import { authRoutes } from './auth-routes.js';
import { advertisersAdminRoutes, advertiserPortalRoutes } from './advertisers/routes.js';
import { publishersAdminRoutes, publisherPortalRoutes } from './publishers/routes.js';
import { offersAdminRoutes, offerPortalRoutes } from './offers/routes.js';
import { trackingDomainsAdminRoutes } from './tracking-domains/routes.js';
import { subscriptionRoutes } from './subscription/routes.js';
import { financeRoutes } from './finance/routes.js';
import { adminReportsRoutes } from './reports/routes.js';
import { alertsRoutes, fraudRulesRoutes } from './alerts/routes.js';
import { aiRoutes } from './ai/routes.js';
import { tagsRoutes } from './tags/routes.js';
import { customFieldRoutes } from './custom-fields/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { smartLinksRoutes } from './smart-links/routes.js';
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

export function buildDashboardApp(): Express {
  const app = createBaseApp('dashboard');
  app.use(cookieParser());

  // Unauthenticated auth exchange (login/refresh/logout). Everything else requires an identity.
  app.use('/api/auth', authRoutes());

  const authed = Router();
  authed.use(dashboardAuth);

  authed.get('/me', (req, res) => sendOk(res, { identity: req.identity, scope: req.scope }));

  // My Account (Profile) General tab — this user's own real row (ref/name/email/role/status/
  // created/modified), not the network-wide /api/users list.
  authed.get('/me/account', asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, null);
    const { rows } = await query<{ ref: string; name: string | null; email: string; role: string; status: string; created_at: string; updated_at: string }>(
      'SELECT ref, name, email, role, status, created_at, updated_at FROM users WHERE auth_user_id = $1 AND network_id = $2',
      [userId, req.scope!.networkId],
    );
    const u = rows[0];
    sendOk(res, u ? {
      ref: Number(u.ref), name: u.name ?? u.email, email: u.email, role: u.role, status: u.status,
      createdAt: u.created_at, updatedAt: u.updated_at,
    } : null);
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

  // Update own display name (Profile → Edit profile). Writes user_metadata.name + public.users.name.
  authed.patch('/me/profile', validateBody(z.object({ name: z.string().min(1).max(120) })), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, {});
    const { name } = req.body as { name: string };
    const sb = getSupabaseAdmin();
    const { data } = await sb.auth.admin.getUserById(userId);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    await sb.auth.admin.updateUserById(userId, { user_metadata: { ...meta, name } });
    await query('UPDATE users SET name = $2 WHERE auth_user_id = $1', [userId, name]);
    sendOk(res, { name });
  }));

  // Change own password (Profile → Change password).
  authed.patch('/me/password', validateBody(z.object({ password: z.string().min(8).max(200) })), asyncHandler(async (req, res) => {
    const userId = (req.identity as { userId?: string }).userId;
    if (!userId) return sendOk(res, { ok: false });
    await getSupabaseAdmin().auth.admin.updateUserById(userId, { password: (req.body as { password: string }).password });
    sendOk(res, { ok: true });
  }));

  authed.use('/subscription', subscriptionRoutes());

  // Admin-only, network-scoped CRUD.
  authed.use('/advertisers', requireAdmin, advertisersAdminRoutes());
  authed.use('/publishers', requireAdmin, publishersAdminRoutes());
  authed.use('/offers', requireAdmin, offersAdminRoutes());
  authed.use('/tracking-domains', requireAdmin, trackingDomainsAdminRoutes());
  authed.use('/finance', requireAdmin, financeRoutes());
  authed.use('/reports', requireAdmin, adminReportsRoutes());
  authed.use('/alerts', requireAdmin, alertsRoutes());
  authed.use('/fraud-rules', requireAdmin, fraudRulesRoutes());
  authed.use('/ai', requireAdmin, aiRoutes());
  authed.use('/tags', requireAdmin, tagsRoutes());
  authed.use('/custom-fields', requireAdmin, customFieldRoutes());
  authed.use('/settings', requireAdmin, settingsRoutes());
  authed.use('/smart-links', requireAdmin, smartLinksRoutes());
  authed.use('/offline', requireAdmin, offlineRoutes());
  authed.use('/import-export', requireAdmin, importExportRoutes());
  authed.use('/catalog', requireAdmin, catalogRoutes());
  authed.use('/invoices', requireAdmin, invoiceRoutes());
  authed.use('/offer-templates', requireAdmin, offerTemplatesRoutes());
  authed.use('/offer-groups', requireAdmin, offerGroupsRoutes());
  authed.use('/creatives', requireAdmin, creativesRoutes());
  authed.use('/custom-metrics', requireAdmin, customMetricsRoutes());
  authed.use('/marketplace-profile', requireAdmin, marketplaceProfileRoutes());
  authed.use('/communication-hub', requireAdmin, communicationHubRoutes());
  authed.use('/customer-value', requireAdmin, customerValueRoutes());
  authed.use('/traffic-health', requireAdmin, trafficHealthRoutes());
  authed.use('/audit-log', requireAdmin, auditLogRoutes());
  authed.use('/conversion-imports', requireAdmin, conversionImportsRoutes());
  authed.use('/traffic-controls', requireAdmin, trafficControlsRoutes());
  authed.use('/offer-custom-settings', requireAdmin, offerCustomSettingsRoutes());
  authed.use('/smartswitch', requireAdmin, smartSwitchRoutes());
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

  // API key management (spec §8A) — humans mint keys; their code uses them on the Public REST API.
  const adminUserId = (req: import('express').Request): string =>
    req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : '';
  authed.use('/keys', requireAdmin, requireRole('admin'), apiKeyManagementRoutes('network', adminUserId));
  authed.use('/portal/publisher/keys', requirePortal('publisher'), apiKeyManagementRoutes('publisher', ownerIdOf));
  authed.use('/portal/advertiser/keys', requirePortal('advertiser'), apiKeyManagementRoutes('advertiser', ownerIdOf));

  // Owner-scoped portals (guards enforced per-route inside).
  authed.use('/portal/advertiser', advertiserPortalRoutes());
  authed.use('/portal/publisher', publisherPortalRoutes());
  authed.use('/portal/offers', offerPortalRoutes());

  app.use('/api', authed);

  finalizeApp(app);
  return app;
}
