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

// ---- Exact decimal arithmetic: money as a BigInt count of 1/10000 units, never a float. ----

const SCALE = 10_000n;
const PCT_RE = /^-?\d{1,10}(\.\d{1,6})?$/;

function toUnits(v: string): bigint {
  const n = normalizeMoney(v);
  const neg = n.startsWith('-');
  const [i, f] = n.replace('-', '').split('.') as [string, string];
  const u = BigInt(i) * SCALE + BigInt(f);
  return neg ? -u : u;
}

function fromUnits(u: bigint): string {
  const neg = u < 0n;
  const a = neg ? -u : u;
  return `${neg ? '-' : ''}${a / SCALE}.${(a % SCALE).toString().padStart(4, '0')}`;
}

/** Integer division rounding half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice < (d < 0n ? -d : d)) return q;
  return (n < 0n) !== (d < 0n) ? q - 1n : q + 1n;
}

export function addMoney(a: string, b: string): string {
  return fromUnits(toUnits(a) + toUnits(b));
}

/** Signed a − b. */
export function subMoney(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function moneySign(a: string): -1 | 0 | 1 {
  const u = toUnits(a);
  return u === 0n ? 0 : u < 0n ? -1 : 1;
}

export function absMoney(a: string): string {
  const u = toUnits(a);
  return fromUnits(u < 0n ? -u : u);
}

/** a − b, clamped at zero (payout/revenue can't go negative). */
export function subMoneyFloorZero(a: string, b: string): string {
  const d = toUnits(a) - toUnits(b);
  return fromUnits(d < 0n ? 0n : d);
}

/** `pct` percent of `amount`, rounded half-up to 4 dp. `pct` may carry up to 6 decimals. */
export function percentOfMoney(amount: string, pct: string | number): string {
  const p = typeof pct === 'number' ? pct.toString() : pct.trim();
  if (!PCT_RE.test(p)) throw new Error(`Invalid percentage: "${p}"`);
  const neg = p.startsWith('-');
  const [i, f = ''] = p.replace('-', '').split('.') as [string, string?];
  const pctScaled = BigInt(i + f.padEnd(6, '0')) * (neg ? -1n : 1n); // pct × 10^6
  return fromUnits(divRound(toUnits(amount) * pctScaled, 100n * 1_000_000n));
}

/** Zod schema for a money field: accepts string or number, outputs normalized numeric string. */
export const moneySchema = z
  .union([z.string(), z.number()])
  .refine((v) => MONEY_RE.test(typeof v === 'number' ? v.toString() : v.trim()), {
    message: 'Must be a decimal with up to 4 fractional digits',
  })
  .transform((v) => normalizeMoney(v));
