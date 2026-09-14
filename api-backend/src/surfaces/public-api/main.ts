import { env } from '../../config/env.js';
import { installReportingProvider } from '../../lib/reporting/clickhouse.js';
import { serve } from '../../lib/http/serve.js';
import { buildPublicApiApp } from './app.js';
import { mountHealthRoutes } from '../../lib/http/health.js';

installReportingProvider();

const app = buildPublicApiApp();
mountHealthRoutes(app, 'public-api');
serve(app, env.PORT_PUBLIC_API, 'public-api');
