/** Super Admin › Comms — the API's shapes (help center, changelog, status page, broadcasts). */
export interface HelpArticle {
  id: string; slug: string; title: string; category: string; body: string; audience: 'all' | 'staff' | 'partner' | 'advertiser';
  status: 'draft' | 'published'; position: number; views: number; published_at: string | null; updated_at: string; excerpt?: string;
}
export interface ChangelogEntry { id: string; title: string; body: string; kind: 'new' | 'improved' | 'fixed'; status?: 'draft' | 'published'; published_at: string | null }
export interface StatusComponent { id: string; name: string; description: string | null; status: string; position?: number }
export interface StatusIncident {
  id: string; title: string; impact: string; status: string; component_ids: string[]; starts_at: string; resolved_at: string | null;
  updates?: { id: string; status: string; body: string; created_at: string }[];
}
export interface StatusPageData { status: string; components: StatusComponent[]; incidents: StatusIncident[]; history: StatusIncident[] }
export interface Broadcast {
  id: string; subject: string; body: string; audience: { roles: string[]; planIds: string[]; networkStatuses: string[] };
  status: 'draft' | 'sending' | 'sent'; recipients: number | null; sent_at: string | null; created_by_name: string | null; created_at: string;
}

export const STATE_LABEL: Record<string, string> = {
  operational: 'Operational', degraded: 'Degraded performance', partial_outage: 'Partial outage', major_outage: 'Major outage', maintenance: 'Maintenance',
};
export const STATE_TONE: Record<string, string> = {
  operational: 'bg-success-bg text-success-text', degraded: 'bg-warning-bg text-warning-text', partial_outage: 'bg-warning-bg text-warning-text',
  major_outage: 'bg-danger-bg text-danger-text', maintenance: 'bg-info-bg text-info-text',
};
export const INCIDENT_STATE_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved',
};
