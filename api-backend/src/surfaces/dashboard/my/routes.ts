/**
 * My partners / My advertisers — the accounts a team member manages (publishers.partner_manager_id;
 * advertisers.account_manager_id or sales_manager_id = their users row), with their numbers for a date
 * range (the reporting provider, so they match Reports), offers and latest conversions. Every staff
 * member has these panels; an Affiliate / Advertiser Manager has nothing else (dashboard auth gate).
 *
 * - GET /api/my/summary — who I am, how many partners / advertisers I manage, pending applications.
 * - GET /api/my/partners?from&to — my partners with clicks, conversions, payout, revenue, margin.
 * - GET /api/my/partners/:id — one of them: its offers' numbers, latest conversions, pending applications.
 * - GET /api/my/offer-applications; POST /api/my/offer-applications/:id { status } — my partners' requests
 *   for gated offers (approve / reject: admin, manager, affiliate manager).
 * - GET /api/my/advertisers?from&to, GET /api/my/advertisers/:id — the same for advertisers and their offers.
 *
 * Network-scoped like everything else (§3A); an account that isn't mine is a 404.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { buildReportRequest, reportQuerySchema } from '../../../lib/reporting/request.js';
import { getReportingProvider } from '../../../lib/reporting/index.js';
import { attachLabels } from '../../../lib/reporting/labels.js';
import { networkTimeZone } from '../../../lib/reporting/network-zone.js';
import type { ReportFilters, ReportRow } from '../../../lib/reporting/types.js';
import { requireRole } from '../auth.js';
import { applicationById, decideApplication, pendingApplicationsFor } from '../offer-applications/routes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, like 2026-10-01');
const rangeQuery = z.object({ from: day.optional(), to: day.optional() });
const METRICS = 'clicks,conversions,payout,revenue,margin,money_by_currency';

/** My users row (the id partners / advertisers point at) — null for a Super Admin support session. */
async function myUserId(req: Request): Promise<string | null> {
  const id = req.identity;
  if (!id || id.surface !== 'dashboard' || id.kind !== 'admin' || id.platformSupport) return null;
  return (await query<{ id: string }>('SELECT id FROM users WHERE network_id = $1 AND auth_user_id::text = $2', [id.networkId, id.userId])).rows[0]?.id ?? null;
}

/** This month so far (the network's time zone) unless a range is given. */
async function range(networkId: string, q: { from?: string; to?: string }) {
  const tz = await networkTimeZone(networkId);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { from: q.from ?? `${today.slice(0, 8)}01`, to: q.to ?? today, tz };
}

const PAGE = 200; // the report API's largest page
const byId = (rows: ReportRow[], dim: string) => new Map(rows.map((row) => [row.dimensions[dim] ?? '', row.metrics]));

/** Rows of the report grouped by `groupBy`, limited to `force` (never empty — an empty id list would mean "everything"). */
async function report(networkId: string, groupBy: 'publisher' | 'advertiser' | 'offer', r: { from: string; to: string; tz: string }, force: ReportFilters): Promise<ReportRow[]> {
  const req = buildReportRequest(networkId, reportQuerySchema.parse({ groupBy, metrics: METRICS, from: r.from, to: r.to, tz: r.tz, limit: PAGE }), 'admin', force);
  return (await attachLabels(networkId, await getReportingProvider().runReport(req))).rows;
}
/** The same grouped by `dim`, for many ids — a page of ids per report. */
async function reportFor(networkId: string, dim: 'publisher' | 'advertiser', ids: string[], r: { from: string; to: string; tz: string }) {
  const out: ReportRow[] = [];
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    out.push(...await report(networkId, dim, r, dim === 'publisher' ? { publisherId: chunk } : { advertiserId: chunk }));
  }
  return byId(out, dim);
}

const LATEST = (where: string) => `
  SELECT c.id, c.created_at, c.status, c.event_name, c.payout::text AS payout, c.revenue::text AS revenue, c.currency, c.country,
         o.id AS offer_id, o.ref AS offer_ref, o.name AS offer_name, p.id AS publisher_id, p.name AS publisher_name
    FROM conversions c JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
    LEFT JOIN publishers p ON p.id = c.publisher_id AND p.network_id = c.network_id
   WHERE c.network_id = $1 AND ${where} AND c.created_at >= now() - interval '30 days'
   ORDER BY c.created_at DESC LIMIT 20`;

