-- Task 52 (owner, 2026-09-30): Like / Comment / Repost on every Home reel,
-- as on TikTok. reel_id is the feed's key (cdnKey, else id), the same key
-- video_performance already uses for share/save counts.
CREATE TABLE IF NOT EXISTS reel_likes (
  reel_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reel_id, user_id)
);

CREATE TABLE IF NOT EXISTS reel_reposts (
  reel_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reel_id, user_id)
);
CREATE INDEX IF NOT EXISTS reel_reposts_user_idx ON reel_reposts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reel_comments (
  id          BIGSERIAL PRIMARY KEY,
  reel_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  user_name   TEXT,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reel_comments_reel_idx ON reel_comments(reel_id, id DESC);
