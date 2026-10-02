-- Task 108/119 step 1: Amazon / Fiverr / Upwork / Skool-style star ratings and
-- reviews. Only buyers with a paid order can review (verified purchase).
CREATE TABLE IF NOT EXISTS shop_reviews (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES shop_products(id),
  user_id     VARCHAR(64) NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_reviews_one_per_buyer ON shop_reviews (product_id, user_id);
