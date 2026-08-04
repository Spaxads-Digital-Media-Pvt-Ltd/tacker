import { env } from '../../config/env.js';
import { serve } from '../../lib/http/serve.js';
import { buildDashboardApp } from './app.js';

serve(buildDashboardApp(), env.PORT_DASHBOARD, 'dashboard');
