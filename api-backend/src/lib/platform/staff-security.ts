/**
 * Platform staff security — sign-in history, sessions, the IP allowlist and the staff notification bell.
 *
 * - Every sign-in attempt is recorded (platform_login_events) with its address, browser and outcome.
 * - Every issued token is a session (platform_sessions, the token's `jti`): the auth gate refuses one that
 *   was revoked ("Sign out" / "Sign out everywhere") or has expired; last_seen_at is refreshed at most once
 *   a minute.
 * - The IP allowlist (Settings › Security, platform_settings 'security'.ipAllowlist — addresses and CIDR
 *   ranges): when set, signing in and every request must come from it. Saving a list that leaves out the
 *   address you're saving from is refused, so an Owner can't lock the team out.
 * - The bell (platform_notifications): in-app notices for the member a ticket, reply, lead or task is for.
 */
import { BlockList, isIP } from 'node:net';
import { query } from '../db/pool.js';
import { logger } from '../logger.js';

export type LoginOutcome = 'success' | 'bad_password' | 'unknown_email' | 'disabled' | 'blocked_ip' | 'mfa_required' | 'mfa_failed' | 'locked';

/** A token's lifetime — the session expires with it. */
export const SESSION_TTL_MS = 60 * 60 * 1000;

const normalizeIp = (ip: string | null | undefined): string | null => {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/, '');
  return isIP(v) ? v : null;
};

export async function recordLogin(e: { adminId?: string | null; email?: string | null; ip?: string | null; userAgent?: string | null; outcome: LoginOutcome }): Promise<void> {
  try {
    await query('INSERT INTO platform_login_events (admin_id, email, ip, user_agent, outcome) VALUES ($1, $2, $3, $4, $5)',
      [e.adminId ?? null, e.email?.toLowerCase() ?? null, normalizeIp(e.ip), (e.userAgent ?? '').slice(0, 400) || null, e.outcome]);
  } catch (err) {
    logger.warn({ err }, 'platform sign-in event not recorded'); // never blocks a sign-in
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(id: string, adminId: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<void> {
  await query('INSERT INTO platform_sessions (id, admin_id, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [id, adminId, normalizeIp(meta.ip), (meta.userAgent ?? '').slice(0, 400) || null, new Date(Date.now() + SESSION_TTL_MS)]);
}

/** Is this session live for this member? Refreshes last_seen_at (at most once a minute). */
export async function sessionIsLive(id: string, adminId: string): Promise<boolean> {
  const { rows } = await query<{ ok: boolean }>(
    `UPDATE platform_sessions SET last_seen_at = CASE WHEN last_seen_at < now() - interval '1 minute' THEN now() ELSE last_seen_at END
      WHERE id = $1 AND admin_id = $2 AND revoked_at IS NULL AND expires_at > now() RETURNING true AS ok`, [id, adminId]);
  return rows[0]?.ok === true;
}

export async function revokeSessions(adminId: string, opts: { sessionId?: string; exceptId?: string; by: string | null }): Promise<number> {
  const params: unknown[] = [adminId, opts.by];
  let where = 'admin_id = $1 AND revoked_at IS NULL AND expires_at > now()';
  if (opts.sessionId) { params.push(opts.sessionId); where += ` AND id = $${params.length}`; }
  if (opts.exceptId) { params.push(opts.exceptId); where += ` AND id <> $${params.length}`; }
  return (await query(`UPDATE platform_sessions SET revoked_at = now(), revoked_by = $2 WHERE ${where}`, params)).rowCount ?? 0;
}

export async function listSessions(adminId: string) {
  return (await query<{ id: string; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string; revoked_at: string | null }>(
    `SELECT id, host(ip) AS ip, user_agent, created_at, last_seen_at, expires_at, revoked_at FROM platform_sessions
      WHERE admin_id = $1 AND (revoked_at IS NULL AND expires_at > now() OR created_at > now() - interval '7 days')
      ORDER BY (revoked_at IS NULL AND expires_at > now()) DESC, last_seen_at DESC LIMIT 50`, [adminId])).rows
    .map((s) => ({ id: s.id, ip: s.ip, userAgent: s.user_agent, createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, revokedAt: s.revoked_at,
      active: !s.revoked_at && new Date(s.expires_at) > new Date() }));
}

export async function listSignIns(opts: { adminId?: string; limit?: number; failedOnly?: boolean }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.adminId) { params.push(opts.adminId); where.push(`e.admin_id = $${params.length}`); }
  if (opts.failedOnly) where.push(`e.outcome <> 'success'`);
  params.push(Math.min(opts.limit ?? 100, 500));
  return (await query<{ id: string; admin_id: string | null; email: string | null; name: string | null; ip: string | null; user_agent: string | null; outcome: string; created_at: string }>(
    `SELECT e.id, e.admin_id, e.email, a.name, host(e.ip) AS ip, e.user_agent, e.outcome, e.created_at
       FROM platform_login_events e LEFT JOIN platform_admins a ON a.id = e.admin_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.created_at DESC LIMIT $${params.length}`, params)).rows
    .map((r) => ({ id: r.id, adminId: r.admin_id, email: r.email, name: r.name, ip: r.ip, userAgent: r.user_agent, outcome: r.outcome, createdAt: r.created_at }));
}

// ── IP allowlist ────────────────────────────────────────────────────────────

/** Why an allowlist entry is invalid, or null. */
export function allowlistEntryError(entry: string): string | null {
  const [addr, bits, extra] = entry.trim().split('/');
  const fam = isIP(addr ?? '');
  if (!fam || extra !== undefined) return `"${entry}" isn't an IP address or CIDR range`;
  if (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > (fam === 4 ? 32 : 128))) return `"${entry}" has an invalid prefix length`;
  return null;
}

/** Is `ip` allowed by `list`? An empty list allows everyone. */
export function ipAllowed(list: readonly string[], ip: string | null | undefined): boolean {
  if (!list.length) return true;
  const addr = normalizeIp(ip);
  if (!addr) return false;
  const bl = new BlockList();
  for (const entry of list) {
    const [a, bits] = entry.split('/');
    const fam = isIP(a ?? '') === 6 ? 'ipv6' : 'ipv4';
    if (allowlistEntryError(entry)) continue;
    if (bits === undefined) bl.addAddress(a!, fam); else bl.addSubnet(a!, Number(bits), fam);
  }
  return bl.check(addr, isIP(addr) === 6 ? 'ipv6' : 'ipv4');
}

// ── The bell ────────────────────────────────────────────────────────────────

/** In-app notices for platform members (by id or email); never throws. */
export async function notifyStaffInApp(to: { adminIds?: string[]; emails?: string[] }, n: { kind: string; title: string; body?: string | null; link?: string | null }): Promise<void> {
  try {
    const ids = new Set(to.adminIds ?? []);
    if (to.emails?.length) {
      const { rows } = await query<{ id: string }>(`SELECT id FROM platform_admins WHERE status = 'active' AND lower(email) = ANY($1::text[])`, [to.emails.map((e) => e.toLowerCase())]);
      for (const r of rows) ids.add(r.id);
    }
    for (const id of ids) {
      await query('INSERT INTO platform_notifications (admin_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5)',
        [id, n.kind, n.title.slice(0, 300), n.body?.slice(0, 1000) ?? null, n.link ?? null]);
    }
  } catch (err) {
    logger.warn({ err, kind: n.kind }, 'staff in-app notification failed');
  }
}
