/**
 * Shared definitions for Custom Reporting Metrics — the whitelisted base metrics a formula token may
 * reference (mirrors api-backend's CUSTOM_METRIC_BASE_KEYS exactly, since the server re-validates
 * against the same list) and the token/format types used by the formula builder.
 */
export type MetricKey =
  | 'clicks' | 'unique_clicks' | 'invalid_clicks' | 'conversions' | 'total_conversions'
  | 'payout' | 'revenue' | 'margin' | 'avg_fraud_score';

export const METRIC_LABELS: Record<MetricKey, string> = {
  clicks: 'Clicks', unique_clicks: 'Uniq. Clicks', invalid_clicks: 'Invalid Clicks',
  conversions: 'CV', total_conversions: 'Total CV',
  payout: 'Payout', revenue: 'Revenue', margin: 'Profit', avg_fraud_score: 'Fraud Score',
};
export const METRIC_KEYS = Object.keys(METRIC_LABELS) as MetricKey[];

export type Operator = '+' | '-' | '*' | '/' | '(' | ')';
export const OPERATORS: { value: Operator; label: string }[] = [
  { value: '+', label: '+' }, { value: '-', label: '−' }, { value: '*', label: '×' }, { value: '/', label: '÷' },
  { value: '(', label: '(' }, { value: ')', label: ')' },
];

export type FormulaToken =
  | { type: 'metric'; key: MetricKey }
  | { type: 'op'; value: Operator }
  | { type: 'const'; value: number };

export type MetricFormat = 'number' | 'percentage' | 'currency';
export const FORMAT_LABELS: Record<MetricFormat, string> = { number: 'Number', percentage: 'Percentage', currency: 'Currency' };

export function tokenLabel(t: FormulaToken): string {
  if (t.type === 'metric') return METRIC_LABELS[t.key];
  if (t.type === 'op') return OPERATORS.find((o) => o.value === t.value)?.label ?? t.value;
  return String(t.value);
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/** Safe evaluator: every token is either a known operator, a parsed number, or a whitelisted metric
 * key substituted in by the caller — never arbitrary user input, so this is a shunting-yard
 * evaluation over a closed token set rather than an `eval()`/`Function()` of a user string. */
export function evaluateFormula(tokens: FormulaToken[], metricValues: Partial<Record<MetricKey, number>>): number | null {
  const output: (number | Operator)[] = [];
  const opStack: Operator[] = [];
  for (const t of tokens) {
    if (t.type === 'metric') output.push(metricValues[t.key] ?? 0);
    else if (t.type === 'const') output.push(t.value);
    else if (t.value === '(') opStack.push(t.value);
    else if (t.value === ')') {
      while (opStack.length && opStack[opStack.length - 1] !== '(') output.push(opStack.pop()!);
      opStack.pop();
    } else {
      let top = opStack[opStack.length - 1];
      while (top !== undefined && top !== '(' && (PRECEDENCE[top] ?? 0) >= (PRECEDENCE[t.value] ?? 0)) {
        output.push(opStack.pop()!);
        top = opStack[opStack.length - 1];
      }
      opStack.push(t.value);
    }
  }
  while (opStack.length) output.push(opStack.pop()!);

  const stack: number[] = [];
  for (const tok of output) {
    if (typeof tok === 'number') { stack.push(tok); continue; }
    const b = stack.pop(); const a = stack.pop();
    if (a === undefined || b === undefined) return null;
    if (tok === '+') stack.push(a + b);
    else if (tok === '-') stack.push(a - b);
    else if (tok === '*') stack.push(a * b);
    else if (tok === '/') stack.push(b === 0 ? 0 : a / b);
  }
  return stack.length === 1 ? stack[0]! : null;
}

export function formatMetricValue(v: number | null, format: MetricFormat): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (format === 'percentage') return `${v.toFixed(2)}%`;
  if (format === 'currency') return `$${v.toFixed(2)}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
