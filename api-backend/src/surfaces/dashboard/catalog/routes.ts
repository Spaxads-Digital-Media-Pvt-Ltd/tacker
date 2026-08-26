/**
 * Network-wide catalog + invoices (feature-depth: the top-level section pages that aggregate across
 * offers/publishers, matching the Everflow/Spaxads sidebar). All admin-only, network-scoped, raw
 * joins (read-only lists). Also hosts a network-level postback tester and ledger-derived invoices.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { query } from '../../../lib/db/pool.js';
import { requireRole } from '../auth.js';
import { firePostbackTest, sampleMacros } from '../../../lib/postback/test.js';

export function catalogRoutes(): Router {
  const r = Router();
  const nid = (req: import('express').Request) => req.scope!.networkId;

  r.get('/creatives', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.name, c.type, c.url, c.width, c.height, c.status, c.created_at,
              o.name AS offer_name, o.id AS offer_id
         FROM offer_creatives c JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
        WHERE c.network_id = $1 ORDER BY c.created_at DESC LIMIT 500`, [nid(req)]);
    sendOk(res, rows);
  }));

  r.get('/coupons', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.code, c.discount, c.status, c.publisher_id, c.created_at, o.name AS offer_name, o.id AS offer_id
         FROM offer_coupons c JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
        WHERE c.network_id = $1 ORDER BY c.created_at DESC LIMIT 500`, [nid(req)]);
    sendOk(res, rows);
  }));

  r.get('/deals', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT d.id, d.name, d.deal_type, d.value, d.status, d.created_at, o.name AS offer_name, o.id AS offer_id
         FROM offer_deals d JOIN offers o ON o.id = d.offer_id AND o.network_id = d.network_id
        WHERE d.network_id = $1 ORDER BY d.created_at DESC LIMIT 500`, [nid(req)]);
    sendOk(res, rows);
  }));

  r.get('/access', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT a.id, a.access, a.approval_status, a.payout_override, a.created_at,
              o.id AS offer_id, o.name AS offer_name, o.status AS offer_status,
              p.id AS publisher_id, p.name AS publisher_name
         FROM offer_publisher_access a
         JOIN offers o ON o.id = a.offer_id AND o.network_id = a.network_id
         JOIN publishers p ON p.id = a.publisher_id AND p.network_id = a.network_id
        WHERE a.network_id = $1 ORDER BY a.created_at DESC LIMIT 500`, [nid(req)]);
    sendOk(res, rows);
  }));

  r.get('/postbacks', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT pb.id, pb.url, pb.method, pb.event, pb.status, pb.created_at,
              p.id AS publisher_id, p.name AS publisher_name, o.name AS offer_name
         FROM publisher_postbacks pb
         LEFT JOIN publishers p ON p.id = pb.publisher_id AND p.network_id = pb.network_id
         LEFT JOIN offers o ON o.id = pb.offer_id AND o.network_id = pb.network_id
        WHERE pb.network_id = $1 ORDER BY pb.created_at DESC LIMIT 500`, [nid(req)]);
    sendOk(res, rows);
  }));

  // Network-level postback tester (no publisher context needed — used by the standalone Test page).
  const testSchema = z.object({
    url: z.string().url().max(2000), method: z.enum(['GET', 'POST']).default('GET'),
    country: z.string().max(3).optional(), device: z.string().max(40).optional(),
  });
  r.post('/postbacks/test', requireRole('admin', 'manager'), validateBody(testSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof testSchema>;
    const overrides: Record<string, string> = {};
    if (b.country) { overrides['country'] = b.country; overrides['geo'] = b.country; }
    if (b.device) overrides['device'] = b.device;
    sendOk(res, await firePostbackTest(b.url, b.method, sampleMacros(overrides)));
  }));

  return r;
}

/** Invoices derived from the append-only ledger: advertiser billing + affiliate payable, per account. */
export function invoiceRoutes(): Router {
  const r = Router();
  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const advertisers = await query(
      `SELECT a.account_id AS id, adv.name,
              COALESCE(SUM(a.amount) FILTER (WHERE a.direction = 'debit'),0)::text AS amount,
              a.currency, COUNT(*)::int AS entries
         FROM ledger_entries a
         JOIN advertisers adv ON adv.id = a.account_id AND adv.network_id = a.network_id
        WHERE a.network_id = $1 AND a.account_type = 'advertiser' AND a.status = 'approved'
        GROUP BY a.account_id, adv.name, a.currency ORDER BY 3 DESC`, [networkId]);
    const publishers = await query(
      `SELECT a.account_id AS id, pub.name,
              COALESCE(SUM(CASE WHEN a.direction = 'credit' THEN a.amount ELSE -a.amount END),0)::text AS amount,
              a.currency, COUNT(*)::int AS entries
         FROM ledger_entries a
         JOIN publishers pub ON pub.id = a.account_id AND pub.network_id = a.network_id
        WHERE a.network_id = $1 AND a.account_type = 'publisher' AND a.status = 'approved'
        GROUP BY a.account_id, pub.name, a.currency ORDER BY 3 DESC`, [networkId]);
    sendOk(res, { advertiserBilling: advertisers.rows, affiliatePayable: publishers.rows });
  }));
  return r;
}
