/**
 * Super Admin › Trust & safety — the shapes the API returns (api-backend platform-admin/trust-routes.ts) and
 * their words: block kinds, privacy request kinds / regulations / subjects / statuses, click flags.
 */
import { clickRejection } from './clickReportFilters';

export type BlockKind = 'ip' | 'user_agent' | 'referrer';
export const BLOCK_KINDS: { value: BlockKind; label: string; placeholder: string; hint: string }[] = [
  { value: 'ip', label: 'IP address', placeholder: '203.0.113.7, 198.51.100.0/24 or 2001:db8::/32', hint: 'An address, a CIDR, or the first address of a range' },
  { value: 'user_agent', label: 'User agent', placeholder: 'HeadlessChrome', hint: 'Blocks every user agent that contains this phrase (3+ characters, any case)' },
  { value: 'referrer', label: 'Referrer domain', placeholder: 'spam-traffic.example', hint: 'Blocks clicks referred by this domain and its subdomains' },
];
export const blockKindLabel = (k: string) => BLOCK_KINDS.find((x) => x.value === k)?.label ?? k;

export interface BlockEntry {
  id: string; kind: BlockKind; value: string; value_to: string | null; reason: string | null; expires_at: string | null;
  created_at: string; created_by_name: string | null; expired: boolean; hits: number;
}

export interface SuspiciousIp {
  ip: string; networks: { id: string; name: string }[]; clicks: number; flagged: number; avg_score: number; top_flags: string[];
  first_seen: string; last_seen: string; blocked: boolean;
}

export interface TrustSummary {
  kpis: { clicks7d: number; invalid7d: number; rejected7d: number; invalidPct: number; avgScore: number | null };
  networks: { id: string; name: string; status: string; clicks: number; invalid: number; rejected: number; invalidPct: number; avgScore: number | null }[];
  scan: { computedAt: string; totalClicks: number; flaggedClicks: number; reasons: { reason: string; clicks: number }[]; suspiciousIps: number } | null;
  suspicious: SuspiciousIp[];
  blocklist: { entries: number; hits: number; top: { id: string; kind: BlockKind; value: string; value_to: string | null; hits: number }[] };
  privacy: { open: number; overdue: number; due_soon: number; completed_30d: number };
}

const FLAG_LABELS: Record<string, string> = {
  datacenter_ip: 'Datacenter IP', bot_user_agent: 'Bot user agent', no_user_agent: 'No user agent', high_velocity: 'Too many clicks a minute',
};
/** A click flag in words: a rejection reason, a fraud signal, or the key made readable. */
export const flagLabel = (f: string): string =>
  clickRejection([f]) ?? FLAG_LABELS[f] ?? f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export type PrivacyStatus = 'new' | 'in_progress' | 'completed' | 'rejected';
export type SubjectType = 'ip' | 'click_id' | 'sub_id' | 'email';
export interface PrivacyRequest {
  id: string; number: string; network_id: string | null; network_name: string | null; kind: 'erasure' | 'access'; regulation: 'gdpr' | 'ccpa' | 'other';
  subject_type: SubjectType; subject: string; requester_email: string | null; status: PrivacyStatus; received_at: string; due_at: string;
  notes: string | null; result: { clicks: number; conversions: number; inboundPostbacks: number; outboundPostbacks: number; networks: number } | null;
  assignee_id: string | null; assignee_name: string | null; created_at: string; completed_at: string | null; overdue: boolean;
}

export const PRIVACY_STATUS: Record<PrivacyStatus, { label: string; chip: string }> = {
  new: { label: 'New', chip: 'bg-info-bg text-info-text' },
  in_progress: { label: 'In progress', chip: 'bg-warning-bg text-warning-text' },
  completed: { label: 'Completed', chip: 'bg-success-bg text-success-text' },
  rejected: { label: 'Rejected', chip: 'bg-page text-fg-secondary ring-1 ring-inset ring-border' },
};
export const REGULATIONS = [
  { value: 'gdpr', label: 'GDPR', days: 30 },
  { value: 'ccpa', label: 'CCPA', days: 45 },
  { value: 'other', label: 'Other', days: 30 },
] as const;
export const SUBJECTS: { value: SubjectType; label: string; placeholder: string }[] = [
  { value: 'ip', label: 'IP address', placeholder: '203.0.113.7' },
  { value: 'email', label: 'Email', placeholder: 'person@example.com' },
  { value: 'click_id', label: 'Click ID', placeholder: 'the transaction / click id' },
  { value: 'sub_id', label: 'Sub ID value', placeholder: 'a value sent in sub1–sub5' },
];
export const subjectLabel = (t: string) => SUBJECTS.find((s) => s.value === t)?.label ?? t;
export const regulationLabel = (r: string) => REGULATIONS.find((x) => x.value === r)?.label ?? r;
