/**
 * Public REST API surface (spec §2.1 #3, §8A) — the API-key integration surface for THEIR code.
 *
 * THREE audiences, THREE isolated namespaces, verified by structural middleware BEFORE any handler
 * (spec §8A, non-negotiable #11):
 *   /api/v1/advertiser/*  → advertiser keys only
 *   /api/v1/publisher/*   → publisher keys only
 *   /api/v1/network/*     → network/admin keys only
 * Versioned under /api/v1. OpenAPI is public at /api/v1/openapi.json.
 */
import type { Express } from 'express';
import { createBaseApp, finalizeApp } from '../../lib/http/express-app.js';
import { apiKeyAuth, requireAudience } from './auth.js';
import { advertiserApi } from './advertiser.js';
import { publisherApi } from './publisher.js';
import { networkApi } from './network.js';
import { openApiSpec } from './openapi.js';

export function buildPublicApiApp(): Express {
  const app = createBaseApp('public-api');

  // Public, unauthenticated API docs.
  app.get('/api/v1/openapi.json', (_req, res) => res.json(openApiSpec()));

  // Each namespace: resolve key → verify audience (403 before handler) → audience routes.
  app.use('/api/v1/advertiser', apiKeyAuth, requireAudience('advertiser'), advertiserApi());
  app.use('/api/v1/publisher', apiKeyAuth, requireAudience('publisher'), publisherApi());
  app.use('/api/v1/network', apiKeyAuth, requireAudience('network'), networkApi());

  finalizeApp(app);
  return app;
}
