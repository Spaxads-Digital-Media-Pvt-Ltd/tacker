/**
 * Zod validation middleware (spec §12 — input validation everywhere). Validates and REPLACES
 * req.body / parsed query with typed, sanitized data. On failure → 422 with details, before any
 * handler logic runs (deny-by-default).
 */
import type { Request, Response, NextFunction } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { validationFailed } from './errors.js';
import './zod-messages.js'; // plain-English messages for every schema (zod's global error map)

export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(validationFailed(describeIssues(result.error, 'Request body failed validation'), flatten(result.error)));
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
      return next(validationFailed(describeIssues(result.error, 'Query failed validation'), flatten(result.error)));
    }
    res.locals.query = result.data;
    return next();
  };
}

/** `dailyConversionCap` → "Daily conversion cap"; a list index → "#3" (1-based). */
function fieldLabel(path: (string | number)[]): string {
  return path.map((p) => (typeof p === 'number' ? `#${p + 1}`
    : p.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase()))).join(' › ');
}

const MAX_SHOWN = 3;

/**
 * The message a person reads: the first few problems, each naming its field — "Password must be at
 * least 12 characters." / "Email must be a valid email address" / "Daily conversion cap must be a
 * number" (lib/http/zod-messages.ts) — instead of "Request body failed validation". A message that already starts with the
 * field's name isn't prefixed again. The full list stays in `details` for programs.
 */
export function describeIssues(err: z.ZodError, fallback: string): string {
  const parts = err.issues.slice(0, MAX_SHOWN).map((i) => {
    if (!i.path.length) return i.message;
    const label = fieldLabel(i.path);
    // The plain-English map's messages ("must be a number") read on from the field's name.
    if (/^[a-z]/.test(i.message)) return `${label} ${i.message}`;
    const last = String(i.path[i.path.length - 1]).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return i.message.toLowerCase().startsWith(last) ? i.message : `${label}: ${i.message}`;
  }).filter(Boolean);
  if (!parts.length) return fallback;
  const more = err.issues.length - MAX_SHOWN;
  return `${parts.join(' · ')}${more > 0 ? ` (and ${more} more)` : ''}`;
}

function flatten(err: z.ZodError): Record<string, string[]> {
  const { fieldErrors, formErrors } = err.flatten();
  // Object-level errors (e.g. `.strict()` "Unrecognized key(s) in object: 'foo'", cross-field
  // refinements) have no field — surface them under `_errors` instead of returning empty details.
  return { ...(fieldErrors as Record<string, string[]>), ...(formErrors.length ? { _errors: formErrors } : {}) };
}
