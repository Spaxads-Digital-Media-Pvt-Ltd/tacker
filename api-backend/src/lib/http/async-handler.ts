/**
 * Wraps an async Express handler so rejected promises reach the error middleware (Express 4
 * doesn't forward async errors automatically). Every async route uses this.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
