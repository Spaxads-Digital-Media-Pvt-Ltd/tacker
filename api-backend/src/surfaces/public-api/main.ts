import { env } from '../../config/env.js';
import { installReportingProvider } from '../../lib/reporting/clickhouse.js';
import { serve } from '../../lib/http/serve.js';
import { buildPublicApiApp } from './app.js';

installReportingProvider();

const app = buildPublicApiApp();
serve(app, env.PORT_PUBLIC_API, 'public-api');
