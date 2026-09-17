/**
 * Barrel export for the backend HTTP pipeline (request handling + error envelope).
 *
 * Route files across all surfaces should import from here instead of reaching
 * into individual sub-modules. This gives a single, stable import surface and
 * makes future restructuring of the sub-modules a non-breaking change.
 *
 * Sub-modules retained individually for tree-shaking and explicitness.
 */

// App lifecycle: createBaseApp / finalizeApp
export { createBaseApp, finalizeApp } from './express-app.js';

// Request pipeline wrappers
export { asyncHandler } from './async-handler.js';

// Envelope responses
export { sendOk, errorHandler, notFoundHandler, errorEnvelope, type SuccessEnvelope, type ErrorEnvelope, type Pagination } from './envelope.js';

// Validation middleware
export { validateBody, validateQuery } from './validate.js';

// Typed application errors
export {
  AppError,
  type ErrorCode,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  tooMany,
  conflict,
} from './errors.js';

// Health reporters
export { buildHealthReport, buildLivenessReport, buildReadinessReport, type HealthReport } from './health.js';

// Pagination helpers
export { paginationSchema, type PaginationQuery } from './pagination.js';
