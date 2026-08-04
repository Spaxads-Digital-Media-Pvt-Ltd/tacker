/**
 * Zod validation middleware (spec §12 — input validation everywhere). Validates and REPLACES
 * req.body / parsed query with typed, sanitized data. On failure → 422 with details, before any
 * handler logic runs (deny-by-default).
 */
import type { Request, Response, NextFunction } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { AppError } from './errors.js';

export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError('validation_failed', 'Request body failed validation', flatten(result.error)));
    }
    req.body = result.data;
    return next();
  };
}

/** Parsed query lives on res.locals.query (req.query is read-only-ish in Express 5-ready code). */
export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new AppError('validation_failed', 'Query failed validation', flatten(result.error)));
    }
    res.locals.query = result.data;
    return next();
  };
}

function flatten(err: z.ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}
