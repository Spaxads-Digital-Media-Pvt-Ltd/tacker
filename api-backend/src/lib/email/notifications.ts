/**
 * Partner-facing system emails (O11) — the Communication Hub toggles that now send:
 *   partner_signup_approved / _rejected     a pending partner is approved (→ active) or rejected (→ inactive)
 *   offer_application_approved / _denied    an offer application is decided
 *   partner_offer_now_available / _unavailable
 *                                           an offer goes live again / is paused or archived (to the
 *                                           partners running it), or one partner is given / loses access
 *   new_offer_creative_available            a creative is added to an offer (to the partners running it)
 *   payout_batch_completed                  a payout run (or a paid partner invoice) paid a partner
 *
 * "The partners running an offer" = active partners with an email who were explicitly given access
 * (allowed / approved) or sent it clicks in the last 30 days — minus anyone blocked on it. Each email
 * honours its toggle and goes through the email queue. These run after the action that triggered them
 * and never fail it (`notify` logs problems); callers don't await the bigger fan-outs.
 */
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { appUrl } from '../app-url.js';
import { networkName, sendTransactionalEach, type TransactionalResult } from './transactional.js';
import type { SystemEmailKey } from './system-emails.js';
import {
  signupDecisionEmail, offerApplicationEmail, offerAvailabilityEmail, newCreativeEmail, payoutSentEmail,
} from './templates.js';

/** Most partners a single notification reaches (a guard against an accidental mass mailing). */
export const AUDIENCE_CAP = 2000;

export interface Partner { id: string; name: string; email: string | null }

const loginUrl = () => appUrl('/login');

/** Run a notification without ever failing the caller; resolves to its outcome (null on error). */
export async function notify(what: string, fn: () => Promise<TransactionalResult | null>): Promise<TransactionalResult | null> {
  try {
    const r = await fn();
    if (r && !r.sent && r.skipped !== 'disabled' && r.skipped !== 'no_recipients') {
      logger.info({ what, skipped: r.skipped, reason: r.reason }, 'notification email not sent');
    }
    return r;
  } catch (err) {
    logger.warn({ err, what }, 'notification email failed');
    return null;
  }
}

async function partners(networkId: string, ids: string[]): Promise<Partner[]> {
  if (!ids.length) return [];
  const { rows } = await query<{ id: string; name: string; contact_email: string | null }>(
    `SELECT id, name, contact_email FROM publishers WHERE network_id = $1 AND id = ANY($2::uuid[])`, [networkId, ids]);
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.contact_email }));
}

async function offerName(networkId: string, offerId: string): Promise<string | null> {
  const { rows } = await query<{ name: string }>('SELECT name FROM offers WHERE network_id = $1 AND id = $2', [networkId, offerId]);
  return rows[0]?.name ?? null;
}

/** The active partners running an offer (see the header). */
export async function offerAudience(networkId: string, offerId: string): Promise<Partner[]> {
  const { rows } = await query<{ id: string; name: string; contact_email: string | null }>(
    `WITH recent AS (
       SELECT DISTINCT publisher_id FROM stats_clicks_15m
        WHERE network_id = $1 AND offer_id = $2 AND publisher_id IS NOT NULL AND bucket >= now() - interval '30 days'
     ), access AS (
       SELECT publisher_id, access, approval_status FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2
     )
     SELECT p.id, p.name, p.contact_email
       FROM publishers p
      WHERE p.network_id = $1 AND p.status = 'active' AND COALESCE(p.contact_email, '') <> ''
        AND (p.id IN (SELECT publisher_id FROM recent)
             OR p.id IN (SELECT publisher_id FROM access WHERE access = 'allow' OR approval_status = 'approved'))
        AND p.id NOT IN (SELECT publisher_id FROM access WHERE access = 'deny')
      ORDER BY p.name
      LIMIT ${AUDIENCE_CAP + 1}`,
    [networkId, offerId],
  );
  if (rows.length > AUDIENCE_CAP) logger.warn({ networkId, offerId, cap: AUDIENCE_CAP }, 'offer audience capped');
  return rows.slice(0, AUDIENCE_CAP).map((r) => ({ id: r.id, name: r.name, email: r.contact_email }));
}

/** A pending partner was approved (→ active) or rejected (→ inactive). */
export function notifySignupDecision(networkId: string, partner: Partner, approved: boolean): Promise<TransactionalResult | null> {
  const key: SystemEmailKey = approved ? 'partner_signup_approved' : 'partner_signup_rejected';
  return notify(key, async () => {
    const net = await networkName(networkId);
    return sendTransactionalEach(networkId, key, [partner], (name) =>
      signupDecisionEmail({ networkName: net, partnerName: name, approved, loginUrl: loginUrl() }));
  });
}

/** An offer application was approved or denied. */
export function notifyOfferApplication(networkId: string, publisherId: string, offerId: string, approved: boolean): Promise<TransactionalResult | null> {
  const key: SystemEmailKey = approved ? 'offer_application_approved' : 'offer_application_denied';
  return notify(key, async () => {
    const [net, offer, people] = await Promise.all([networkName(networkId), offerName(networkId, offerId), partners(networkId, [publisherId])]);
    if (!offer) return null;
    return sendTransactionalEach(networkId, key, people, (name) =>
      offerApplicationEmail({ networkName: net, partnerName: name, offerName: offer, approved, loginUrl: loginUrl() }));
  });
}

/**
 * An offer became available / unavailable — to the partners running it, or (`publisherIds`) to the
 * partners whose own access changed.
 */
