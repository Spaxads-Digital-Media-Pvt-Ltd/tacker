/**
 * Announcements (Super Admin › Platform › Announcements) shown in tenant dashboards: published, between
 * `starts_at` and `ends_at`, for the network's audience (all · networks on given plans · listed networks)
 * and the person's kind (network staff, partner or advertiser portal), minus what they dismissed.
 * A maintenance announcement also carries its window.
 */
import { query } from '../db/pool.js';

export interface LiveAnnouncement {
  id: string; title: string; body: string; kind: string; dismissible: boolean; link_url: string | null; link_label: string | null;
  maintenance_starts_at: string | null; maintenance_ends_at: string | null; starts_at: string;
}

export async function announcementsFor(networkId: string, role: 'admin' | 'publisher' | 'advertiser', userKey: string): Promise<LiveAnnouncement[]> {
  const { rows } = await query<LiveAnnouncement>(
    `SELECT a.id, a.title, a.body, a.kind, a.dismissible, a.link_url, a.link_label, a.maintenance_starts_at, a.maintenance_ends_at, a.starts_at
       FROM platform_announcements a
      WHERE a.status = 'published' AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now())
        AND $2 = ANY(a.roles)
        AND (a.audience = 'all'
             OR (a.audience = 'networks' AND $1 = ANY(a.network_ids))
             OR (a.audience = 'plans' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.network_id = $1
                   AND s.status IN ('trialing', 'active', 'past_due') AND s.plan_id = ANY(a.plan_ids))))
        AND NOT EXISTS (SELECT 1 FROM platform_announcement_dismissals d WHERE d.announcement_id = a.id AND d.user_key = $3)
      ORDER BY CASE a.kind WHEN 'critical' THEN 0 WHEN 'maintenance' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, a.starts_at DESC
      LIMIT 5`, [networkId, role, userKey]);
  return rows;
}
