/**
 * Custom-metric formula grammar check — mirrors api-backend's `isValidFormula`
 * (surfaces/dashboard/custom-metrics/routes.ts) so the builder can block a formula the server would
 * reject. The tokens must form a valid infix expression: an OPERAND is a `metric`, a `const`, or
 * `(` expression `)`, joined by the binary operators + - * / (no unary operators — a negative number
 * is a negative `const`), with balanced, non-empty parentheses; operands and operators alternate.
 * The server also caps a formula at 50 tokens.
 */
import type { FormulaToken } from './customMetrics.ts';

export const MAX_FORMULA_TOKENS = 50;

/** Why `tokens` isn't a valid formula, or `null` when it is. */
export function formulaError(tokens: readonly FormulaToken[]): string | null {
  if (tokens.length === 0) return 'Add at least one metric or number.';
  if (tokens.length > MAX_FORMULA_TOKENS) return `A formula can have at most ${MAX_FORMULA_TOKENS} parts.`;
  let depth = 0;
  let expectOperand = true; // at the start, after '(' and after a binary operator
  for (const t of tokens) {
    if (t.type === 'const' && !Number.isFinite(t.value)) return 'Numbers must be finite.';
    if (t.type === 'metric' || t.type === 'const' || t.value === '(') {
      if (!expectOperand) return 'Put an operator (+ − × ÷) between two values.';
      if (t.type === 'op') depth++;
      else expectOperand = false;
    } else if (t.value === ')') {
      if (depth === 0) return 'There is a ")" without a matching "(".';
      if (expectOperand) return 'Parentheses can’t be empty or end with an operator.';
      depth--;
    } else if (expectOperand) {
      return 'An operator needs a value before it (no leading, doubled or unary operators).';
    } else {
      expectOperand = true;
    }
  }
  if (expectOperand) return 'The formula can’t end with an operator or "(".';
  if (depth > 0) return `Close ${depth === 1 ? 'the open "("' : `${depth} open "("`} with ")".`;
  return null;
}

export const isValidFormula = (tokens: readonly FormulaToken[]): boolean => formulaError(tokens) === null;
