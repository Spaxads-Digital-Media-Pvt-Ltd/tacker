/**
 * Partner self-serve sign-up (audit F-04) and "Request a demo" (POST /api/signup/demo, a lead for the
 * platform's sales team) — the unauthenticated writes on the dashboard surface, mounted at /api/signup
 * before the auth gate.
 *
 * POST /api/signup/partner { network: <network slug>, name, email, ... } creates a partner in that
 * network — status 'pending' (it lands in Partners › Pending for review), or 'active' when the
 * network turned on Control Center › Partners › Sign Up › Auto Approve Partners — and provisions its
 * portal login: a temporary password emailed to `email` (lib/portal-invite.ts). The applicant never
 * picks a password here; only the inbox owner receives one, so nobody can sign up as a well-known
 * affiliate's address and then sign in as them. A pending partner can sign in but can't earn (the
 * partner-status check at click time, F-08).
 *
 * POST /api/signup/advertiser does the same for an advertiser (pending, or active with Control Center ›
 * Advertisers › Sign Up › Auto Approve Advertisers). Each kind is open or closed per network (Control
 * Center › Platform › "Show … Sign Up link": partner open by default, advertiser closed) — closed → 403
 * signup_closed. GET /api/signup/network/:slug tells the sign-up and login pages the network's name, logo
 * and which sign-ups are open.
 *
 * Network: by slug in the body (the dashboard is one origin for every network, so the Host header
 * can't tell them apart). Abuse: per-IP limit (production only, like the tracking endpoints); one
 * sign-up per email — the same 409 whether the email is a partner here or a login anywhere, and the
 * email never echoes what the form typed.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { AppError, notFound, serviceUnavailable, tooMany } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { ScopedDb } from '../../../lib/db/scoped-db.js';
import { env } from '../../../config/env.js';
import { checkTrackingRateLimit } from '../../../lib/tracking-rate-limit.js';
import { requireAuthAdmin } from '../../../lib/provisioning.js';
import { invitePortalUser, inviteAuditView, type PortalInviteResult } from '../../../lib/portal-invite.js';
import { getControlCenterConfig, networkBranding, signupOpen, type SignupKind } from '../control-center/config.js';
import { createInboundLead } from '../../../lib/platform/sales.js';
import { notifyLeadInbound } from '../../../lib/platform/notify.js';
import type { AdvertiserRow, PublisherRow } from '../../../domain/entities.js';

/**
 * Per-IP sign-up budget on the shared sliding-window limiter, which weighs a request more the more
 * recent it is: 15 allows a burst of 3 sign-ups in a minute and about one a minute sustained.
 */
const SIGNUP_LIMIT = 15;

const signupSchema = z.object({
  network: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  contactName: z.string().trim().max(200).optional(),
  website: z.string().trim().max(300).optional(),
  trafficSource: z.string().trim().max(200).optional(),
  country: z.string().trim().max(100).optional(),
});
type SignupBody = z.infer<typeof signupSchema>;

const demoSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  company: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  website: z.string().trim().max(300).optional(),
  country: z.string().trim().max(100).optional(),
  monthlyClicks: z.number().int().min(0).max(1e12).optional(),
  message: z.string().trim().max(3000).optional(),
  website_url: z.string().max(300).optional(),
}).strict();

const alreadyRegistered = () => new AppError(
  'conflict', 'This email is already registered. Sign in instead, or ask the network for an invite.', { reason: 'already_registered' },
);

async function writeSignupAudit(networkId: string, entity: 'publisher' | 'advertiser', id: string, after: unknown, ip: string | null, userAgent: string | null): Promise<void> {
  try {
    await ScopedDb.forNetwork(networkId).insert('audit_log', {
      actor_type: 'system', actor_id: null, action: `${entity}.signup`,
      entity_type: entity, entity_id: id,
      before: null, after: JSON.stringify(after), ip, user_agent: userAgent,
    });
  } catch {
    // Auditing must never break the request it records (same rule as writeAudit).
  }
}

