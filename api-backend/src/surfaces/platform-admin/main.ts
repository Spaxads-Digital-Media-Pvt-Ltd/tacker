import { env } from '../../config/env.js';
import { serve } from '../../lib/http/serve.js';
import { buildPlatformAdminApp } from './app.js';

const app = buildPlatformAdminApp();
serve(app, env.PORT_PLATFORM_ADMIN, 'platform-admin');