export function notifyOfferAvailability(
  networkId: string, offerId: string, available: boolean, opts: { publisherIds?: string[] } = {},
): Promise<TransactionalResult | null> {
  const key: SystemEmailKey = available ? 'partner_offer_now_available' : 'partner_offer_now_unavailable';
  return notify(key, async () => {
    const [net, offer] = await Promise.all([networkName(networkId), offerName(networkId, offerId)]);
    if (!offer) return null;
    const people = opts.publisherIds ? await partners(networkId, opts.publisherIds) : await offerAudience(networkId, offerId);
    return sendTransactionalEach(networkId, key, people, (name) =>
      offerAvailabilityEmail({ networkName: net, partnerName: name, offerName: offer, available, loginUrl: loginUrl() }));
  });
}

/** A creative was added to an offer. */
export function notifyNewCreative(networkId: string, offerId: string, creativeName: string): Promise<TransactionalResult | null> {
  return notify('new_offer_creative_available', async () => {
    const [net, offer, people] = await Promise.all([networkName(networkId), offerName(networkId, offerId), offerAudience(networkId, offerId)]);
    if (!offer) return null;
    return sendTransactionalEach(networkId, 'new_offer_creative_available', people, (name) =>
      newCreativeEmail({ networkName: net, partnerName: name, offerName: offer, creativeName, loginUrl: loginUrl() }));
  });
}

/** A payout paid partners — each gets their own amount. `reference` e.g. "Partner invoice #12". */
export function notifyPayoutSent(
  networkId: string, lines: { publisherId: string; amount: string }[], currency: string, reference: string | null = null,
): Promise<TransactionalResult | null> {
  return notify('payout_batch_completed', async () => {
    if (!lines.length) return null;
    const [net, people] = await Promise.all([networkName(networkId), partners(networkId, lines.map((l) => l.publisherId))]);
    const amountOf = new Map(lines.map((l) => [l.publisherId, l.amount]));
    // One email per partner with their own line — rendered per person below.
    let last: TransactionalResult | null = null;
    for (const p of people) {
      last = await sendTransactionalEach(networkId, 'payout_batch_completed', [p], (name) =>
        payoutSentEmail({ networkName: net, partnerName: name, amount: amountOf.get(p.id) ?? '0.0000', currency, reference, loginUrl: loginUrl() }));
      if (last.skipped === 'disabled' || last.skipped === 'smtp_not_configured') break;
    }
    return last;
  });
}

/**
 * An offer's status changed (an edit, an archive, a scheduled action): going live tells its partners
 * it's available; pausing or archiving a live offer tells them it isn't. Fire-and-forget.
 */
export function offerStatusChanged(networkId: string, offerId: string, before: string, after: string): void {
  if (before === after) return;
  if (after === 'active') void notifyOfferAvailability(networkId, offerId, true);
  else if (before === 'active' && (after === 'paused' || after === 'archived')) void notifyOfferAvailability(networkId, offerId, false);
}

/**
 * One partner's own access to an offer changed. Only real changes are emailed:
 *  - given access (allowed / approved) where it opens something — a private or approval-required
 *    offer, or a partner who was blocked → Partner Offer Now Available;
 *  - blocked, if they were actually running it (had access, or sent it clicks in the last 30 days)
 *    → Partner Offer Now Unavailable.
 * `was` is their access entry before (null = none). Fire-and-forget.
 */
export function offerAccessChanged(
  networkId: string, offerId: string, publisherIds: string[],
  was: { access: string; approval_status: string } | null, now: { access: string; approval_status: string },
): void {
  const open = (x: { access: string; approval_status: string } | null) => !!x && x.access !== 'deny' && (x.access === 'allow' || x.approval_status === 'approved');
  const blocked = (x: { access: string } | null) => x?.access === 'deny';
  void (async () => {
    try {
      const offer = (await query<{ visibility: string | null; status: string }>(
        'SELECT visibility, status FROM offers WHERE network_id = $1 AND id = $2', [networkId, offerId])).rows[0];
      if (!offer || offer.status !== 'active') return; // nothing to run either way
      if (open(now) && !open(was)) {
        if ((offer.visibility ?? 'public') !== 'public' || blocked(was)) await notifyOfferAvailability(networkId, offerId, true, { publisherIds });
      } else if (blocked(now) && !blocked(was)) {
        const ran = open(was) || (await recentClickers(networkId, offerId, publisherIds)).length > 0;
        if (ran) await notifyOfferAvailability(networkId, offerId, false, { publisherIds });
      }
    } catch (err) {
      logger.warn({ err, networkId, offerId }, 'offer access notification failed');
    }
  })();
}

/** Which of these partners sent the offer clicks in the last 30 days (rollups). */
async function recentClickers(networkId: string, offerId: string, publisherIds: string[]): Promise<string[]> {
  const { rows } = await query<{ publisher_id: string }>(
    `SELECT DISTINCT publisher_id FROM stats_clicks_15m
      WHERE network_id = $1 AND offer_id = $2 AND publisher_id = ANY($3::uuid[]) AND bucket >= now() - interval '30 days'`,
    [networkId, offerId, publisherIds]);
  return rows.map((r) => r.publisher_id);
}

/** A creative partners can see: active (not paused) and not hidden from partners. */
export const creativeIsPartnerVisible = (row: { status?: unknown; visible_to_partners?: unknown }): boolean =>
  row.status !== 'inactive' && row.status !== 'paused' && row.visible_to_partners !== false;
