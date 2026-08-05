-- ═══════════════════════════════════════════════════════════════════════════
-- 0004  one workout_logs, and user_id columns that can hold a real user id
--
-- public.users.id is a UUID string (auth.js inserts gen_random_uuid()), but
-- four tables declared user_id as INTEGER. Every INSERT for a signed-in user
-- therefore failed with:
--     invalid input syntax for type integer: "5e139358-4d8c-..."
-- which the routes reported as a generic 500, so the AI coach never saved a
-- workout and "pay later" never recorded a deferred payment.
--
-- workout_logs was also created twice, in two different shapes
-- (routes/coach.js and the never-mounted routes/ai-trainer.js). Whichever
-- module loaded first won; the other one's columns never existed. This adds
-- the columns routes/ai-features.js reads (muscles_trained, intensity) so the
-- progress screens stop coming back empty.
--
-- Idempotent: each change is guarded.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS muscles_trained TEXT[];
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS intensity INTEGER;
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS gym_name TEXT;
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS workout_type VARCHAR(100);
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS exercises JSONB;
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS energy_level INTEGER;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workout_logs', 'coach_profiles', 'coach_conversations', 'deferred_payments']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'user_id'
        AND data_type IN ('integer', 'bigint', 'smallint')
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id TYPE VARCHAR(64) USING user_id::text', t);
      RAISE NOTICE 'widened %.user_id from integer to varchar(64)', t;
    END IF;
  END LOOP;
END $$;
