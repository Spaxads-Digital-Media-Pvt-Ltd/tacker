import { env } from '../../config/env.js';
import { installClickHouseReportingProvider } from '../../lib/reporting/clickhouse.js';
import { serve } from '../../lib/http/serve.js';
import { buildDashboardApp } from './app.js';

installClickHouseReportingProvider();

serve(buildDashboardApp(), env.PORT_DASHBOARD, 'dashboard');
