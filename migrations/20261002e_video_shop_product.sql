-- Task 161: a creator's video on Home can sell one of their own Shop products
-- (TikTok Shop style). The Shop button on that video opens it first.
ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS shop_product_id INTEGER;
