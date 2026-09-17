-- "Use this prompt": TikTok's "Use this sound" loop, for a text-to-video app.
--
-- A reel needs to carry the prompt it was made from, or the button on it has
-- nothing to hand to the Create screen. Catalog rows had no such column, and
-- the prompt only existed on the ScanSquad job that rendered the file
-- (squad_video_jobs.prompt), keyed by its MP4 filename.
--
-- Nullable on purpose: seeded and stock reels have no prompt, and the button
-- opens Create empty for those rather than being hidden (owner's call).
--
-- Idempotent: safe to re-run against the live database.

ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS prompt TEXT;

-- Backfill what can be known: a catalog row whose URL ends in a job's video
-- file is that job's output. Matching on the job id (which is the filename)
-- rather than on text, so this cannot mis-attribute a prompt.
UPDATE video_catalog vc
   SET prompt = j.prompt
  FROM squad_video_jobs j
 WHERE vc.prompt IS NULL
   AND j.status = 'done'
   AND j.prompt IS NOT NULL
   AND (vc.cdn_key = j.id OR vc.url LIKE '%' || j.id || '%');
