/**
 * Auth provisioning (spec §1A, §3A). Creates Supabase Auth users and stamps the custom claims our
 * surfaces read from the JWT (`kind`, `network_id`, `role`, `owner_id`). Claims live in
 * `app_metadata` — settable ONLY via the service_role key, so a user can never elevate themselves.
 *
 * The DB row (users/publishers/advertisers/platform_admins) and the Auth user are linked via
 * `auth_user_id`. Every human login in the system is minted here.
 */
import { getSupabaseAdmin } from './supabase.js';

export interface ProvisionResult {
  authUserId: string;
}

interface BaseArgs {
  email: string;
  password: string;
}

async function createAuthUser(args: BaseArgs, appMetadata: Record<string, unknown>): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (error) throw new Error(`Auth user creation failed: ${error.message}`);
  const id = data.user?.id;
  if (!id) throw new Error('Auth user creation returned no id');
  return id;
}

/** Platform owner login (spec §3C). Claim: kind=platform_admin, no network. */
export function provisionPlatformAdmin(args: BaseArgs): Promise<string> {
  return createAuthUser(args, { kind: 'platform_admin' });
}

/** Admin (network staff) login. Claims: network_id, kind=admin, role. */
export function provisionAdmin(
  args: BaseArgs & { networkId: string; role: 'admin' | 'manager' | 'finance' | 'read_only' },
): Promise<string> {
  return createAuthUser(args, { kind: 'admin', network_id: args.networkId, role: args.role });
}

/** Portal login for a publisher/advertiser. Claims: network_id, kind, owner_id (their party id). */
export function provisionPortalUser(
  args: BaseArgs & { networkId: string; kind: 'publisher' | 'advertiser'; ownerId: string },
): Promise<string> {
  return createAuthUser(args, {
    kind: args.kind,
    network_id: args.networkId,
    owner_id: args.ownerId,
  });
}
