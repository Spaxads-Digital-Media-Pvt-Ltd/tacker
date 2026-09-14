import { env } from '../../config/env.js';
import { serve } from '../../lib/http/serve.js';
import { buildPlatformAdminApp } from './app.js';
import { mountHealthRoutes } from '../../lib/http/health.js';

const app = buildPlatformAdminApp();
mountHealthRoutes(app, 'platform-admin');
serve(app, env.PORT_PLATFORM_ADMIN, 'platform-admin');