export function signupRoutes(): Router {
  const r = Router();

  /** The network a sign-up names, if it is active (else 404 — an unknown and a suspended one look alike). */
  async function signupNetwork(slug: string): Promise<{ id: string; name: string; settings: Record<string, unknown> }> {
    const { rows } = await query<{ id: string; name: string; status: string; settings: Record<string, unknown> }>(
      'SELECT id, name, status, settings FROM networks WHERE slug = $1', [slug.trim().toLowerCase()]);
    const net = rows[0];
    if (!net || net.status !== 'active') throw notFound('Unknown network.');
    return { id: net.id, name: net.name, settings: net.settings ?? {} };
  }

  // Public: what the sign-up / login pages need to know about a network (never more).
  r.get('/network/:slug', asyncHandler(async (req, res) => {
    const net = await signupNetwork(req.params.slug ?? '');
    const branding = await networkBranding(net.id);
    sendOk(res, {
      name: net.name, logoUrl: branding.logoUrl,
      partnerSignup: signupOpen(net.settings, 'partner'), advertiserSignup: signupOpen(net.settings, 'advertiser'),
    });
  }));

  const signup = (kind: SignupKind) => asyncHandler(async (req, res) => {
    const ip = typeof req.ip === 'string' ? req.ip : (req.socket?.remoteAddress ?? 'unknown');
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      const rl = await checkTrackingRateLimit(ip, 'signup', SIGNUP_LIMIT);
      if (rl.limited) throw tooMany('Too many sign-ups from this network. Try again in a minute.', { retryAfter: rl.retryAfterSeconds });
    }

    const b = req.body as SignupBody;
    const email = b.email.toLowerCase();
    const net = await signupNetwork(b.network);
    if (!signupOpen(net.settings, kind)) {
      throw new AppError('forbidden', `${net.name} isn't taking ${kind} sign-ups right now. Ask the network for an invite.`, { reason: 'signup_closed' });
    }

    // No login can be made without Supabase Auth — don't create an account that could never sign in.
    try {
      requireAuthAdmin();
    } catch {
      throw serviceUnavailable('Sign-up is temporarily unavailable. Please try again later.');
    }

    const table = kind === 'partner' ? 'publishers' : 'advertisers';
    const { rows: dupes } = await query(
      `SELECT 1 FROM ${table} WHERE network_id = $1 AND lower(contact_email) = $2 LIMIT 1`, [net.id, email],
    );
    if (dupes.length) throw alreadyRegistered();

    const cfg = getControlCenterConfig(net.settings, kind === 'partner' ? 'partners' : 'advertisers')['signup'] as Record<string, unknown> | undefined;
    const status: 'pending' | 'active' = cfg?.[kind === 'partner' ? 'autoApprovePartners' : 'autoApproveAdvertisers'] === true ? 'active' : 'pending';
    const db = ScopedDb.forNetwork(net.id);
    const userAgent = req.get('user-agent') ?? null;
    const signupMeta = { at: new Date().toISOString(), ip, userAgent };
    const row = kind === 'partner'
      ? await db.insert<PublisherRow>('publishers', {
        name: b.name, status, contact_email: email, contact_name: b.contactName || null,
        website: b.website || null, traffic_source: b.trafficSource || null, country: b.country || null,
        metadata: { signup: signupMeta },
      })
      : await db.insert<AdvertiserRow>('advertisers', {
        name: b.name, status, contact_email: email,
        metadata: { signup: signupMeta, contactName: b.contactName || null, website: b.website || null, country: b.country || null },
      });

    let invite: PortalInviteResult;
    try {
      invite = await invitePortalUser({
        networkId: net.id, kind: kind === 'partner' ? 'publisher' : 'advertiser', ownerId: row.id, email, linkedAuthUserId: null, signup: status,
      });
    } catch (err) {
      // No login → no account: the applicant can simply try again (or sign in, if it's theirs).
      await db.delete(table, { id: row.id });
      if (err instanceof AppError && err.code === 'conflict') throw alreadyRegistered();
      if (err instanceof AppError && err.code === 'service_unavailable') throw serviceUnavailable('Sign-up is temporarily unavailable. Please try again later.');
      throw err;
    }

    await writeSignupAudit(net.id, kind === 'partner' ? 'publisher' : 'advertiser', row.id, { name: row.name, status, ...inviteAuditView(invite) }, req.ip ?? null, userAgent);
    sendOk(res, {
      status,
      emailed: invite.emailed,
      message: invite.outcome === 'linked'
        ? 'Your account is ready — sign in with your existing password.'
        : invite.emailed
          ? 'Check your email for your login details.'
          : 'Your application was received. The network will send your login details.',
      ...(invite.credentials ? { credentials: invite.credentials } : {}),
    }, undefined, 201);
  });

  r.post('/partner', validateBody(signupSchema), signup('partner'));
  r.post('/advertiser', validateBody(signupSchema), signup('advertiser'));

  // "Request a demo" — a prospective network asking the platform's sales team for a call. It becomes a lead in
  // Super Admin › Sales, routed to a Sales member with a follow-up task (lib/platform/sales.ts). `website_url`
  // is a honeypot: people never see it, so a filled one is a bot — answered like a success, nothing stored.
  r.post('/demo', validateBody(demoSchema), asyncHandler(async (req, res) => {
    const ip = typeof req.ip === 'string' ? req.ip : (req.socket?.remoteAddress ?? 'unknown');
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      const rl = await checkTrackingRateLimit(ip, 'demo_request', SIGNUP_LIMIT);
      if (rl.limited) throw tooMany('Too many requests from this network. Try again in a minute.', { retryAfter: rl.retryAfterSeconds });
    }
    const b = req.body as z.infer<typeof demoSchema>;
    const thanks = 'Thanks — our team will contact you within one business day.';
    if (b.website_url) return sendOk(res, { received: true, message: thanks }, undefined, 201);
    const lead = await createInboundLead({
      company: b.company, contactName: b.name, email: b.email, phone: b.phone || null, website: b.website || null,
      country: b.country || null, monthlyClicks: b.monthlyClicks ?? null, message: b.message || null,
    });
    if (!lead.duplicate) void notifyLeadInbound(lead.leadId);
    return sendOk(res, { received: true, message: thanks }, undefined, 201);
  }));

  return r;
}
