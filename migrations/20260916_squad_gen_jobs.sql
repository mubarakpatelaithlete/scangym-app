-- ScanSquad Create: make the video jobs table serve every generation mode.
--
-- squad_video_jobs was built for one mode with one provider (Veo). The Create
-- sheet has eight modes, so the table needs to say which mode and which
-- provider produced a row, and what it cost us.
--
-- Extending the existing table rather than adding squad_image_jobs,
-- squad_music_jobs and so on: the questions we actually ask are "what has
-- this creator made" and "how many of X did they make today", and those are
-- one query over one table with a kind column, versus a UNION over six that
-- somebody will forget to update. The name stays squad_video_jobs so the
-- migration cannot break the running route; the meaning is now "generation
-- jobs".
--
-- Idempotent: safe to re-run against the live database.

ALTER TABLE squad_video_jobs
  ADD COLUMN IF NOT EXISTS kind      TEXT NOT NULL DEFAULT 'video',  -- video | image | audio | music | twin | clipping | ugc
  ADD COLUMN IF NOT EXISTS provider  TEXT,                           -- fal | elevenlabs | gemini
  ADD COLUMN IF NOT EXISTS model     TEXT,                           -- catalogue id, e.g. 'wan-2.5' (not the vendor path)
  ADD COLUMN IF NOT EXISTS cost_usd  NUMERIC(10,4);                  -- quoted estimate at submit time

-- Every row that existed before this migration was a Veo video render.
UPDATE squad_video_jobs
   SET provider = 'gemini',
       model    = 'veo-3.1-fast'
 WHERE provider IS NULL;

-- The daily cap is per mode, so the quota query filters on kind as well as
-- user. Without kind in the index that count degrades to a scan of every
-- generation the creator has ever made once images and music share the table.
CREATE INDEX IF NOT EXISTS idx_squad_gen_jobs_user_kind_created
  ON squad_video_jobs (user_id, kind, created_at DESC);

-- What each mode costs us, answerable without exporting to a spreadsheet:
--   SELECT kind, model, COUNT(*), SUM(cost_usd)
--     FROM squad_video_jobs
--    WHERE created_at >= date_trunc('month', NOW())
--    GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST;
