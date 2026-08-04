/**
 * Auth endpoints for the SPA (spec §2). The browser NEVER talks to Supabase directly — it posts
 * credentials here and the backend exchanges them for a JWT via Supabase Auth (service-role admin
 * client). This keeps every Supabase interaction server-side and the anon key out of the frontend.
 *
 * Token model:
 *   - access token: returned in the JSON body; the SPA holds it and sends it as a Bearer.
 *   - refresh token: stored in an httpOnly, sameSite cookie (NOT readable by JS → XSS-safe) and
 *     exchanged at /api/auth/refresh for a fresh access token when the old one expires.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Session, User } from '@supabase/supabase-js';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateBody } from '../../lib/http/validate.js';
import { unauthorized } from '../../lib/http/errors.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';
import { isProd } from '../../config/env.js';

const REFRESH_COOKIE = 'tracker_rt';
const COOKIE_PATH = '/api/auth';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function identityFrom(user: User, fallbackEmail: string) {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const umeta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const email = user.email ?? fallbackEmail;
  return {
    kind: String(meta['kind'] ?? 'admin'),
    networkId: meta['network_id'] ? String(meta['network_id']) : null,
    role: meta['role'] ? String(meta['role']) : null,
    ownerId: meta['owner_id'] ? String(meta['owner_id']) : null,
    email,
    // Display name for the SPA topbar — prefer the stored name, else the email local-part.
    name: umeta['name'] ? String(umeta['name']) : (email.split('@')[0] ?? email),
    // Per-user UI accent theme (Section 6); default Theme A (Indigo).
    theme: umeta['theme'] ? String(umeta['theme']) : 'A',
  };
}

function respondWithSession(res: Response, session: Session, user: User, fallbackEmail: string): void {
  setRefreshCookie(res, session.refresh_token);
  sendOk(res, {
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? null,
    identity: identityFrom(user, fallbackEmail),
  });
}

export function authRoutes(): Router {
  const r = Router();

  r.post(
    '/login',
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof loginSchema>;
      const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) throw unauthorized('Invalid email or password.');
      respondWithSession(res, data.session, data.user, email);
    }),
  );

  // Exchange the httpOnly refresh cookie for a fresh access token (rotates the cookie).
  r.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
      if (!refreshToken) throw unauthorized('No refresh token.');
      const { data, error } = await getSupabaseAdmin().auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session || !data.user) {
        res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
        throw unauthorized('Session expired. Please sign in again.');
      }
      respondWithSession(res, data.session, data.user, data.user.email ?? '');
    }),
  );

  r.post('/logout', (_req, res) => {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    sendOk(res, { ok: true });
  });

  return r;
}
