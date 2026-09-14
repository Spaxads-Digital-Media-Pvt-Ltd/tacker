import { env } from '../../config/env.js';
import { installReportingProvider } from '../../lib/reporting/clickhouse.js';
import { serve } from '../../lib/http/serve.js';
import { buildDashboardApp } from './app.js';
import { mountHealthRoutes } from '../../lib/http/health.js';

installReportingProvider();

const app = buildDashboardApp();
mountHealthRoutes(app, 'dashboard');
serve(app, env.PORT_DASHBOARD, 'dashboard');
