-- Kill-Pinterest (2026-10-03): save reels as "ideas" into named boards
-- (Workouts, Recipes, Home gym...) to act on later, like Pinterest.
CREATE TABLE IF NOT EXISTS idea_boards (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idea_boards_user_name_idx ON idea_boards(user_id, lower(name));
CREATE TABLE IF NOT EXISTS idea_pins (
  board_id    BIGINT NOT NULL REFERENCES idea_boards(id) ON DELETE CASCADE,
  video_id    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, video_id)
);
