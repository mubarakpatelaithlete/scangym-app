-- Sign-in links: the tap-instead-of-say door into ScanGym.
--
-- A voice customer who is not logged in currently has to read six digits out
-- loud. A link is one tap and nothing spoken. The link is a 256-bit random
-- token; only its SHA-256 hash is stored, so a database leak cannot be replayed
-- into a login. Single use is enforced by the UNIQUE hash plus the conditional
-- UPDATE in server/lib/login-link.js (used_at IS NULL), which is atomic even if
-- the link is tapped twice at once.
--
-- Rows are deliberately kept after use (a 10-minute window, then dead weight)
-- so "was this link already used?" is answerable during a support call. The
-- sweep in the app deletes anything older than a day.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS login_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  contact     TEXT NOT NULL,               -- E.164 phone or lowercased email
  channel     TEXT NOT NULL,               -- 'sms' | 'email'
  created_ip  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_links_expires ON login_links (expires_at);
CREATE INDEX IF NOT EXISTS idx_login_links_contact ON login_links (contact, created_at DESC);
