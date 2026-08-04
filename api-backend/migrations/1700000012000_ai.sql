-- AI ops-assistant threads (spec §4, §11). Conversations + messages are logged for audit and
-- improvement (spec §11 hard rule). Tenant-scoped by network_id.

-- Up Migration
CREATE TABLE ai_conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  user_id      text,                       -- operator who owns the thread
  title        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_network_idx ON ai_conversations (network_id, created_at DESC);
CREATE TRIGGER trg_ai_conversations_updated_at BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  -- Structured record of which read-only tools the assistant called (for transparency/audit).
  tool_calls      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conversation_idx ON ai_messages (network_id, conversation_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_conversations;
