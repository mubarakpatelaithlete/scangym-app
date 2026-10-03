-- Kill-X (2026-10-03): Pulse = short public text posts in real time, like X.
-- Likes / replies / reposts reuse reel_likes / reel_comments / reel_reposts
-- with reel_id = 'pulse:<id>', so no new social tables are needed.
CREATE TABLE IF NOT EXISTS pulse_posts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  user_name   TEXT,
  body        TEXT NOT NULL,
  gym_id      INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pulse_posts_live_idx ON pulse_posts(id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pulse_posts_recent_idx ON pulse_posts(created_at DESC);
