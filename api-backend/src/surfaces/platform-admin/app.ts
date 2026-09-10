/**
 * Platform-admin (Super Admin) surface (spec §3C) — the fifth surface, above all tenants.
 * Own namespace (/platform/*), own auth gate (./auth), audited. Regular tenant users can never
 * reach here (non-negotiable #12).
 */
import { Router, type Express } from 'express';
import { createBaseApp, finalizeApp } from '../../lib/http/express-app.js';
import { sendOk } from '../../lib/http/envelope.js';
import { platformAdminAuth } from './auth.js';
import { platformRoutes, publicPlatformRoutes } from './routes.js';

export function buildPlatformAdminApp(): Express {
 const app = createBaseApp('platform-admin');

 // Public (unauthenticated) routes — login only.
 app.use('/platform', publicPlatformRoutes());

 // Authenticated platform-admin routes.
 const authed = Router();
 authed.use(platformAdminAuth);
 authed.get('/me', (req, res) => sendOk(res, { identity: req.identity }));
 authed.use('/', platformRoutes());

 app.use('/platform', authed);

 finalizeApp(app);
 return app;
}
