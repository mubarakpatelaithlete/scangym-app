-- ScanGym ID memory store (owner request 2026-09-28, items 23/24): every chat
-- from every chatbot and plugin, kept per customer. Linked customers share
-- `user:<id>`, so a chat started on Telegram carries on in WhatsApp or ChatGPT.
-- chatbot_memory keeps the small summary JSON; this keeps the full log.
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  memory_key  TEXT NOT NULL,
  role        TEXT NOT NULL,
  text        TEXT NOT NULL,
  platform    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_key_id ON chat_messages (memory_key, id DESC);
