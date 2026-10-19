// Custom-metric formula grammar (lib/customMetricFormula.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { formulaError, isValidFormula, MAX_FORMULA_TOKENS } from '../customMetricFormula.ts';
import type { FormulaToken } from '../customMetrics.ts';

const m = (key: 'clicks' | 'conversions' | 'invalid_clicks'): FormulaToken => ({ type: 'metric', key });
const c = (value: number): FormulaToken => ({ type: 'const', value });
const op = (value: '+' | '-' | '*' | '/' | '(' | ')'): FormulaToken => ({ type: 'op', value });

describe('valid formulas', () => {
  const cases: [string, FormulaToken[]][] = [
    ['single metric', [m('clicks')]],
    ['single const (incl. negative)', [c(-5)]],
    ['Clicks / CV', [m('clicks'), op('/'), m('conversions')]],
    ['(Invalid / Clicks) * 100', [op('('), m('invalid_clicks'), op('/'), m('clicks'), op(')'), op('*'), c(100)]],
    ['nested parens', [op('('), op('('), m('clicks'), op(')'), op(')')]],
    ['operator after )', [op('('), m('clicks'), op('+'), c(1), op(')'), op('-'), op('('), c(2), op(')')]],
  ];
  for (const [name, tokens] of cases) {
    it(name, () => {
      assert.strictEqual(formulaError(tokens), null);
      assert.strictEqual(isValidFormula(tokens), true);
    });
  }
});

describe('invalid formulas', () => {
  const cases: [string, FormulaToken[]][] = [
    ['empty', []],
    ['two operands in a row', [m('clicks'), m('conversions')]],
    ['operand right after )', [op('('), m('clicks'), op(')'), c(2)]],
    ['( right after operand', [m('clicks'), op('('), c(2), op(')')]],
    ['leading operator', [op('+'), m('clicks')]],
    ['unary minus', [op('-'), c(5)]],
    ['doubled operator', [m('clicks'), op('*'), op('/'), c(2)]],
    ['operator right after (', [op('('), op('*'), m('clicks'), op(')')]],
    ['trailing operator', [m('clicks'), op('/')]],
    ['empty ()', [op('('), op(')')]],
    ['operator before )', [op('('), m('clicks'), op('+'), op(')')]],
    ['unmatched )', [m('clicks'), op(')')]],
    ['unclosed (', [op('('), m('clicks')]],
    ['ends with (', [m('clicks'), op('+'), op('(')]],
    ['non-finite const', [c(Number.NaN)]],
    ['too many tokens', Array.from({ length: MAX_FORMULA_TOKENS + 1 }, (_, i) => (i % 2 ? op('+') : c(1)))],
  ];
  for (const [name, tokens] of cases) {
    it(name, () => {
      const err = formulaError(tokens);
      assert.ok(typeof err === 'string' && err.length > 0, `expected an error for ${name}`);
      assert.strictEqual(isValidFormula(tokens), false);
    });
  }
});
