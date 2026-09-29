-- The digital-products Shop: ScanSquad creators sell files, customers buy them.
--
-- Money is stored in pence as integers, never as floats: a 70/30 split of
-- £4.99 in floating point is how a penny goes missing from someone's earnings.
CREATE TABLE IF NOT EXISTS shop_products (
  id                SERIAL PRIMARY KEY,
  creator_handle    VARCHAR(100) NOT NULL,
  creator_user_id   VARCHAR(64),
  title             TEXT NOT NULL,
  description       TEXT,
  category          VARCHAR(60) DEFAULT 'Templates',
  price_pence       INTEGER NOT NULL CHECK (price_pence >= 100),
  currency          VARCHAR(3) DEFAULT 'GBP',
  cover_image_url   TEXT,
  file_path         TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  file_size         INTEGER,
  content_type      TEXT DEFAULT 'application/pdf',
  status            VARCHAR(20) DEFAULT 'active',   -- active | hidden
  sales_count       INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_products_status_idx  ON shop_products (status, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_products_creator_idx ON shop_products (creator_handle);

-- One row per purchase attempt. The row is written before the card is charged,
-- so a payment that succeeds while the customer's phone dies is still
-- recoverable from the Stripe webhook.
CREATE TABLE IF NOT EXISTS shop_orders (
  id                        SERIAL PRIMARY KEY,
  product_id                INTEGER NOT NULL REFERENCES shop_products(id),
  buyer_user_id             VARCHAR(64),
  buyer_email               TEXT,
  amount_pence              INTEGER NOT NULL,
  currency                  VARCHAR(3) DEFAULT 'GBP',
  platform_fee_pence        INTEGER NOT NULL DEFAULT 0,
  creator_earnings_pence    INTEGER NOT NULL DEFAULT 0,
  creator_handle            VARCHAR(100),
  status                    VARCHAR(20) DEFAULT 'pending',  -- pending | paid | failed
  stripe_payment_intent_id  TEXT,
  download_token            TEXT UNIQUE,
  download_count            INTEGER DEFAULT 0,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  paid_at                   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shop_orders_buyer_idx   ON shop_orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_creator_idx ON shop_orders (creator_handle, status);
CREATE INDEX IF NOT EXISTS shop_orders_intent_idx  ON shop_orders (stripe_payment_intent_id);
