-- Kill-Instagram item 4: a post can be tagged with the gym it was filmed at,
-- so the reel shows "Book <gym>" straight to that gym's page.
ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS gym_id INTEGER;
