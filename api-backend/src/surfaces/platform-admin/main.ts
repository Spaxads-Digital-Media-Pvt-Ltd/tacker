import { env } from '../../config/env.js';
import { serve } from '../../lib/http/serve.js';
import { buildPlatformAdminApp } from './app.js';

serve(buildPlatformAdminApp(), env.PORT_PLATFORM_ADMIN, 'platform-admin');
