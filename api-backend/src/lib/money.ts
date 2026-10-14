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

/** A currency code as the ledger accepts it: exactly 3 upper-case letters (e.g. USD). */
export const CURRENCY_RE = /^[A-Z]{3}$/;

/** Zod schema for a money field: accepts string or number, outputs normalized numeric string. */
export const moneySchema = z
  .union([z.string(), z.number()])
  .refine((v) => MONEY_RE.test(typeof v === 'number' ? v.toString() : v.trim()), {
    message: 'Must be a decimal with up to 4 fractional digits',
  })
  .transform((v) => normalizeMoney(v));

// ---- Amounts from outside (offer feeds, O9): exact parse + round, never a float. ----

/** An external amount that isn't a usable decimal (not a number, an exponent too large, > 10 digits). */
export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyFormatError';
  }
}

/** "1.5e-3" → "0.0015", exactly (string shifting, no float). */
function expandExponent(raw: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (!m) return raw;
  const [, sign, int, frac = '', expStr] = m as unknown as [string, string, string, string | undefined, string];
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || Math.abs(exp) > 40) throw new MoneyFormatError(`Money value out of range: "${raw}"`);
  const digits = int + frac;
  const point = int.length + exp; // where the decimal point lands in `digits`
  const whole = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0');
  const fraction = point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * An amount from outside the app — a decimal string, or a JSON number as it was written (pass the
 * source text when you have it: a parsed number has already lost digits past ~15) — rounded half away
 * from zero to 4 dp exactly. Anything that isn't a plain or exponent decimal, or doesn't fit
 * numeric(14,4), throws MoneyFormatError.
 */
export function roundMoney(input: string | number): string {
  let raw: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyFormatError(`Invalid money value: "${String(input)}"`);
    raw = String(input);
  } else {
    raw = input.trim();
  }
  raw = expandExponent(raw);
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!m) throw new MoneyFormatError(`Invalid money value: "${String(input)}"`);
  const [, sign, intPart, frac = ''] = m as unknown as [string, string, string, string | undefined];
  let units = BigInt(intPart) * SCALE + BigInt((frac + '0000').slice(0, 4));
  if ((frac[4] ?? '0') >= '5') units += 1n; // the 5th decimal decides: half away from zero
  if (units >= 10n ** 14n) throw new MoneyFormatError(`Money value too large: "${String(input)}"`);
  return units === 0n ? '0.0000' : fromUnits(sign ? -units : units);
}
