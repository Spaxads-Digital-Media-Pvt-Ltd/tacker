/**
 * The help desk (Super Admin › Support and the tenant's Help & support): statuses, priorities and categories
 * with their words and colours, and the shapes the APIs return.
 */
export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

/** `customer` = how the network's staff read it (their side of the same status). */
export const TICKET_STATUS: Record<TicketStatus, { label: string; customer: string; chip: string }> = {
  open: { label: 'Open', customer: 'With support', chip: 'bg-info-bg text-info-text' },
  pending: { label: 'Waiting on customer', customer: 'Awaiting your reply', chip: 'bg-warning-bg text-warning-text' },
  on_hold: { label: 'On hold', customer: 'With support', chip: 'bg-page text-fg-secondary ring-1 ring-inset ring-border' },
  resolved: { label: 'Resolved', customer: 'Resolved', chip: 'bg-success-bg text-success-text' },
  closed: { label: 'Closed', customer: 'Closed', chip: 'bg-page text-fg-muted ring-1 ring-inset ring-border' },
};

export const TICKET_PRIORITY: Record<TicketPriority, { label: string; chip: string; rank: number }> = {
  urgent: { label: 'Urgent', chip: 'bg-danger-bg text-danger-text', rank: 0 },
  high: { label: 'High', chip: 'bg-warning-bg text-warning-text', rank: 1 },
  normal: { label: 'Normal', chip: 'bg-info-bg text-info-text', rank: 2 },
  low: { label: 'Low', chip: 'bg-page text-fg-secondary ring-1 ring-inset ring-border', rank: 3 },
};

export const TICKET_CATEGORIES: { value: string; label: string }[] = [
  { value: 'technical', label: 'Technical question' }, { value: 'tracking', label: 'Tracking & postbacks' },
  { value: 'billing', label: 'Billing & invoices' }, { value: 'account', label: 'Account & access' },
  { value: 'feature_request', label: 'Feature request' }, { value: 'bug', label: 'Something’s broken' }, { value: 'other', label: 'Other' },
];
export const categoryLabel = (v: string) => TICKET_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export interface Ticket {
  id: string; number: string; subject: string; category: string; priority: TicketPriority; status: TicketStatus;
  network_id: string; network_name: string; network_slug: string; requester_user_id: string | null; requester_email: string | null; requester_name: string | null;
  assignee_id: string | null; assignee_name: string | null; tags: string[];
  first_response_due_at: string | null; first_response_at: string | null; last_customer_at: string | null; last_staff_at: string | null;
  resolved_at: string | null; closed_at: string | null; satisfaction: number | null; satisfaction_comment: string | null;
  created_at: string; updated_at: string; breached: boolean; last_message: string | null; last_author: 'customer' | 'staff' | null;
}
export interface TicketMessage {
  id: string; author_kind: 'customer' | 'staff' | 'system'; author_name: string | null; body: string; internal: boolean; created_at: string;
}
export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  network: { id: string; name: string; slug: string; status: string; plan_name: string | null; subscription_status: string | null; health_score: number | null; health_status: 'healthy' | 'attention' | 'at_risk' | null; account_manager_name: string | null; owner_email: string | null };
  otherTickets: { id: string; number: string; subject: string; status: TicketStatus; created_at: string }[];
}
export interface Macro { id: string; title: string; body: string; uses: number; created_by_name: string | null; updated_at: string }

/** The tenant's view of a ticket (no internal fields). */
export interface CustomerTicket {
  id: string; number: string; subject: string; category: string; priority: TicketPriority; status: TicketStatus; created_at: string; updated_at: string;
  resolved_at: string | null; closed_at: string | null; satisfaction: number | null; satisfaction_comment: string | null;
  requester_name: string | null; agent_name: string | null; last_message: string | null; last_author: 'customer' | 'staff' | null;
  messages?: { id: string; author_kind: 'customer' | 'staff' | 'system'; author_name: string | null; body: string; created_at: string }[];
}
