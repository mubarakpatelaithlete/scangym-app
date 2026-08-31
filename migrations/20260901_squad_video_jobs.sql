-- ScanSquad "Create Video": persist generation jobs.
--
-- Before this, jobs lived in an in-memory Map in squad-video.js. Two costs:
-- a deploy mid-render orphaned the video (the file existed, the pointer did
-- not), and the 5/day cap was counted per instance, so the cap was really
-- 5 x (number of dynos). Both need a row that outlives the process.
--
-- Idempotent: safe to re-run against the live database.

CREATE TABLE IF NOT EXISTS squad_video_jobs (
  id            TEXT PRIMARY KEY,                       -- crypto hex job id, also the MP4 filename
  user_id       TEXT,                                   -- users.id is a UUID; anonymous callers are keyed by IP
  op            TEXT,                                   -- Veo long-running operation name, for polling
  prompt        TEXT NOT NULL,
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,     -- the whitelisted render settings actually sent
  status        TEXT NOT NULL DEFAULT 'running',        -- running | done | error
  video_url     TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- The two queries this table exists for: "my recent clips" and "how many
-- did this user render today".
CREATE INDEX IF NOT EXISTS idx_squad_video_jobs_user_created
  ON squad_video_jobs (user_id, created_at DESC);
