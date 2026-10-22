/**
 * White-label for the network itself (Control Center › Platform › White-label) — admins only, and only
 * once the platform granted it (else 403 white_label_not_enabled): brand name, primary colour, support
 * link, "hide the platform's branding", and a dashboard domain verified by a DNS TXT record
 * (lib/white-label.ts). GET shows the settings whatever the grant, so the page can say what's needed.
 *
 * publicBrandRoutes (unauthenticated, before the auth gate): GET /api/public/brand?host= — the brand the
 * SPA wears on a network's verified dashboard domain, or 404.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { AppError, notFound } from '../../../lib/http/errors.js';
import { writeAudit } from '../../../lib/audit.js';
import { brandForHost, saveWhiteLabel, verifyWhiteLabelDomain, whiteLabelDto, whiteLabelFor, whiteLabelPatchSchema } from '../../../lib/white-label.js';
import { requireRole } from '../auth.js';

const notEnabled = () => new AppError('forbidden', 'White-label isn’t part of this network’s plan yet — ask the platform team to turn it on.', { reason: 'white_label_not_enabled' });

export function whiteLabelRoutes(): Router {
  const r = Router();
  r.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
    sendOk(res, whiteLabelDto(await whiteLabelFor(req.scope!.networkId)));
  }));
  r.put('/', requireRole('admin'), validateBody(whiteLabelPatchSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const before = await whiteLabelFor(networkId);
    if (!before?.enabled) throw notEnabled();
    const saved = await saveWhiteLabel(networkId, req.body as z.infer<typeof whiteLabelPatchSchema>);
    await writeAudit(req, { action: 'white_label.update', entityType: 'network', entityId: networkId, before: whiteLabelDto(before), after: whiteLabelDto(saved) });
    sendOk(res, whiteLabelDto(saved));
  }));
  r.post('/verify', requireRole('admin'), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    if (!(await whiteLabelFor(networkId))?.enabled) throw notEnabled();
    sendOk(res, whiteLabelDto(await verifyWhiteLabelDomain(networkId)));
  }));
  return r;
}

export function publicBrandRoutes(): Router {
  const r = Router();
  r.get('/brand', validateQuery(z.object({ host: z.string().trim().min(1).max(260) })), asyncHandler(async (_req, res) => {
    const brand = await brandForHost((res.locals.query as { host: string }).host);
    if (!brand) throw notFound('No brand for this host.');
    res.setHeader('cache-control', 'public, max-age=60');
    sendOk(res, brand);
  }));
  return r;
}
