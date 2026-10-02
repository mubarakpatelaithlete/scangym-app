-- Task 107/118 step 1: WhatsApp/Telegram/Discord-style reactions and edit message.
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
