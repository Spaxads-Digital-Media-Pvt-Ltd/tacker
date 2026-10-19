/**
 * Request-field helpers shared by the Super Admin panels' routes: form fields arrive as '' when cleared
 * (stored as NULL), money is text (never a float), dates are an ISO date or date-time.
 */
import type { Request } from 'express';
import { z } from 'zod';
import type { PlatformAdminIdentity } from '../../middleware/types.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optional text: trimmed, '' → null. */
export const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

/** Optional email: '' → null, else a valid address (lower-cased). */
export const optEmail = z.string().trim().max(200)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'must be an email address, like name@company.com')
  .transform((v) => (v ? v.toLowerCase() : null)).nullable().optional();

/** An amount as text: 499 or 499.50 — never a float. */
export const moneyText = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'must be an amount like 499 or 499.50');
/** An optional amount ('' → null). */
export const optMoney = z.union([z.literal(''), moneyText]).transform((v) => v || null).nullable().optional();

/** An optional ISO date or date-time ('' → null). */
export const optDateTime = z.string().trim()
  .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'must be a date, like 2026-10-20 or 2026-10-20T15:00')
  .transform((v) => (v ? new Date(v).toISOString() : null)).nullable().optional();

export const ident = (req: Request) => req.identity as PlatformAdminIdentity;
export const meId = (req: Request) => ident(req).platformAdminId;
