-- Chats tab (Task 11): WhatsApp-style 1:1 messaging between ScanGym users.
-- user_a < user_b (sorted) so one pair has exactly one thread.
CREATE TABLE IF NOT EXISTS dm_threads (
  id               SERIAL PRIMARY KEY,
  user_a           TEXT NOT NULL,
  user_b           TEXT NOT NULL,
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS dm_threads_pair_idx ON dm_threads(user_a, user_b);
CREATE INDEX IF NOT EXISTS dm_threads_b_idx ON dm_threads(user_b);

CREATE TABLE IF NOT EXISTS dm_messages (
  id            BIGSERIAL PRIMARY KEY,
  thread_id     INTEGER NOT NULL,
  sender_id     TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dm_messages_thread_idx ON dm_messages(thread_id, id);

-- "online" / "last seen" in the chat header.
CREATE TABLE IF NOT EXISTS dm_presence (
  user_id    TEXT PRIMARY KEY,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
