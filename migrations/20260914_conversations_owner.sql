-- Buttons v1.0 batch 3: "message the gym" by voice.
--
-- conversations had no idea whose they were: the receptionist chat created one per
-- tap and only the browser tab remembered the id. To read "any reply from the gym?"
-- back by voice, a conversation needs a customer and a gym. Both nullable, so the
-- existing anonymous rows and the tap flow are untouched.
-- Idempotent: safe to re-run against the live database.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gym_id  INTEGER;

CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations (user_id);
