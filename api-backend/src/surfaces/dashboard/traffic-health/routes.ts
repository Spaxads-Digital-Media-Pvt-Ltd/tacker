/**
 * Traffic Health — aggregates real data the app already has: per-domain assignment counts
 * (offers/smart links), traffic on offers assigned to each domain (clicks/conversions are not
 * tagged with serving hostname — attribution is via offer.tracking_domain_id), and audit-log
 * activity for domain create/delete events. Uptime incidents, reputation blacklists, and tasks
 * remain intentionally out of scope until we have monitoring workers / external integrations.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import type { TrackingDomainRow } from '../../../domain/entities.js';
import { toDTO } from '../tracking-domains/dto.js';

const DOMAIN_TABLE = 'tracking_domains';

function parseRange(from: unknown, to: unknown): { from: string | null; to: string | null } {
  return {
    from: typeof from === 'string' && from ? from : null,
    to: typeof to === 'string' && to ? to : null,
  };
}

async function domainRow(networkId: string, id: string): Promise<TrackingDomainRow | null> {
  const { rows } = await query<TrackingDomainRow>(
    `SELECT * FROM ${DOMAIN_TABLE} WHERE network_id = $1 AND id = $2`, [networkId, id],
  );
  return rows[0] ?? null;
}

/** Traffic + assignment stats for one domain, attributed via offers.tracking_domain_id. */
async function domainStats(networkId: string, domainId: string, from: string | null, to: string | null) {
  const params: unknown[] = [networkId, domainId];
  let clickWhere = `c.network_id = $1 AND o.tracking_domain_id = $2`;
  let convWhere = `conv.network_id = $1 AND o.tracking_domain_id = $2`;
  if (from) { params.push(from); clickWhere += ` AND c.created_at >= $${params.length}`; convWhere += ` AND conv.created_at >= $${params.length}`; }
  if (to) { params.push(to); clickWhere += ` AND c.created_at <= $${params.length}`; convWhere += ` AND conv.created_at <= $${params.length}`; }

  const [assignments, traffic] = await Promise.all([
    query<{ offers: number; smart_links: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM offers WHERE network_id = $1 AND tracking_domain_id = $2) AS offers,
         (SELECT COUNT(*)::int FROM smart_links WHERE network_id = $1 AND tracking_domain_id = $2) AS smart_links`,
      [networkId, domainId],
    ),
    query<{
      partners: number; clicks: number; conversions: number;
      payout: string | null; revenue: string | null;
    }>(
      `SELECT
         (SELECT COUNT(DISTINCT c.publisher_id)::int FROM clicks c
            JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
           WHERE ${clickWhere} AND c.publisher_id IS NOT NULL) AS partners,
         (SELECT COUNT(*)::int FROM clicks c
            JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
           WHERE ${clickWhere}) AS clicks,
         (SELECT COUNT(*)::int FROM conversions conv
            JOIN offers o ON o.id = conv.offer_id AND o.network_id = conv.network_id
           WHERE ${convWhere} AND conv.status = 'approved') AS conversions,
         (SELECT COALESCE(SUM(conv.payout), 0)::text FROM conversions conv
            JOIN offers o ON o.id = conv.offer_id AND o.network_id = conv.network_id
           WHERE ${convWhere} AND conv.status = 'approved') AS payout,
         (SELECT COALESCE(SUM(conv.revenue), 0)::text FROM conversions conv
            JOIN offers o ON o.id = conv.offer_id AND o.network_id = conv.network_id
           WHERE ${convWhere} AND conv.status = 'approved') AS revenue`,
      params,
    ),
  ]);

  const a = assignments.rows[0] ?? { offers: 0, smart_links: 0 };
  const t = traffic.rows[0] ?? { partners: 0, clicks: 0, conversions: 0, payout: '0', revenue: '0' };
  const payout = Number(t.payout ?? 0);
  const revenue = Number(t.revenue ?? 0);
  const profit = revenue - payout;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;
  const rpc = t.clicks > 0 ? revenue / t.clicks : null;

  return {
    offersAssigned: a.offers,
    smartLinksAssigned: a.smart_links,
    partnersUsing: t.partners,
    clicks: t.clicks,
    conversions: t.conversions,
    payout, revenue, profit, margin, rpc,
    attributionNote: 'Traffic is attributed via offers assigned to this domain (clicks are not tagged with serving hostname).',
  };
}

export function trafficHealthRoutes(): Router {
  const r = Router();

  /** Per-domain usage table for the Usage tab — real assignment + offer-attributed traffic. */
  r.get('/usage', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { from, to } = parseRange(req.query['from'], req.query['to']);
    const { rows: domains } = await query<{ id: string; host: string; ref: string }>(
      `SELECT id, host, ref FROM ${DOMAIN_TABLE} WHERE network_id = $1 ORDER BY ref ASC`, [networkId],
    );
    const rows = await Promise.all(domains.map(async (d) => {
      const stats = await domainStats(networkId, d.id, from, to);
      return {
        domainId: d.id, host: d.host, ref: Number(d.ref),
        partnersUsing: stats.partnersUsing,
        offersAssigned: stats.offersAssigned,
        clicks: stats.clicks,
        conversions: stats.conversions,
        rpc: stats.rpc,
        payout: stats.payout,
        revenue: stats.revenue,
        profit: stats.profit,
        margin: stats.margin,
      };
    }));
    sendOk(res, { from, to, rows });
  }));

  /** Domain detail summary — assignments + traffic for Overview panel Usage section. */
  r.get('/domains/:id/summary', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const row = await domainRow(networkId, req.params.id ?? '');
    if (!row) throw notFound('Domain not found');
    const { from, to } = parseRange(req.query['from'], req.query['to']);
    const stats = await domainStats(networkId, row.id, from, to);
    sendOk(res, { domain: toDTO(row), ...stats });
  }));

  /** All Activity tab — real audit-log entries for this tracking domain. */
  r.get('/domains/:id/activity', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const domainId = req.params.id ?? '';
    const row = await domainRow(networkId, domainId);
    if (!row) throw notFound('Domain not found');
    const { from, to } = parseRange(req.query['from'], req.query['to']);
    const params: unknown[] = [networkId, domainId];
    let where = `network_id = $1 AND entity_type = 'tracking_domain' AND entity_id = $2`;
    if (from) { params.push(from); where += ` AND created_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND created_at <= $${params.length}`; }
    const { rows } = await query<{
      id: string; action: string; created_at: string; actor_type: string; actor_id: string | null;
    }>(
      `SELECT id, action, created_at, actor_type, actor_id FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    sendOk(res, rows.map((e) => ({
      id: e.id,
      action: e.action,
      createdAt: e.created_at,
      actorType: e.actor_type,
      actorId: e.actor_id,
      label: e.action.replace('tracking_domain.', '').replace('_', ' '),
    })));
  }));

  /** Set the network's primary tracking domain (Configurations › Default Tracking Domain). */
  r.patch('/domains/:id/primary', requireRole('admin', 'manager'), validateBody(z.object({ isPrimary: z.literal(true) })), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const domainId = req.params.id ?? '';
    const existing = await db.selectOne<TrackingDomainRow>(DOMAIN_TABLE, { id: domainId });
    if (!existing) throw notFound('Domain not found');
    await db.update(DOMAIN_TABLE, { is_primary: false }, { is_primary: true });
    const [updated] = await db.update<TrackingDomainRow>(DOMAIN_TABLE, { is_primary: true }, { id: domainId });
    await writeAudit(req, { action: 'tracking_domain.update', entityType: 'tracking_domain', entityId: domainId, after: updated });
    sendOk(res, toDTO(updated!));
  }));

  return r;
}
