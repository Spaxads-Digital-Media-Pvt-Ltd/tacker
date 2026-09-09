import { env } from '../../config/env.js';
import { installClickHouseReportingProvider } from '../../lib/reporting/clickhouse.js';
import { serve } from '../../lib/http/serve.js';
import { buildPublicApiApp } from './app.js';

installClickHouseReportingProvider();

serve(buildPublicApiApp(), env.PORT_PUBLIC_API, 'public-api');
