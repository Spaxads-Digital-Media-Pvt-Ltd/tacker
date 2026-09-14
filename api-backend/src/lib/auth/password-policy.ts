/**
 * Shared password policy — single source of truth for all login/change/set flows.
 *
 * Policy:
 * - Minimum length: 12 characters after trimming whitespace
 * - Maximum length: 256 characters (raw)
 * - Empty and whitespace-only passwords are rejected
 *
 * The schema validates but does NOT transform — the raw string is passed through
 * so the hashing/verification layer receives exactly what the caller typed.
 */

import { z } from 'zod';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export const passwordSchema = z.string()
 .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters.`)
 .refine(
 (v) => typeof v === 'string' && v.trim().length >= PASSWORD_MIN,
 `Password must be at least ${PASSWORD_MIN} characters.`,
 );
