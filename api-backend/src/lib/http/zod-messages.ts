/**
 * Plain-English validation messages for every zod schema (installed once as zod's global error map):
 * "must be a number", "is required", "must be at most 500" — instead of zod's "Expected number,
 * received string" / "Required" / "Number must be less than or equal to 500". A message written in a
 * schema (`.min(12, 'Password must be at least 12 characters.')`, a refine) still wins. Messages that
 * start in lower case read after the field's name: describeIssues → "Daily cap must be a number".
 */
import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

const plural = (n: number | bigint, word: string) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

const TYPE_WORD: Record<string, string> = {
  number: 'a number', integer: 'a whole number', bigint: 'a whole number', string: 'text', boolean: 'true or false',
  array: 'a list', object: 'an object', date: 'a date',
};

export const friendlyErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'is required' };
      if (issue.received === 'null') return { message: "can't be empty" };
      return { message: `must be ${TYPE_WORD[issue.expected] ?? issue.expected}` };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: Number(issue.minimum) <= 1 ? "can't be empty" : `must be at least ${plural(issue.minimum, 'character')}` };
      if (issue.type === 'array' || issue.type === 'set') return { message: `needs at least ${plural(issue.minimum, 'item')}` };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: issue.inclusive ? `must be at least ${issue.minimum}` : `must be more than ${issue.minimum}` };
      if (issue.type === 'date') return { message: `must be on or after ${new Date(Number(issue.minimum)).toISOString().slice(0, 10)}` };
      break;
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `must be at most ${plural(issue.maximum, 'character')}` };
      if (issue.type === 'array' || issue.type === 'set') return { message: `can have at most ${plural(issue.maximum, 'item')}` };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: issue.inclusive ? `must be at most ${issue.maximum}` : `must be less than ${issue.maximum}` };
      if (issue.type === 'date') return { message: `must be on or before ${new Date(Number(issue.maximum)).toISOString().slice(0, 10)}` };
      break;
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'must be a valid email address' };
      if (issue.validation === 'url') return { message: 'must be a full URL (https://…)' };
      if (issue.validation === 'uuid') return { message: 'must be a valid id' };
      if (issue.validation === 'datetime') return { message: 'must be a date and time (e.g. 2026-10-22T10:00:00Z)' };
      if (issue.validation === 'date') return { message: 'must be a date (YYYY-MM-DD)' };
      if (issue.validation === 'regex') return { message: 'is not in the expected format' };
      break;
    case ZodIssueCode.invalid_enum_value:
      return { message: `must be one of: ${issue.options.map(String).join(', ')}` };
    case ZodIssueCode.invalid_literal:
      return { message: `must be ${JSON.stringify(issue.expected)}` };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Unknown field${issue.keys.length === 1 ? '' : 's'}: ${issue.keys.join(', ')}` };
    case ZodIssueCode.invalid_date:
      return { message: 'must be a valid date' };
    case ZodIssueCode.not_multiple_of:
      return { message: `must be a multiple of ${issue.multipleOf}` };
    case ZodIssueCode.not_finite:
      return { message: 'must be a finite number' };
    case ZodIssueCode.invalid_union:
      return { message: 'is not valid' };
    default:
      break;
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(friendlyErrorMap);
