-- Shared chatbot memory (owner request 2026-09-26: "shared memory context and
-- shared library for customers — they create so many things with so many
-- models from inside so many chatbots").
--
-- One row per customer. Linked customers (user_channels) are keyed
-- `user:<id>`, so Telegram, WhatsApp, Discord, email… all read and write the
-- same row. Unlinked chats are keyed by their chat id and only remember
-- themselves. The in-process session Map in message-handler.js forgot
-- everything after 30 minutes or a deploy.
CREATE TABLE IF NOT EXISTS chatbot_memory (
  memory_key  TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
