/** Mint dashboard JWTs the way Supabase Auth would, signed with SUPABASE_JWT_SECRET, for tests. */
import jwt from 'jsonwebtoken';

const secret = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod';

export function operatorToken(opts: { userId: string; networkId: string; role?: string }): string {
  return jwt.sign(
    { sub: opts.userId, network_id: opts.networkId, kind: 'operator', role: opts.role ?? 'admin' },
    secret,
    { expiresIn: '1h' },
  );
}

export function portalToken(opts: {
  userId: string;
  networkId: string;
  kind: 'publisher' | 'advertiser';
  ownerId: string;
}): string {
  return jwt.sign(
    { sub: opts.userId, network_id: opts.networkId, kind: opts.kind, owner_id: opts.ownerId },
    secret,
    { expiresIn: '1h' },
  );
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
