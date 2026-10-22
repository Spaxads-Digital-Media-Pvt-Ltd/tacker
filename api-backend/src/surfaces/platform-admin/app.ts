/**
 * Platform-admin (Super Admin) surface (spec §3C) — the fifth surface, above all tenants.
 * Own namespace (/platform/*), own auth gate (./auth), audited. Regular tenant users can never
 * reach here (non-negotiable #12).
 */
import { Router, type Express } from 'express';
import { createBaseApp, finalizeApp } from '../../lib/http/express-app.js';
import { platformAdminAuth } from './auth.js';
import { platformRoutes, publicPlatformRoutes } from './routes.js';
import { billingRoutes } from './billing-routes.js';
import { opsRoutes } from './ops-routes.js';
import { salesRoutes } from './sales-routes.js';
import { taskRoutes } from './task-routes.js';
import { successRoutes } from './success-routes.js';
import { supportRoutes } from './support-routes.js';
import { revenueRoutes } from './revenue-routes.js';
import { flagsRoutes } from './flags-routes.js';
import { systemRoutes } from './system-routes.js';
import { trustRoutes } from './trust-routes.js';
import { emailRoutes } from './email-routes.js';
import { resellerRoutes } from './reseller-routes.js';

export function buildPlatformAdminApp(): Express {
 const app = createBaseApp('platform-admin');

 // Public (unauthenticated) routes — login only.
 app.use('/platform', publicPlatformRoutes());

 // Authenticated platform-admin routes.
 const authed = Router();
 authed.use(platformAdminAuth);
 authed.use('/', platformRoutes());
 authed.use('/', billingRoutes());
 authed.use('/', opsRoutes());
 authed.use('/', salesRoutes());
 authed.use('/', taskRoutes());
 authed.use('/', successRoutes());
 authed.use('/', supportRoutes());
 authed.use('/', revenueRoutes());
 authed.use('/', flagsRoutes());
 authed.use('/', systemRoutes());
 authed.use('/', trustRoutes());
 authed.use('/', emailRoutes());
 authed.use('/', resellerRoutes());

 app.use('/platform', authed);

 finalizeApp(app);
 return app;
}
