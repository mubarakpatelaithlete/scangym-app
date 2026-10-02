-- Task 107 batch 2: WhatsApp Business greeting + away messages.
CREATE TABLE IF NOT EXISTS dm_business (
  user_id      TEXT PRIMARY KEY,
  greeting     TEXT,
  greeting_on  BOOLEAN NOT NULL DEFAULT FALSE,
  away         TEXT,
  away_on      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