export function myRoutes(): Router {
  const r = Router();

  r.get('/summary', asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const me = await myUserId(req);
    if (!me) return sendOk(res, { userId: null, partners: 0, advertisers: 0, pendingApplications: 0 });
    const { rows } = await query<{ partners: number; advertisers: number; pending: number }>(
      `SELECT (SELECT COUNT(*) FROM publishers WHERE network_id = $1 AND partner_manager_id = $2)::int AS partners,
              (SELECT COUNT(*) FROM advertisers WHERE network_id = $1 AND (account_manager_id = $2 OR sales_manager_id = $2))::int AS advertisers,
              (SELECT COUNT(*) FROM offer_publisher_access a JOIN publishers p ON p.id = a.publisher_id AND p.network_id = a.network_id
                WHERE a.network_id = $1 AND p.partner_manager_id = $2 AND a.approval_status = 'pending')::int AS pending`, [nid, me]);
    sendOk(res, { userId: me, partners: rows[0]!.partners, advertisers: rows[0]!.advertisers, pendingApplications: rows[0]!.pending });
  }));

  // ---------- Partners ----------
  r.get('/partners', validateQuery(rangeQuery), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const rg = await range(nid, res.locals.query as z.infer<typeof rangeQuery>);
    const me = await myUserId(req);
    const partners = me ? (await query<{ id: string; ref: string; name: string; status: string; contact_email: string | null; country: string | null; created_at: string }>(
      `SELECT id, ref::text AS ref, name, status, contact_email, country, created_at FROM publishers WHERE network_id = $1 AND partner_manager_id = $2 ORDER BY name LIMIT 1000`, [nid, me])).rows : [];
    const stats = await reportFor(nid, 'publisher', partners.map((p) => p.id), rg);
    sendOk(res, { range: rg, partners: partners.map((p) => ({ ...p, stats: stats.get(p.id) ?? null })) });
  }));

  r.get('/partners/:id', validateQuery(rangeQuery), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const id = req.params.id!;
    const me = await myUserId(req);
    if (!me || !UUID_RE.test(id)) throw notFound('Partner not found');
    const p = (await query(`SELECT id, ref::text AS ref, name, status, contact_email, contact_name, country, website, tier, created_at FROM publishers
      WHERE network_id = $1 AND id = $2 AND partner_manager_id = $3`, [nid, id, me])).rows[0];
    if (!p) throw notFound('Partner not found');
    const rg = await range(nid, res.locals.query as z.infer<typeof rangeQuery>);
    const [offers, totals, latest, applications] = await Promise.all([
      report(nid, 'offer', rg, { publisherId: id }),
      report(nid, 'publisher', rg, { publisherId: id }),
      query(LATEST('c.publisher_id = $2'), [nid, id]),
      pendingApplicationsFor(nid, me).then((all) => all.filter((a) => a.publisherId === id)),
    ]);
    sendOk(res, { range: rg, partner: p, totals: totals[0]?.metrics ?? null, offers, latestConversions: latest.rows, applications });
  }));

  r.get('/offer-applications', asyncHandler(async (req, res) => {
    const me = await myUserId(req);
    sendOk(res, me ? await pendingApplicationsFor(req.scope!.networkId, me) : []);
  }));

  r.post('/offer-applications/:id', requireRole('admin', 'manager', 'affiliate_manager'),
    validateBody(z.object({ status: z.enum(['approved', 'rejected']) }).strict()), asyncHandler(async (req, res) => {
      const nid = req.scope!.networkId;
      const id = req.params.id!;
      const me = await myUserId(req);
      const app = UUID_RE.test(id) ? await applicationById(nid, id) : null;
      // Only an application from a partner I manage.
      if (!me || !app || app.partnerManagerId !== me) throw notFound('Application not found');
      sendOk(res, await decideApplication(req, id, (req.body as { status: 'approved' | 'rejected' }).status));
    }));

  // ---------- Advertisers ----------
  r.get('/advertisers', validateQuery(rangeQuery), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const rg = await range(nid, res.locals.query as z.infer<typeof rangeQuery>);
    const me = await myUserId(req);
    const advertisers = me ? (await query<{ id: string; ref: string; name: string; status: string; contact_email: string | null; default_currency: string | null; offers: number; created_at: string }>(
      `SELECT a.id, a.ref::text AS ref, a.name, a.status, a.contact_email, a.default_currency, a.created_at,
              (SELECT COUNT(*) FROM offers o WHERE o.network_id = a.network_id AND o.advertiser_id = a.id AND o.status <> 'archived')::int AS offers
         FROM advertisers a WHERE a.network_id = $1 AND (a.account_manager_id = $2 OR a.sales_manager_id = $2) ORDER BY a.name LIMIT 1000`, [nid, me])).rows : [];
    const stats = await reportFor(nid, 'advertiser', advertisers.map((a) => a.id), rg);
    sendOk(res, { range: rg, advertisers: advertisers.map((a) => ({ ...a, stats: stats.get(a.id) ?? null })) });
  }));

  r.get('/advertisers/:id', validateQuery(rangeQuery), asyncHandler(async (req, res) => {
    const nid = req.scope!.networkId;
    const id = req.params.id!;
    const me = await myUserId(req);
    if (!me || !UUID_RE.test(id)) throw notFound('Advertiser not found');
    const a = (await query(`SELECT id, ref::text AS ref, name, status, contact_email, default_currency, created_at FROM advertisers
      WHERE network_id = $1 AND id = $2 AND (account_manager_id = $3 OR sales_manager_id = $3)`, [nid, id, me])).rows[0];
    if (!a) throw notFound('Advertiser not found');
    const rg = await range(nid, res.locals.query as z.infer<typeof rangeQuery>);
    const [offerRows, stats, totals, latest] = await Promise.all([
      query<{ id: string; ref: string; name: string; status: string; payout_model: string; currency: string | null }>(
        `SELECT id, ref::text AS ref, name, status, payout_model, currency FROM offers WHERE network_id = $1 AND advertiser_id = $2 AND status <> 'archived' ORDER BY name LIMIT 500`, [nid, id]),
      report(nid, 'offer', rg, { advertiserId: id }),
      report(nid, 'advertiser', rg, { advertiserId: id }),
      query(LATEST('c.advertiser_id = $2'), [nid, id]),
    ]);
    const s = byId(stats, 'offer');
    sendOk(res, { range: rg, advertiser: a, totals: totals[0]?.metrics ?? null, offers: offerRows.rows.map((o) => ({ ...o, stats: s.get(o.id) ?? null })), latestConversions: latest.rows });
  }));

  return r;
}
