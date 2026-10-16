/**
 * Create a tenant network — the onboarding entry point (Super Admin › Networks › New network, and a sales
 * lead's "Convert to customer"): the network with its postback secure code (/postback fails closed without
 * one), optionally its `<slug>.<TRACKING_BASE_DOMAIN>` tracking host, and optionally its first admin (the
 * owner) — a Supabase login with a password someone else chose, so they choose their own at first sign-in.
 */
import { pool } from '../db/pool.js';
import { env } from '../../config/env.js';
import { AppError, badRequest } from '../http/errors.js';
import { provisionAdmin, AuthProvisionError } from '../provisioning.js';
import { generateSecureCode } from '../security-code.js';

export interface NewNetwork {
  name: string;
  slug: string;
  defaultCurrency: string;
  provisionSubdomain: boolean;
  owner?: { email: string; password: string; name?: string | undefined } | undefined;
  /** Platform team links (Super Admin roles with 'assigned' scope see the networks they sold / manage). */
  salesOwnerId?: string | null;
  accountManagerId?: string | null;
}

const emailTaken = (err: AuthProvisionError) => err.code === 'email_exists' || /already (been )?registered/i.test(err.message);

export async function createNetwork(b: NewNetwork): Promise<{ network: Record<string, unknown> & { id: string; name: string; slug: string }; ownerUserId: string | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const network = (await client.query<Record<string, unknown> & { id: string; name: string; slug: string }>(
      `INSERT INTO networks (name, slug, default_currency, postback_security_code, sales_owner_id, account_manager_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.name, b.slug, b.defaultCurrency, generateSecureCode(), b.salesOwnerId ?? null, b.accountManagerId ?? null],
    )).rows[0]!;

    if (b.provisionSubdomain) {
      await client.query(
        `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
         VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued', true)`,
        [network.id, `${b.slug}.${env.TRACKING_BASE_DOMAIN}`],
      );
    }

    let ownerUserId: string | null = null;
    if (b.owner) {
      // The Supabase login first (it can't roll back with the transaction, but a dangling auth user is
      // harmless and re-runnable), then the users row.
      let authUserId: string;
      try {
        authUserId = await provisionAdmin({ email: b.owner.email, password: b.owner.password, networkId: network.id, role: 'admin', mustChangePassword: true });
      } catch (err) {
        if (err instanceof AuthProvisionError && emailTaken(err)) {
          throw new AppError('conflict', `${b.owner.email} already has a login — use a different email for the network's owner.`, { reason: 'email_in_use' });
        }
        throw err;
      }
      ownerUserId = (await client.query<{ id: string }>(
        `INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, $4, 'admin', 'active') RETURNING id`,
        [network.id, authUserId, b.owner.email, b.owner.name ?? null],
      )).rows[0]!.id;
    }

    await client.query('COMMIT');
    return { network, ownerUserId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((err as { code?: string }).code === '23505') throw badRequest(`A network with the slug "${b.slug}" already exists — choose another.`);
    throw err;
  } finally {
    client.release();
  }
}
