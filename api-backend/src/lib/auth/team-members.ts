/**
 * Team members (users rows) looked up by their LOGIN id — the dashboard identity's `userId` (the
 * token's `sub` = users.auth_user_id), which is what rows stamp as their owner / creator
 * (saved_reports.owner_user_id, offer_scheduled_actions.created_by, import_export_logs.created_by).
 * One query per call, network-scoped; ids that aren't UUIDs (or have no team member) are simply absent.
 */
import { query } from '../db/pool.js';

export interface TeamMember { loginId: string; name: string | null; email: string; role: string; status: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function teamMembersByLogin(networkId: string, loginIds: readonly (string | null | undefined)[]): Promise<Map<string, TeamMember>> {
  const ids = [...new Set(loginIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))];
  if (!ids.length) return new Map();
  const { rows } = await query<TeamMember>(
    `SELECT auth_user_id::text AS "loginId", name, email, role, status FROM users WHERE network_id = $1 AND auth_user_id = ANY($2::uuid[])`,
    [networkId, ids]);
  return new Map(rows.map((m) => [m.loginId, m]));
}

/** How a team member is shown ("Created By", owners): their name, else their email. */
export const memberLabel = (m: TeamMember | undefined): string | null => (m ? m.name?.trim() || m.email : null);
