-- Kill-Pinterest fix: ideas also come from social_reels (ids like 'social_123'),
-- so a pin stores the feed id as text, the same id /reels?v= deep-links to.
ALTER TABLE idea_pins ALTER COLUMN video_id TYPE TEXT USING video_id::text;
