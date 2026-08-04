/**
 * Admin reporting (spec §9) — full metrics incl. margin, all dimensions, network-scoped.
 * Reuses the shared reporting provider + request policy (audience 'admin').
 */
import { Router } from 'express';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateQuery } from '../../../lib/http/validate.js';
import { reportQuerySchema, buildReportRequest } from '../../../lib/reporting/request.js';
import { getReportingProvider } from '../../../lib/reporting/index.js';
import { mountDetailReports } from './detail-reports.js';

export function adminReportsRoutes(): Router {
  const r = Router();
  // Aggregate report (Offer/Affiliate/Advertiser/Daily/Custom = groupBy presets over this).
  r.get(
    '/',
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const request = buildReportRequest(req.scope!.networkId, res.locals.query, 'admin');
      sendOk(res, await getReportingProvider().runReport(request));
    }),
  );
  // Specialized reports: /clicks /conversions /postback-logs /goals /caps.
  mountDetailReports(r);
  return r;
}
