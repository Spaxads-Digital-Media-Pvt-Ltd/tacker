/**
 * Client-side check for a typed money amount (Add Conversion payout / revenue), mirroring the
 * backend rule (api-backend lib/money.ts): a non-negative plain decimal — up to 10 integer digits
 * (numeric(14,4)) and at most 4 decimals, no sign, no thousands separators, no currency symbol.
 * The backend still validates (422) — this only lets the form say so before submitting.
 *
 * Pure — `node --test` exercises the real module (lib/__tests__/moneyInput.test.ts).
 */

const MONEY_INPUT_RE = /^\d{1,10}(\.\d{1,4})?$/;

export type MoneyInputCheck = { ok: true; value: string } | { ok: false; error: string };

/** Validate a typed amount; `value` is the trimmed string to send. Empty input is an error ("Enter an amount"). */
export function checkMoneyInput(raw: string): MoneyInputCheck {
  const v = raw.trim();
  if (v === '') return { ok: false, error: 'Enter an amount' };
  if (MONEY_INPUT_RE.test(v)) return { ok: true, value: v };
  if (v.startsWith('-')) return { ok: false, error: 'Amount cannot be negative' };
  if (/^[+]?[\d.,\s'’_]+$/.test(v) && /[,\s'’_]/.test(v)) return { ok: false, error: 'Use a plain number without thousands separators (e.g. 1234.50)' };
  if (/^\d+\.\d{5,}$/.test(v)) return { ok: false, error: 'At most 4 decimal places' };
  if (/^\d{11,}(\.\d*)?$/.test(v)) return { ok: false, error: 'Amount is too large' };
  return { ok: false, error: 'Enter a number like 5 or 5.25' };
}
