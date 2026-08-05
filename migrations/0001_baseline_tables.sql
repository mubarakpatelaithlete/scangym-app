-- ═══════════════════════════════════════════════════════════════════════════
-- 0001  baseline tables
--
-- Baseline of the schema that used to be created at startup by 32 different
-- server files. Every statement is idempotent (IF NOT EXISTS / DO $$ guards),
-- so running it against the live database is a no-op for anything that
-- already exists. Source file noted above each block.
-- Generated as part of "one version of ScanGym" step 10 - do not add new
-- CREATE TABLE statements to route files; add a new migration here instead.
-- ═══════════════════════════════════════════════════════════════════════════


-- from lib/reels-algorithm.js
CREATE TABLE IF NOT EXISTS video_performance (
  video_id        VARCHAR(50) PRIMARY KEY,
  total_views     INTEGER DEFAULT 0,
  avg_watch_pct   REAL DEFAULT 0,
  avg_watch_ms    REAL DEFAULT 0,
  completion_rate REAL DEFAULT 0,
  skip_rate       REAL DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  share_count     INTEGER DEFAULT 0,
  save_count      INTEGER DEFAULT 0,
  engagement_score REAL DEFAULT 0.5,
  last_updated    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reel_interactions (
  id          SERIAL PRIMARY KEY,
  session_id  VARCHAR(64),
  video_id    VARCHAR(50),
  action      VARCHAR(20),
  watch_ms    INTEGER DEFAULT 0,
  watch_pct   INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- from lib/video-variants.js
CREATE TABLE IF NOT EXISTS video_variants (
  id          SERIAL PRIMARY KEY,
  video_id    INTEGER NOT NULL,
  cdn_key     VARCHAR(200) NOT NULL,
  quality     VARCHAR(10) NOT NULL,
  r2_key      VARCHAR(300) NOT NULL,
  width       INTEGER,
  height      INTEGER,
  file_size   INTEGER,
  bitrate     INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cdn_key, quality)
);

-- from middleware/analytics.js
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  funnel_step VARCHAR(30),
  path VARCHAR(500),
  method VARCHAR(10),
  user_id VARCHAR(64),
  session_id VARCHAR(100),
  user_agent TEXT,
  ip_address VARCHAR(50),
  referrer TEXT,
  query_params JSONB,
  response_status INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/access.js
CREATE TABLE IF NOT EXISTS booking_access_credentials (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  gym_id INTEGER NOT NULL,
  user_id VARCHAR(255) NOT NULL,

  -- Credential details
  credential_type VARCHAR(50) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  access_link_id VARCHAR(255),
  seam_user_id VARCHAR(255),
  seam_credential_id VARCHAR(255),
  access_url TEXT,
  access_qr_url TEXT,
  pin VARCHAR(20),
  mobile_key BOOLEAN DEFAULT FALSE,
  instructions TEXT,

  -- Time window
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'active',
  revoked_at TIMESTAMP,
  error_message TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- from routes/admin-dashboard.js
CREATE TABLE IF NOT EXISTS nps_responses (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  feedback TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/coach.js + routes/ai-trainer.js (they defined this table twice,
-- with different column types; this is the single merged definition).
-- user_id is VARCHAR because public.users.id is a UUID string, not an integer.
CREATE TABLE IF NOT EXISTS workout_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  gym_id INTEGER,
  workout_type VARCHAR(100),
  duration_minutes INTEGER,
  exercises JSONB,
  muscles_trained TEXT[],
  intensity INTEGER,
  gym_name TEXT,
  notes TEXT,
  energy_level INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/amenities.js
CREATE TABLE IF NOT EXISTS gym_amenities (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER UNIQUE NOT NULL,
  has_locker BOOLEAN DEFAULT false,
  locker_free BOOLEAN DEFAULT true,
  has_towel BOOLEAN DEFAULT false,
  towel_free BOOLEAN DEFAULT true,
  has_shower BOOLEAN DEFAULT false,
  shower_free BOOLEAN DEFAULT true,
  has_changing_room BOOLEAN DEFAULT false,
  has_hair_dryer BOOLEAN DEFAULT false,
  has_music_system BOOLEAN DEFAULT false,
  has_sauna BOOLEAN DEFAULT false,
  has_wifi BOOLEAN DEFAULT false,
  has_parking BOOLEAN DEFAULT false,
  has_water_fountain BOOLEAN DEFAULT false,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gym_vending (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  item_name VARCHAR(100) NOT NULL,
  item_category VARCHAR(50) NOT NULL,
  item_emoji VARCHAR(10),
  price_pence INTEGER NOT NULL,
  in_stock BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(gym_id, item_name)
);

CREATE TABLE IF NOT EXISTS vending_purchases (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  item_name VARCHAR(100),
  amount_pence INTEGER,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/booking.js
CREATE TABLE IF NOT EXISTS booking_feedback (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id VARCHAR(255),
  feedback_type VARCHAR(20) NOT NULL CHECK (feedback_type IN ('positive', 'negative')),
  detail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/channels.js
CREATE TABLE IF NOT EXISTS user_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- No FK to public.users: users.id is a UUID, this column is VARCHAR, so
  -- "REFERENCES public.users(id)" made this CREATE TABLE fail every time
  -- (Postgres: foreign key constraint cannot be implemented). Referential
  -- integrity for user ids is enforced in app code everywhere else too.
  user_id VARCHAR(255) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  channel_user_id VARCHAR(255),
  channel_username VARCHAR(255),
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  UNIQUE(user_id, channel)
);

-- from routes/chat.js
CREATE TABLE IF NOT EXISTS chat_escalations (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  gym_id INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  escalation_reason TEXT,
  owner_notified_sms BOOLEAN DEFAULT false,
  owner_notified_email BOOLEAN DEFAULT false,
  owner_response TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (id SERIAL PRIMARY KEY, title TEXT, created_at TIMESTAMP DEFAULT NOW());

CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, conversation_id INTEGER, role VARCHAR(20), content TEXT, created_at TIMESTAMP DEFAULT NOW());

-- from routes/coach.js
-- user_id widened to VARCHAR: public.users.id is a UUID string.
CREATE TABLE IF NOT EXISTS coach_profiles (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(64) UNIQUE NOT NULL,
  fitness_goals TEXT,
  experience_level VARCHAR(20) DEFAULT 'beginner',
  age INTEGER,
  weight_kg DECIMAL,
  height_cm DECIMAL,
  injuries TEXT,
  preferred_workout_types TEXT,
  available_days VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- user_id widened to VARCHAR: public.users.id is a UUID string.
CREATE TABLE IF NOT EXISTS coach_conversations (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/comms-log.js
CREATE TABLE IF NOT EXISTS comms_log (
  id SERIAL PRIMARY KEY,
  channel VARCHAR(20) NOT NULL DEFAULT 'email',
  direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
  from_addr VARCHAR(255),
  to_addr VARCHAR(255),
  subject VARCHAR(500),
  body TEXT,
  status VARCHAR(20) DEFAULT 'sent',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/creator-distribution.js
CREATE TABLE IF NOT EXISTS scheduled_shares (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  platform VARCHAR(30) NOT NULL DEFAULT 'other',
  caption TEXT,
  share_url TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_followers (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  follower_session VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creator_handle, follower_session)
);

CREATE TABLE IF NOT EXISTS creator_announcements (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/creator-growth.js
CREATE TABLE IF NOT EXISTS creator_giveaways (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  claim_code VARCHAR(20) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  funded_withdrawal_id INTEGER,
  claimed_by_user TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS creator_boosts (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  upload_id INTEGER UNIQUE NOT NULL,
  boost_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_bundles (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) UNIQUE NOT NULL,
  preset VARCHAR(20) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bundle_redemptions (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  user_id TEXT NOT NULL,
  bonus_pence INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creator_handle, user_id)
);

-- from routes/creators.js
CREATE TABLE IF NOT EXISTS creator_memberships (
  id SERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  tier VARCHAR(30) DEFAULT 'starter',
  is_lifetime_free BOOLEAN DEFAULT false,
  total_referrals INTEGER DEFAULT 0,
  total_earnings_pence INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  badge VARCHAR(50),
  community_name VARCHAR(100) DEFAULT 'ScanSquad',
  joined_at TIMESTAMP DEFAULT NOW(),
  upgraded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_landing_pages (
  id SERIAL PRIMARY KEY,
  creator_user_id TEXT NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  creator_name VARCHAR(200) NOT NULL,
  creator_handle VARCHAR(200),
  creator_platform VARCHAR(50),
  headline TEXT,
  subheadline TEXT,
  creator_photo_url TEXT,
  creator_video_url TEXT,
  cta_text VARCHAR(200) DEFAULT 'Book Your First Session — 50% Off',
  target_city VARCHAR(100),
  voice_style TEXT,
  custom_message TEXT,
  views INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_uploads (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100),
  creator_name VARCHAR(200),
  creator_email VARCHAR(200),
  caption TEXT,
  category VARCHAR(100),
  affiliate_link VARCHAR(500),
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(300),
  file_size BIGINT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/fan-chat.js
CREATE TABLE IF NOT EXISTS fan_messages (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  fan_user_id TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL DEFAULT 'fan',
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/group-booking.js
CREATE TABLE IF NOT EXISTS group_bookings (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(12) UNIQUE NOT NULL,
  organizer_id TEXT NOT NULL,
  gym_id INTEGER NOT NULL,
  booking_date DATE NOT NULL,
  time_slot TEXT DEFAULT 'anytime',
  max_members INTEGER DEFAULT 10,
  status TEXT DEFAULT 'open',
  total_amount_pence INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_booking_id INTEGER REFERENCES group_bookings(id),
  user_id TEXT NOT NULL,
  user_name VARCHAR(200),
  user_email VARCHAR(200),
  share_pence INTEGER DEFAULT 0,
  paid BOOLEAN DEFAULT false,
  stripe_payment_intent_id TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_booking_id, user_id)
);

-- from routes/gym-management.js
CREATE TABLE IF NOT EXISTS gym_equipment (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  brand VARCHAR(100),
  quantity INTEGER DEFAULT 1,
  equipment_condition VARCHAR(50) DEFAULT 'good',
  is_out_of_order BOOLEAN DEFAULT false,
  out_of_order_since TIMESTAMPTZ,
  out_of_order_reason TEXT,
  photo_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gym_facilities (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  is_free BOOLEAN DEFAULT true,
  price_pence INTEGER DEFAULT 0,
  is_out_of_order BOOLEAN DEFAULT false,
  out_of_order_since TIMESTAMPTZ,
  out_of_order_reason TEXT,
  photo_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gym_schedule_overrides (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  override_date DATE NOT NULL,
  is_closed BOOLEAN DEFAULT true,
  open_time TEXT,
  close_time TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gym_id, override_date)
);

CREATE TABLE IF NOT EXISTS gym_review_responses (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  review_id INTEGER NOT NULL,
  responder_id TEXT NOT NULL,
  response_text TEXT NOT NULL,
  offer_type VARCHAR(50),
  offer_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gym_id, review_id)
);

-- from routes/gym-partner.js
CREATE TABLE IF NOT EXISTS payout_methods (
  user_id TEXT PRIMARY KEY,
  method VARCHAR(30) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'partner',
  amount_pence INTEGER NOT NULL,
  method VARCHAR(30),
  details JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- from routes/owner.js
CREATE TABLE IF NOT EXISTS gym_pricing (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  pricing_model VARCHAR(30) DEFAULT '24hr_day_pass',
  day_pass_pence INTEGER NOT NULL DEFAULT 500,
  weekly_pass_pence INTEGER,
  monthly_pass_pence INTEGER,
  peak_multiplier DECIMAL DEFAULT 1.0,
  off_peak_discount_pct INTEGER DEFAULT 0,
  student_discount_pct INTEGER DEFAULT 0,
  first_visit_discount_pct INTEGER DEFAULT 50,
  bnpl_enabled BOOLEAN DEFAULT false,
  wallet_accepted BOOLEAN DEFAULT true,
  currency VARCHAR(3) DEFAULT 'GBP',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(gym_id)
);

CREATE TABLE IF NOT EXISTS gym_toggle_log (
  id SERIAL PRIMARY KEY,
  gym_id INTEGER NOT NULL,
  owner_id VARCHAR(255) NOT NULL,
  action VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/partner-agent.js
CREATE TABLE IF NOT EXISTS partner_agent_actions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool VARCHAR(64) NOT NULL,
  args JSONB,
  result JSONB,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/payments-extended.js
-- user_id widened to VARCHAR: public.users.id is a UUID string.
CREATE TABLE IF NOT EXISTS deferred_payments (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  gym_id INTEGER NOT NULL,
  booking_id INTEGER,
  amount_pence INTEGER NOT NULL DEFAULT 449,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- from routes/playlists.js
CREATE TABLE IF NOT EXISTS user_playlists (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT 'My Playlist',
  description TEXT DEFAULT '',
  is_public BOOLEAN DEFAULT false,
  share_token VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  track_name VARCHAR(300) NOT NULL,
  artist VARCHAR(300) DEFAULT '',
  source_playlist VARCHAR(200) DEFAULT '',
  source_index INTEGER DEFAULT 0,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(playlist_id, track_name, artist)
);

-- from routes/qr.js
CREATE TABLE IF NOT EXISTS booking_qr_codes (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  gym_id INTEGER NOT NULL,
  qr_token VARCHAR(100) UNIQUE NOT NULL,
  max_scans INTEGER DEFAULT 2,
  scan_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_checkins (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  qr_code_id INTEGER NOT NULL,
  gym_id INTEGER NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  scan_type VARCHAR(10) NOT NULL,
  scan_number INTEGER NOT NULL,
  scanned_at TIMESTAMP DEFAULT NOW()
);

-- from routes/rebook.js
CREATE TABLE IF NOT EXISTS user_biometric_credentials (
  id SERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rebook_favorites (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  gym_id INTEGER NOT NULL,
  visit_count INTEGER DEFAULT 1,
  last_visited TIMESTAMPTZ DEFAULT NOW(),
  preferred_time TEXT DEFAULT 'anytime',
  UNIQUE(user_id, gym_id)
);

-- from routes/reels.js
CREATE TABLE IF NOT EXISTS video_catalog (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  category      VARCHAR(100) NOT NULL DEFAULT 'General',
  source        VARCHAR(50) NOT NULL DEFAULT 'cdn',
  url           TEXT,
  thumb         TEXT,
  cdn_key       VARCHAR(200) UNIQUE,
  drive_id      VARCHAR(200),
  file_size     INTEGER,
  blurhash      TEXT,
  orientation   VARCHAR(20) DEFAULT 'vertical',
  width         INTEGER DEFAULT 720,
  height        INTEGER DEFAULT 1280,
  dopamine_tier INTEGER DEFAULT 3,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reel_views (
  id SERIAL PRIMARY KEY,
  video_id VARCHAR(50),
  category VARCHAR(50),
  duration_ms INTEGER,
  watch_percent INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/referrals.js
CREATE TABLE IF NOT EXISTS creator_referrals (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  creator_email VARCHAR(200),
  visitor_session VARCHAR(200),
  booking_id INTEGER,
  commission_pence INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'clicked',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  converted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS creator_bounties (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  bounty_type VARCHAR(50) NOT NULL DEFAULT 'signup',
  amount_pence INTEGER NOT NULL DEFAULT 100,
  user_id TEXT,
  status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS gym_boards (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name VARCHAR(200) NOT NULL DEFAULT 'Saved Gyms',
  emoji VARCHAR(10) DEFAULT '💪',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gym_saves (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  gym_id VARCHAR(100) NOT NULL,
  gym_name VARCHAR(300),
  gym_photo_url TEXT,
  board_id INTEGER REFERENCES gym_boards(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, gym_id)
);

CREATE TABLE IF NOT EXISTS creator_withdrawals (
  id SERIAL PRIMARY KEY,
  creator_handle VARCHAR(100) NOT NULL,
  creator_email VARCHAR(200),
  amount_pence INTEGER NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'bank_transfer',
  payment_details JSONB DEFAULT '{}',
  status VARCHAR(30) DEFAULT 'pending',
  admin_notes TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);

-- from routes/review-media.js
CREATE TABLE IF NOT EXISTS review_media (
  id SERIAL PRIMARY KEY,
  review_id INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  gym_id INTEGER,
  media_type VARCHAR(10) NOT NULL CHECK (media_type IN ('photo', 'video')),
  file_path TEXT NOT NULL,
  cdn_url TEXT,
  thumbnail_url TEXT,
  file_size INTEGER DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration_sec REAL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/social-reels.js
CREATE TABLE IF NOT EXISTS social_reels (
  id              SERIAL PRIMARY KEY,
  platform        VARCHAR(20) NOT NULL,
  external_id     VARCHAR(200) UNIQUE NOT NULL,
  title           TEXT,
  author_name     VARCHAR(200),
  author_url      TEXT,
  thumbnail_url   TEXT,
  embed_html      TEXT,
  video_url       TEXT,
  view_count      INTEGER DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  duration_sec    INTEGER,
  search_query    VARCHAR(200),
  category        VARCHAR(100) DEFAULT 'Social',
  is_approved     BOOLEAN DEFAULT true,
  is_hidden       BOOLEAN DEFAULT false,
  fetched_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_reels_cache (
  query_key       VARCHAR(200) PRIMARY KEY,
  result_count    INTEGER DEFAULT 0,
  last_fetched    TIMESTAMPTZ DEFAULT NOW()
);

-- from routes/squad-agent.js
CREATE TABLE IF NOT EXISTS squad_agent_actions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool VARCHAR(64) NOT NULL,
  args JSONB,
  result JSONB,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- from routes/streaks.js
CREATE TABLE IF NOT EXISTS gym_streaks (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_workout_date DATE,
  streak_freezes INTEGER DEFAULT 1,
  total_workouts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  badge_key VARCHAR(100) NOT NULL,
  earned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, badge_key)
);

CREATE TABLE IF NOT EXISTS weekly_leaderboard (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  week_start DATE NOT NULL,
  workouts INTEGER DEFAULT 0,
  total_minutes INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

-- from server.js
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
);
