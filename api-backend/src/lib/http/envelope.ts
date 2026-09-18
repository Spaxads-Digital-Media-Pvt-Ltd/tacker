/**
 * Standard JSON response envelope shared by the Express surfaces (spec §8A "consistent
 * envelope, standard error codes, pagination"). One shape for success, one for errors.
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, type ErrorCode } from './errors.js';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';

export interface Pagination {
 limit: number;
 offset: number;
 total?: number;
}

export interface SuccessEnvelope<T> {
 ok: true;
 data: T;
 pagination?: Pagination;
}

export interface ErrorEnvelope {
 ok: false;
 error: { code: ErrorCode; message: string; details?: unknown };
}

export function sendOk<T>(res: Response, data: T, pagination?: Pagination, status?: number): void {
 const body: SuccessEnvelope<T> = pagination ? { ok: true, data, pagination } : { ok: true, data };
 if (status) res.status(status);
 res.json(body);
}

/** Express error-handling middleware. Register LAST on every Express surface. */
export function errorHandler(
 err: unknown,
 _req: Request,
 res: Response,
 // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs 4 args to treat this as an error handler.
 _next: NextFunction,
): void {
 // Body too large (express.json limit) and JSON parse errors surface as plain Errors from the
 // body-parser middleware. Map them to typed envelopes so callers see the real status code
 // instead of a misleading 500.
 const e = err as { status?: number; statusCode?: number; type?: string; expose?: boolean };
 if (e?.type === 'entity.too.large' || e?.status === 413 || e?.statusCode === 413) {
 const body: ErrorEnvelope = { ok: false, error: { code: 'payload_too_large', message: 'Request body exceeds size limit' } };
 res.status(413).json(body);
 return;
 }
 if (e?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in (err as object))) {
 const body: ErrorEnvelope = { ok: false, error: { code: 'bad_request', message: 'Malformed JSON body' } };
 res.status(400).json(body);
 return;
 }

 if (err instanceof AppError) {
 const details = err.details as { retryAfter?: number } | undefined;
 const body: ErrorEnvelope = {
 ok: false,
 error: { code: err.code, message: err.message, ...(details !== undefined ? { details } : {}) },
 };
 res.status(err.status).json(body);
 // Set Retry-After for rate-limited responses (HTTP 429).
 if (err.code === 'rate_limited' && typeof details?.retryAfter === 'number') {
 res.setHeader('Retry-After', String(details.retryAfter));
 }
 return;
 }

 // Unknown error — never leak internals to the caller (spec §3A/§12).
 logger.error({ err }, 'unhandled error');
 captureError(err, { path: _req.path, method: _req.method });
 const body: ErrorEnvelope = { ok: false, error: { code: 'internal', message: 'Internal server error' } };
 res.status(500).json(body);
}

/**
 * Build a spec-compliant error envelope body. Used by non-Express surfaces (Fastify)
 * that construct responses directly. Returns the same shape as errorHandler.
 */
export function errorEnvelope(code: ErrorCode, message: string, _status: number): ErrorEnvelope {
  return { ok: false, error: { code, message } };
}

/** 404 fallthrough — deny-by-default for unknown routes (spec §3A). Register before errorHandler. */
export function notFoundHandler(_req: Request, res: Response): void {
 const body: ErrorEnvelope = { ok: false, error: { code: 'not_found', message: 'Route not found' } };
 res.status(404).json(body);
}
