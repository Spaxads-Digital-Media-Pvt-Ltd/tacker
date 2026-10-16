/**
 * Supabase Admin client (spec §2) — uses the SERVICE_ROLE key and therefore lives ONLY here,
 * server-side. NEVER import this from anything that could reach the browser. Used for Auth user
 * provisioning (creating login-able users + stamping their JWT claims).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { serviceUnavailable } from './http/errors.js';

let admin: SupabaseClient | null = null;

/** Sign-in can't work without the Supabase project's URL and service-role key: say so (503), rather
 *  than a bare "Internal server error" on the login page. */
const notConfigured = () => serviceUnavailable(
  'Sign-in isn’t set up on this server: the Supabase project URL and service-role key are missing (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');

export function getSupabaseAdmin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw notConfigured();
  if (!admin) {
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/**
 * A throwaway client for ONE user-scoped auth call (redeeming a password-reset link): verifyOtp
 * keeps the user's session on the client it runs on, so it never runs on the shared admin client.
 */
export function createEphemeralAuthClient(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw notConfigured();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
