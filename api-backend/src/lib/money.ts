/**
 * Money handling (spec §8, non-negotiable #2/#6 — decimals, NEVER floats).
 *
 * Money crosses the API as a STRING (e.g. "5.0000") and is stored in numeric(14,4). We validate
 * the decimal shape and normalize to 4 dp. We accept a JSON number for convenience but immediately
 * stringify it — no float math is ever performed on money values here.
 */
import { z } from 'zod';

const MONEY_RE = /^-?\d{1,10}(\.\d{1,4})?$/;

export function normalizeMoney(input: string | number): string {
  const raw = typeof input === 'number' ? input.toString() : input.trim();
  if (!MONEY_RE.test(raw)) {
    throw new Error(`Invalid money value: "${raw}"`);
  }
  // Normalize to 4 decimal places without float arithmetic.
  const neg = raw.startsWith('-');
  const [intPart, fracPart = ''] = raw.replace('-', '').split('.') as [string, string?];
  const frac = (fracPart + '0000').slice(0, 4);
  return `${neg ? '-' : ''}${intPart}.${frac}`;
}

/** Zod schema for a money field: accepts string or number, outputs normalized numeric string. */
export const moneySchema = z
  .union([z.string(), z.number()])
  .refine((v) => MONEY_RE.test(typeof v === 'number' ? v.toString() : v.trim()), {
    message: 'Must be a decimal with up to 4 fractional digits',
  })
  .transform((v) => normalizeMoney(v));
