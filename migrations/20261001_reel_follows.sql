-- Task 64 (owner, 2026-10-01): Follow a creator from any Home reel, as on TikTok.
CREATE TABLE IF NOT EXISTS reel_follows (
  creator     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (creator, user_id)
);
CREATE INDEX IF NOT EXISTS reel_follows_user_idx ON reel_follows(user_id, created_at DESC);
