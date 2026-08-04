/**
 * Shared Express plumbing (helmet, JSON body, request logging, /health, deny-by-default 404,
 * error envelope). Each surface calls this for common middleware, then mounts its OWN route
 * tree + OWN auth. Shared plumbing does NOT mean shared auth — segregation is preserved
 * (spec §2.1, non-negotiable #10).
 */
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { surfaceLogger } from '../logger.js';
import { buildHealthReport } from './health.js';
import { errorHandler, notFoundHandler } from './envelope.js';
import { metricsText, metricsContentType, httpDuration } from '../metrics.js';

export function createBaseApp(surface: string): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(pinoHttp({ logger: surfaceLogger(surface) }));

  // Per-request duration → Prometheus (spec §2/§3B). Uses the route pattern, not the raw path,
  // to avoid unbounded label cardinality.
  app.use((req, res, next) => {
    const end = httpDuration.startTimer({ surface, method: req.method });
    res.on('finish', () => end({ status: String(res.statusCode) }));
    next();
  });

  // Liveness/readiness — no auth (spec §13 Phase 0 health checks).
  app.get('/health', async (_req, res) => {
    const report = await buildHealthReport(surface);
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  // Prometheus scrape endpoint (spec §2 observability).
  app.get('/metrics', async (_req, res) => {
    res.setHeader('content-type', metricsContentType);
    res.send(await metricsText());
  });

  return app;
}

/** Call AFTER mounting all routers: registers 404 + error handlers in the right order. */
export function finalizeApp(app: Express): void {
  app.use(notFoundHandler);
  app.use(errorHandler);
}
