-- ═══════════════════════════════════════════════════════════════════════════
-- 0006  columns the code has always expected and production has never had
--
-- Two tables in production were created by the old startup DDL in an earlier,
-- narrower shape. `CREATE TABLE IF NOT EXISTS` in 0001 then did exactly what it
-- says: nothing. So the baseline "declares" nine columns that do not exist in
-- the live database, and the routes that use them have been failing:
--
--   booking_feedback.user_id   routes/booking.js SELECTs, UPDATEs and INSERTs
--                              this column on every thumbs-up/thumbs-down, so
--                              post-booking feedback could never be saved.
--   gym_equipment.brand, equipment_condition, is_out_of_order,
--   out_of_order_since, out_of_order_reason, photo_url, sort_order, updated_at
--                              routes/gym-management.js writes all of these, so
--                              a gym owner adding equipment or marking a machine
--                              out of order got a 500.
--
-- Found by diffing the baseline files against the live schema after migrations
-- reached production for the first time (see 0003's note and PR #662).
--
-- ADD COLUMN IF NOT EXISTS is idempotent and, for these constant defaults,
-- metadata-only in PostgreSQL 11+ — no table rewrite.
-- ═══════════════════════════════════════════════════════════════════════════

-- from routes/booking.js — matches public.users.id, a UUID string
ALTER TABLE booking_feedback ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);

-- from routes/gym-management.js
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS equipment_condition VARCHAR(50) DEFAULT 'good';
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS is_out_of_order BOOLEAN DEFAULT false;
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS out_of_order_since TIMESTAMPTZ;
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS out_of_order_reason TEXT;
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE gym_equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 0003 could not create this index because the column above did not exist, and
-- 0003 now skips statements it cannot run — so it is created here, once the
-- column is real. NULL user_ids do not collide under a unique index, which is
-- the correct behaviour for any feedback rows written before this repair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique
  ON booking_feedback(booking_id, user_id, feedback_type);
