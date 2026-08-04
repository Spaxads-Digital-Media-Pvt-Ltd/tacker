/**
 * Supabase Admin client (spec §2) — uses the SERVICE_ROLE key and therefore lives ONLY here,
 * server-side. NEVER import this from anything that could reach the browser. Used for Auth user
 * provisioning (creating login-able users + stamping their JWT claims).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!admin) {
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
