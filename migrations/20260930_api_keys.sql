-- ScanGym public API keys (Task 2). Only the sha256 of each key is stored;
-- the plain key is shown to the developer once, at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT 'My app',
  key_hash      TEXT NOT NULL UNIQUE,
  key_prefix    TEXT NOT NULL,
  requests      BIGINT NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
