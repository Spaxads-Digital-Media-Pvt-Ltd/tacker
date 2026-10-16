-- Super Admin › Support — a help desk between the platform team and its customer networks (what Everflow /
-- Trackier support runs in Zendesk / Intercom). A network's staff open tickets from their dashboard (Help ›
-- Contact support); the support team works the queue: assignment (auto: the Support member with the fewest
-- open tickets), priorities with a first-response target (SLA, platform_settings 'support'), internal notes the
-- customer never sees, saved replies (macros), resolve → the customer rates it (1–5) or it closes on its own.
--
-- Statuses: open (needs the support team) · pending (answered — waiting on the customer) · on_hold ·
-- resolved (the customer may reopen or rate it) · closed (auto, N days after resolved; or by the customer).

-- Up Migration

CREATE SEQUENCE support_ticket_number_seq START 1001;

CREATE TABLE support_tickets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 bigint NOT NULL DEFAULT nextval('support_ticket_number_seq') UNIQUE,
  network_id             uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  subject                text NOT NULL,
  category               text NOT NULL DEFAULT 'technical'
                         CHECK (category IN ('technical', 'tracking', 'billing', 'account', 'feature_request', 'bug', 'other')),
  priority               text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'on_hold', 'resolved', 'closed')),
  requester_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  requester_email        text,
  requester_name         text,
  assignee_id            uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  tags                   text[] NOT NULL DEFAULT '{}',
  first_response_due_at  timestamptz,
  first_response_at      timestamptz,
  last_customer_at       timestamptz,
  last_staff_at          timestamptz,
  resolved_at            timestamptz,
  closed_at              timestamptz,
  satisfaction           integer CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5),
  satisfaction_comment   text,
  created_by_admin_id    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_network_idx ON support_tickets (network_id, created_at DESC);
CREATE INDEX support_tickets_queue_idx ON support_tickets (status, priority, created_at);
CREATE INDEX support_tickets_assignee_idx ON support_tickets (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_kind      text NOT NULL CHECK (author_kind IN ('customer', 'staff', 'system')),
  author_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  author_admin_id  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  author_name      text,
  body             text NOT NULL,
  internal         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT internal OR author_kind <> 'customer')
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, created_at);

CREATE TABLE support_macros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  uses        integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_support_macros_updated_at BEFORE UPDATE ON support_macros FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS support_macros;
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_tickets;
DROP SEQUENCE IF EXISTS support_ticket_number_seq;
