-- Task 154 Chats 4: WhatsApp-style groups. A group is backed by one dm_threads
-- row (user_a = 'grp', user_b = 'grp:<group id>') so messages, uploads,
-- reactions, edits and deletes reuse dm_messages unchanged.
CREATE TABLE IF NOT EXISTS dm_groups (
  id          SERIAL PRIMARY KEY,
  thread_id   INTEGER UNIQUE,
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dm_group_members (
  group_id      INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  last_read_id  BIGINT NOT NULL DEFAULT 0,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_group_members_user_idx ON dm_group_members(user_id);
