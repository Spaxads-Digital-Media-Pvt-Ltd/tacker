import { env } from '../../config/env.js';
import { serve } from '../../lib/http/serve.js';
import { buildPublicApiApp } from './app.js';

serve(buildPublicApiApp(), env.PORT_PUBLIC_API, 'public-api');
