-- ScanSquad 2.0: creations that belong to a creator, and counts that survive a phone.
--
-- Three things were missing behind the Create sheet:
--
--  1. A creator could generate a £3 clip while signed out. Spend was capped at
--     5 clips a day *per IP*, so one anonymous visitor could cost up to
--     5 x $3.78 = $18.90 and a new IP reset the counter. The budget layer
--     (lib/gen-budget.js) prices spend against the creator's tier and the
--     bookings they have actually driven, which needs the generation rows to
--     carry a real user id — they already do — and needs today's spend to be
--     answerable in one query, which is what the index below is for.
--
--  2. Downloads and shares were counted in localStorage. They vanished on a
--     new phone and could not feed the tier ladder that decides who earns
--     what, so the numbers on the Creator dashboard were decoration.
--
--  3. Nothing recorded that a generated asset had been shared, so the loop
--     "generate -> post -> earn" had no evidence in the middle.
--
-- squad_asset_events covers both the 388 ready-made library assets (keyed by
-- their file id) and generated jobs (keyed by job id): the question asked is
-- always "what did this creator do with this asset", never "which table is it
-- in". One row per action per asset per creator — a repeat tap updates the
-- count rather than inflating it, because a creator who taps Share twice has
-- shared once.
--
-- Idempotent: safe to re-run against the live database.

ALTER TABLE squad_video_jobs
  ADD COLUMN IF NOT EXISTS download_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_count    INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS squad_asset_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,                        -- users.id
  asset_id    TEXT NOT NULL,                        -- library asset file id, or squad_video_jobs.id
  asset_kind  TEXT NOT NULL DEFAULT 'library',      -- library | generated
  action      TEXT NOT NULL,                        -- download | share
  count       INT  NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_id, action)
);

CREATE INDEX IF NOT EXISTS idx_squad_asset_events_user
  ON squad_asset_events (user_id, action);

-- "What has this creator spent today", the one query the budget layer runs on
-- every generate. Without created_at leading, it degrades to a scan of every
-- generation the creator has ever made.
CREATE INDEX IF NOT EXISTS idx_squad_gen_jobs_user_created_cost
  ON squad_video_jobs (user_id, created_at DESC)
  WHERE cost_usd IS NOT NULL;
