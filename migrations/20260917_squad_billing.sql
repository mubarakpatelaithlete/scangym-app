-- ScanSquad billing: postpaid generation, invoiced daily.
--
-- The model this implements (founder's decision, 17 Sep 2026): a creator never
-- prepays. They save a card, generate freely inside a daily budget, and get an
-- invoice the next morning. Unpaid for two days in a row and generation is
-- suspended until they pay.
--
-- Why three objects rather than one "credits" balance:
--   * squad_video_jobs already records every generation with its cost, so the
--     price a creator owes belongs on that row — one row per render, no second
--     table to drift out of step with it. (The table name is historical; it
--     holds every mode.)
--   * squad_invoices is the legal artifact. UK VAT invoices need a sequential
--     number, a tax point, and the net/VAT/gross split, and those cannot be
--     recomputed later from a moving price list — so they are stored.
--   * squad_billing is the creator's standing: card mandate, suspension, and
--     how many invoices they have actually paid (which is what earns a bigger
--     unpaid allowance).
--
-- Idempotent: safe to re-run against the live database.

-- ── What each generation costs the creator ───────────────────────────────────
-- Priced at submit time, in integer pence, alongside cost_usd (what we pay).
-- Storing the price rather than deriving it means a multiplier change or an FX
-- move never silently rewrites what somebody already owes.
ALTER TABLE squad_video_jobs
  ADD COLUMN IF NOT EXISTS retail_net_pence   INTEGER,
  ADD COLUMN IF NOT EXISTS retail_vat_pence   INTEGER,
  ADD COLUMN IF NOT EXISTS retail_gross_pence INTEGER,
  ADD COLUMN IF NOT EXISTS invoice_id         BIGINT;

-- The daily invoice run asks one question: which of this creator's renders are
-- not on an invoice yet. Without this index that is a scan of every generation
-- ever made, every morning.
CREATE INDEX IF NOT EXISTS idx_squad_jobs_uninvoiced
  ON squad_video_jobs (user_id, created_at)
  WHERE invoice_id IS NULL AND retail_gross_pence IS NOT NULL;

-- ── Invoices ─────────────────────────────────────────────────────────────────
-- number: human-facing, gapless, e.g. SG-2026-001042. A sequence (not
-- COUNT(*)+1) because two invoice runs overlapping must never mint the same
-- number, and HMRC expects the series to be unbroken.
CREATE SEQUENCE IF NOT EXISTS squad_invoice_no_seq START WITH 1000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS squad_invoices (
  id                       BIGSERIAL PRIMARY KEY,
  number                   TEXT UNIQUE NOT NULL,
  user_id                  TEXT NOT NULL,
  issued_on                DATE NOT NULL DEFAULT CURRENT_DATE,
  period_start             TIMESTAMPTZ,
  period_end               TIMESTAMPTZ,
  line_count               INTEGER NOT NULL DEFAULT 0,
  net_pence                INTEGER NOT NULL,
  vat_pence                INTEGER NOT NULL DEFAULT 0,
  gross_pence              INTEGER NOT NULL,
  vat_rate                 NUMERIC(5,4),
  vat_number               TEXT,          -- ours, as it stood when issued
  status                   TEXT NOT NULL DEFAULT 'open',  -- open | paid | failed | void
  charge_attempts          INTEGER NOT NULL DEFAULT 0,
  last_error               TEXT,
  last_attempt_at          TIMESTAMPTZ,
  paid_at                  TIMESTAMPTZ,
  stripe_payment_intent_id TEXT,
  emailed_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "What does this creator owe" and "what is due for charging" are the two hot
-- reads; both filter on status.
CREATE INDEX IF NOT EXISTS idx_squad_invoices_user_status
  ON squad_invoices (user_id, status, issued_on DESC);
CREATE INDEX IF NOT EXISTS idx_squad_invoices_open
  ON squad_invoices (status, issued_on) WHERE status <> 'paid';

-- ── Creator billing standing ─────────────────────────────────────────────────
-- mandate_pm_id is the saved card we may charge off-session. It is the whole
-- reason postpaid is safe: "we have your digital identity" deters abuse but
-- collects nothing, whereas a card mandate collects without the creator doing
-- anything. paid_invoices is payment history, and history is what raises the
-- unpaid allowance — a stranger's first day is capped, a proven creator's is not.
CREATE TABLE IF NOT EXISTS squad_billing (
  user_id          TEXT PRIMARY KEY,
  mandate_pm_id    TEXT,
  mandate_at       TIMESTAMPTZ,
  paid_invoices    INTEGER NOT NULL DEFAULT 0,
  paid_gross_pence BIGINT NOT NULL DEFAULT 0,
  suspended_at     TIMESTAMPTZ,
  suspend_reason   TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_squad_billing_suspended
  ON squad_billing (suspended_at) WHERE suspended_at IS NOT NULL;

-- Useful by hand:
--   SELECT number, issued_on, gross_pence, status FROM squad_invoices
--    WHERE user_id = $1 ORDER BY issued_on DESC;
--   SELECT SUM(gross_pence) FROM squad_invoices WHERE status <> 'paid';
