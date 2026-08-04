/**
 * Typed application errors with stable machine-readable codes (spec §8A consistent envelope,
 * §12). Handlers throw these; the surface-level error middleware serializes them into the
 * standard envelope. Deny-by-default: unknown errors become 500 with no internal detail leaked.
 */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation_failed'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  validation_failed: 422,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    if (details !== undefined) this.details = details;
  }
}

export const forbidden = (msg = 'Forbidden') => new AppError('forbidden', msg);
export const unauthorized = (msg = 'Unauthorized') => new AppError('unauthorized', msg);
export const notFound = (msg = 'Not found') => new AppError('not_found', msg);
export const badRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError('bad_request', msg, details);
