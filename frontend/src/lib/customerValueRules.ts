/**
 * Customer Value › Payout & Revenue Rules — pure form / list rules (no React / DOM, so `node --test`
 * runs the real code; see lib/__tests__/customerValueRules.test.ts). Used by
 * pages/admin/CustomerValue.tsx and CustomerValueRuleForm.tsx.
 */

import { checkMoneyInput } from './moneyInput.ts';

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * A Custom Payout / Revenue field: empty = not set (null), a valid amount = the exact text to send
 * ("0.0005"), anything else = an error to show (never silently dropped). Same rule as the API: a
 * non-negative plain decimal with at most 4 decimal places (lib/moneyInput).
 */
export function ruleAmountField(raw: string): { value: string | null; error: string | null } {
  if (raw.trim() === '') return { value: null, error: null };
  const c = checkMoneyInput(raw);
  return c.ok ? { value: c.value, error: null } : { value: null, error: c.error };
}

/**
 * "Separately By" is stored but evaluated exactly like "All Together" (lib/customer-value/evaluate.ts
 * on the API), so every place that shows it says so.
 */
export const SEPARATELY_BY_LABEL = 'Separately By (not yet applied)';
export const SEPARATELY_BY_HINT = '"Separately By" is saved but not yet applied: rules currently evaluate all of a customer\'s conversion events together.';

/** The Conversion Event Grouping as shown in the rules list. */
export function groupingLabel(grouping: string): string {
  return grouping === 'separately_by' ? SEPARATELY_BY_LABEL : 'All Together';
}

const NUMBER_OPERATORS = ['greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'equal_to'];

/**
 * A goal condition checked against its data point's type — the same rule the API enforces (422):
 * text = "Any Value" + "Exact Match" with a value; number = a number operator and a numeric value.
 * null when valid.
 */
export function conditionError(
  dataType: 'text' | 'number' | undefined, operator: string, conditionLogic: string, value: string,
): string | null {
  if (!dataType) return 'Choose a data point';
  const v = value.trim();
  if (dataType === 'text') {
    if (operator !== 'exact_match' || conditionLogic !== 'any_value') return 'A text data point supports "Any Value" with "Exact Match" only';
    return v ? null : 'Enter a value';
  }
  if (!NUMBER_OPERATORS.includes(operator)) return 'Choose a number operator';
  if (!v) return 'Enter a value';
  return /^-?\d+(\.\d+)?$/.test(v) ? null : 'The value must be a number (e.g. 100 or 99.5)';
}

/** A rule amount in the list: the exact stored value — rules carry no currency (each conversion's own applies). */
export function formatRuleAmount(v: string | number | null | undefined): string {
  return v == null || v === '' ? '—' : String(v);
}

/**
 * A rule date from the API (`YYYY-MM-DD`) as the value of an `<input type="date">`: that day,
 * unchanged — so saving an untouched form sends the same day back. Anything that isn't a date → ''.
 */
export function toDateInput(v: string | null | undefined): string {
  const m = YMD_RE.exec(v ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * A rule date for display: the calendar day itself, in the viewer's locale format. Formatted in UTC
 * on purpose — `new Date('2026-12-31').toLocaleDateString()` is UTC midnight shown in the viewer's
 * timezone, i.e. "12/30/2026" anywhere west of UTC.
 */
export function formatRuleDate(v: string | null | undefined, locale?: string): string {
  const m = YMD_RE.exec(v ?? '');
  if (!m) return '—';
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return day.toLocaleDateString(locale, { timeZone: 'UTC' });
}

/**
 * Whether a failed rule delete means the list is stale: a 404 (the rule was already deleted, e.g. in
 * another tab) — the list is refreshed so the row disappears, and the error is still shown. Any other
 * failure (500, network) leaves the row: it may still exist. Structural check on the ApiError's
 * `status`, so this module stays free of the browser-only API client.
 */
export function deleteFailureMeansGone(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 404;
}
