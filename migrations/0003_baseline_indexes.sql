-- ═══════════════════════════════════════════════════════════════════════════
-- 0003  baseline indexes
--
-- Baseline of the schema that used to be created at startup by 32 different
-- server files. Every statement is idempotent (IF NOT EXISTS / DO $$ guards),
-- so running it against the live database is a no-op for anything that
-- already exists. Source file noted above each block.
-- Generated as part of "one version of ScanGym" step 10 - do not add new
-- CREATE TABLE statements to route files; add a new migration here instead.
-- ═══════════════════════════════════════════════════════════════════════════



-- from lib/reels-algorithm.js
CREATE INDEX IF NOT EXISTS idx_reel_interactions_session
ON reel_interactions (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_views_video
ON reel_views (video_id);

-- from lib/video-variants.js
CREATE INDEX IF NOT EXISTS idx_video_variants_cdn_key ON video_variants(cdn_key);

-- from middleware/analytics.js
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_path ON analytics_events(path);
CREATE INDEX IF NOT EXISTS idx_analytics_funnel ON analytics_events(funnel_step);
CREATE INDEX IF NOT EXISTS idx_analytics_ip ON analytics_events(ip_address);

-- from routes/access.js
CREATE INDEX IF NOT EXISTS idx_access_cred_booking ON booking_access_credentials(booking_id);
CREATE INDEX IF NOT EXISTS idx_access_cred_gym ON booking_access_credentials(gym_id);
CREATE INDEX IF NOT EXISTS idx_access_cred_user ON booking_access_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_access_cred_status ON booking_access_credentials(status);

-- from routes/booking.js
CREATE INDEX IF NOT EXISTS idx_feedback_booking ON booking_feedback(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique ON booking_feedback(booking_id, user_id, feedback_type);

-- from routes/channels.js
CREATE INDEX IF NOT EXISTS idx_user_channels_user ON user_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel, channel_user_id);

-- from routes/coach.js
CREATE INDEX IF NOT EXISTS idx_coach_conv_user ON coach_conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_user ON workout_logs(user_id, created_at DESC);

-- from routes/comms-log.js
CREATE INDEX IF NOT EXISTS idx_comms_log_created ON comms_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_log_channel ON comms_log(channel);

-- from routes/creator-distribution.js
CREATE INDEX IF NOT EXISTS idx_sched_shares_handle ON scheduled_shares(creator_handle, status);
CREATE INDEX IF NOT EXISTS idx_creator_followers_handle ON creator_followers(creator_handle);
CREATE INDEX IF NOT EXISTS idx_creator_announcements_handle ON creator_announcements(creator_handle, created_at);

-- from routes/creator-growth.js
CREATE INDEX IF NOT EXISTS idx_giveaways_handle ON creator_giveaways(creator_handle, status);

-- from routes/creators.js
CREATE INDEX IF NOT EXISTS idx_creator_slug ON creator_landing_pages(slug);

-- from routes/fan-chat.js
CREATE INDEX IF NOT EXISTS idx_fan_messages_thread ON fan_messages(creator_handle, fan_user_id, created_at);

-- from routes/partner-agent.js
CREATE INDEX IF NOT EXISTS idx_partner_agent_actions_user
ON partner_agent_actions(user_id, created_at DESC);

-- from routes/playlists.js
CREATE INDEX IF NOT EXISTS idx_playlists_user ON user_playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid ON playlist_tracks(playlist_id);

-- from routes/qr.js
CREATE INDEX IF NOT EXISTS idx_qr_token ON booking_qr_codes(qr_token);
CREATE INDEX IF NOT EXISTS idx_qr_booking ON booking_qr_codes(booking_id);
CREATE INDEX IF NOT EXISTS idx_checkin_booking ON booking_checkins(booking_id);
CREATE INDEX IF NOT EXISTS idx_checkin_user ON booking_checkins(user_id);

-- from routes/referrals.js
CREATE INDEX IF NOT EXISTS idx_creator_referrals_handle
ON creator_referrals(creator_handle);
CREATE INDEX IF NOT EXISTS idx_creator_referrals_status
ON creator_referrals(status);
CREATE INDEX IF NOT EXISTS idx_creator_referrals_source ON creator_referrals(source);
CREATE INDEX IF NOT EXISTS idx_creator_bounties_handle ON creator_bounties(creator_handle);
CREATE INDEX IF NOT EXISTS idx_gym_boards_user ON gym_boards(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_saves_user ON gym_saves(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_withdrawals_handle
ON creator_withdrawals(creator_handle);
CREATE INDEX IF NOT EXISTS idx_creator_withdrawals_status
ON creator_withdrawals(status);

-- from routes/review-media.js
CREATE INDEX IF NOT EXISTS idx_review_media_gym ON review_media(gym_id);
CREATE INDEX IF NOT EXISTS idx_review_media_review ON review_media(review_id);

-- from routes/squad-agent.js
CREATE INDEX IF NOT EXISTS idx_squad_agent_actions_user
ON squad_agent_actions(user_id, created_at DESC);

-- from routes/streaks.js
CREATE INDEX IF NOT EXISTS idx_streak_user ON gym_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_week ON weekly_leaderboard(week_start, workouts DESC);

-- from server.js
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_handle ON public.users (referral_handle) WHERE referral_handle IS NOT NULL;
