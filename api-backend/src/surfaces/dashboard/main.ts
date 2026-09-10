import { env } from '../../config/env.js';
import { installReportingProvider } from '../../lib/reporting/clickhouse.js';
import { serve } from '../../lib/http/serve.js';
import { buildDashboardApp } from './app.js';

installReportingProvider();

serve(buildDashboardApp(), env.PORT_DASHBOARD, 'dashboard');
