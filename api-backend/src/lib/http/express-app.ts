/**
 * Shared Express plumbing (helmet, JSON body, request logging, /health, deny-by-default 404,
 * error envelope). Each surface calls this for common middleware, then mounts its OWN route
 * tree + OWN auth. Shared plumbing does NOT mean shared auth — segregation is preserved
 * (spec §2.1, non-negotiable #10).
 *
 * CORS: the dashboard SPA and browser-based integrator dashboards run on different origins
 * from the API. Supply `corsOrigin` to control which origins are allowed. Defaults to the
 * configured dashboard origin(s). Set `corsOrigin: false` to disable CORS entirely (workers,
 * internal-only surfaces).
 */
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { surfaceLogger } from '../logger.js';
import { env } from '../../config/env.js';
import { buildHealthReport } from './health.js';
import { errorHandler, notFoundHandler } from './envelope.js';
import { metricsText, metricsContentType, httpDuration } from '../metrics.js';

type CorsOrigin = string | string[] | false;

function resolveCorsOrigin(raw?: CorsOrigin): CorsOrigin {
  if (raw === false) return false;
  if (raw) return raw;
  const configured = env.DASHBOARD_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
  return configured?.length ? configured : 'http://localhost:5173';
}

function buildCorsMiddleware(origin: string | string[]): express.RequestHandler {
  const allowed = typeof origin === 'string' ? [origin] : origin;
  const allowedSet = new Set(allowed.map(o => o.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction) => {
    const reqOrigin = (req.headers.origin as string | undefined)?.toLowerCase() ?? '';
    if (reqOrigin && allowedSet.has(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  };
}

export function createBaseApp(surface: string, corsOrigin?: CorsOrigin): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginEmbedderPolicy: false }));
  // 6mb matches creatives / branding data-URL uploads (zod max 6_000_000 on creative url).
  app.use(express.json({ limit: '6mb' }));
  app.use(pinoHttp({ logger: surfaceLogger(surface) }));

  // CORS: allow configured origins for surfaces that are called from browsers.
  // Pass corsOrigin=false at the call site to skip (workers, internal-only surfaces).
  const resolved = resolveCorsOrigin(corsOrigin);
  if (resolved !== false) app.use(buildCorsMiddleware(resolved));

  // Per-request duration → Prometheus (spec §2/§3B). Uses the route pattern, not the raw path,
  // to avoid unbounded label cardinality.
  app.use((req, res, next) => {
    const end = httpDuration.startTimer({ surface, method: req.method });
    res.on('finish', () => end({ status: String(res.statusCode) }));
    next();
  });

  // Liveness/readiness — no auth (spec §13 Phase 0 health checks).
  // Returns 200 for 'ok' and 'degraded' (still functional); 503 only for 'unready'.
  app.get('/health', async (_req, res) => {
    try {
      const report = await buildHealthReport(surface);
      res.status(report.status === 'unready' ? 503 : 200).json(report);
    } catch {
      res.sendStatus(503);
    }
  });

  // Prometheus scrape endpoint (spec §2 observability).
  app.get('/metrics', async (_req, res) => {
    try {
      res.setHeader('content-type', metricsContentType);
      res.send(await metricsText());
    } catch {
      res.sendStatus(500);
    }
  });

  return app;
}

/** Call AFTER mounting all routers: registers 404 + error handlers in the right order. */
export function finalizeApp(app: Express): void {
  app.use(notFoundHandler);
  app.use(errorHandler);
}
