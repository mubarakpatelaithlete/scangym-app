-- ═══════════════════════════════════════════════════════════════════════════
-- 0002  baseline columns, types and constraints
--
-- Baseline of the schema that used to be created at startup by 32 different
-- server files. Every statement is idempotent (IF NOT EXISTS / DO $$ guards),
-- so running it against the live database is a no-op for anything that
-- already exists. Source file noted above each block.
-- Generated as part of "one version of ScanGym" step 10 - do not add new
-- CREATE TABLE statements to route files; add a new migration here instead.
-- ═══════════════════════════════════════════════════════════════════════════



-- from lib/video-variants.js
ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS has_faststart BOOLEAN DEFAULT false;

ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS variants_ready BOOLEAN DEFAULT false;


-- from middleware/analytics.js
-- (this file used to add these four in a JS loop)
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS funnel_step VARCHAR(30);
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS query_params JSONB;
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS response_status INTEGER;
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;

-- users.id is a UUID string; this column started life as INTEGER, so every
-- logged-in event was silently dropped until it was widened.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='analytics_events' AND column_name='user_id' AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE analytics_events ALTER COLUMN user_id TYPE VARCHAR(64) USING user_id::text;
  END IF;
END $$;


-- from routes/access.js
DO $$ BEGIN
  -- Which access control system the gym uses
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_system') THEN
    ALTER TABLE gyms ADD COLUMN access_system VARCHAR(50) DEFAULT NULL;
    COMMENT ON COLUMN gyms.access_system IS 'kisi | salto | brivo | latch | seam | manual | null';
  END IF;

  -- System-specific ID (Seam ACS system ID or Kisi place ID)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_system_id') THEN
    ALTER TABLE gyms ADD COLUMN access_system_id VARCHAR(255) DEFAULT NULL;
  END IF;

  -- Access group ID (which doors to unlock)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_group_id') THEN
    ALTER TABLE gyms ADD COLUMN access_group_id VARCHAR(255) DEFAULT NULL;
  END IF;

  -- Preferred access type for visitors
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_type') THEN
    ALTER TABLE gyms ADD COLUMN access_type VARCHAR(50) DEFAULT 'qr_unlock';
    COMMENT ON COLUMN gyms.access_type IS 'qr_unlock | pin | mobile_key | staff_verify';
  END IF;

  -- Provider-specific API key (encrypted in production)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_api_key') THEN
    ALTER TABLE gyms ADD COLUMN access_api_key TEXT DEFAULT NULL;
  END IF;

  -- Whether access control is active and tested
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_verified') THEN
    ALTER TABLE gyms ADD COLUMN access_verified BOOLEAN DEFAULT FALSE;
  END IF;
END $$;


-- from routes/admin-dashboard.js
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency VARCHAR(8);


-- from routes/auth.js
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fitness_level VARCHAR(50);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS height_cm NUMERIC;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS body_fat_pct NUMERIC;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS muscle_mass_kg NUMERIC;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fitness_goal TEXT;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS age INTEGER;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city VARCHAR(100);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS country VARCHAR(100);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS body_type VARCHAR(30);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS weakest_muscle VARCHAR(100);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS supplements TEXT;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS diet TEXT;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sleep_hours NUMERIC;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS water_litres NUMERIC;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS workout_duration INTEGER;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS weekly_sessions INTEGER;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS diseases TEXT;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS metabolism VARCHAR(30);


-- from routes/booking.js
ALTER TABLE booking_feedback ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating >= 1 AND rating <= 5);


-- from routes/creator-content.js
ALTER TABLE creator_uploads ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;


-- from routes/creators.js
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='creator_memberships' AND column_name='user_id'
      AND data_type NOT IN ('text','character varying')
  ) THEN
    ALTER TABLE creator_memberships ALTER COLUMN user_id TYPE TEXT USING user_id::text;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='creator_landing_pages' AND column_name='creator_user_id' AND data_type NOT IN ('text','character varying')
  ) THEN
    ALTER TABLE creator_landing_pages ALTER COLUMN creator_user_id TYPE TEXT USING creator_user_id::text;
  END IF;
END $$;


-- from routes/gym-owner-quick.js
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='complaint_count') THEN
    ALTER TABLE gyms ADD COLUMN complaint_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='suspended_until') THEN
    ALTER TABLE gyms ADD COLUMN suspended_until TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='strike_count') THEN
    ALTER TABLE gyms ADD COLUMN strike_count INTEGER DEFAULT 0;
  END IF;
END $$;


-- from routes/gym-partner.js
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claimed_by') THEN
    ALTER TABLE gyms ADD COLUMN claimed_by VARCHAR(255) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='owner_name') THEN
    ALTER TABLE gyms ADD COLUMN owner_name VARCHAR(255) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='owner_email') THEN
    ALTER TABLE gyms ADD COLUMN owner_email VARCHAR(255) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='owner_phone') THEN
    ALTER TABLE gyms ADD COLUMN owner_phone VARCHAR(50) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_proof_url') THEN
    ALTER TABLE gyms ADD COLUMN claim_proof_url TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claimed_at') THEN
    ALTER TABLE gyms ADD COLUMN claimed_at TIMESTAMP DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_method') THEN
    ALTER TABLE gyms ADD COLUMN access_method VARCHAR(50) DEFAULT 'qr';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='description') THEN
    ALTER TABLE gyms ADD COLUMN description TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='three_day_price') THEN
    ALTER TABLE gyms ADD COLUMN three_day_price NUMERIC(10,2) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='weekly_price') THEN
    ALTER TABLE gyms ADD COLUMN weekly_price NUMERIC(10,2) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='monthly_price') THEN
    ALTER TABLE gyms ADD COLUMN monthly_price NUMERIC(10,2) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='photos') THEN
    ALTER TABLE gyms ADD COLUMN photos JSONB DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='metadata') THEN
    ALTER TABLE gyms ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='ownership_verified') THEN
    ALTER TABLE gyms ADD COLUMN ownership_verified BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='ownership_verified_at') THEN
    ALTER TABLE gyms ADD COLUMN ownership_verified_at TIMESTAMP DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_status') THEN
    ALTER TABLE gyms ADD COLUMN claim_status VARCHAR(50) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_proof_type') THEN
    ALTER TABLE gyms ADD COLUMN claim_proof_type VARCHAR(20) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_proof_at') THEN
    ALTER TABLE gyms ADD COLUMN claim_proof_at TIMESTAMP DEFAULT NULL;
  END IF;
END $$;


-- from routes/identity.js
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='identity_verified') THEN
    ALTER TABLE users ADD COLUMN identity_verified BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='identity_session_id') THEN
    ALTER TABLE users ADD COLUMN identity_session_id VARCHAR(255) DEFAULT NULL;
  END IF;
END $$;


-- from routes/liveSearch.js
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='currency') THEN
    ALTER TABLE gyms ADD COLUMN currency VARCHAR(10) DEFAULT 'GBP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='country') THEN
    ALTER TABLE gyms ADD COLUMN country VARCHAR(10) DEFAULT 'GB';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='is_accepting_bookings') THEN
    ALTER TABLE gyms ADD COLUMN is_accepting_bookings BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='is_24h') THEN
    ALTER TABLE gyms ADD COLUMN is_24h BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='is_self_service') THEN
    ALTER TABLE gyms ADD COLUMN is_self_service BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='lat') THEN
    ALTER TABLE gyms ADD COLUMN lat DOUBLE PRECISION DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='lng') THEN
    ALTER TABLE gyms ADD COLUMN lng DOUBLE PRECISION DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='phone') THEN
    ALTER TABLE gyms ADD COLUMN phone VARCHAR(50) DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='website') THEN
    ALTER TABLE gyms ADD COLUMN website TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='rating') THEN
    ALTER TABLE gyms ADD COLUMN rating NUMERIC(3,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='zip_code') THEN
    ALTER TABLE gyms ADD COLUMN zip_code VARCHAR(20) DEFAULT '';
  END IF;
END $$;


-- from routes/payment.js
-- (payment.js used to add these on every first payment request)
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'instant';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_code VARCHAR(50);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS qr_code VARCHAR(100);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS qr_code_url TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) DEFAULT 'Guest';


-- from routes/qr.js
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='booking_qr_codes' AND column_name='user_id' AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE booking_qr_codes ALTER COLUMN user_id TYPE VARCHAR(255) USING user_id::text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qr_booking') THEN
    ALTER TABLE booking_qr_codes ADD CONSTRAINT fk_qr_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_checkin_booking') THEN
    ALTER TABLE booking_checkins ADD CONSTRAINT fk_checkin_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_checkin_qr') THEN
    ALTER TABLE booking_checkins ADD CONSTRAINT fk_checkin_qr FOREIGN KEY (qr_code_id) REFERENCES booking_qr_codes(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_device_id') THEN
    ALTER TABLE gyms ADD COLUMN access_device_id VARCHAR(255) DEFAULT NULL;
  END IF;
END $$;


-- from routes/referrals.js
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS referral_code VARCHAR(100);

ALTER TABLE creator_referrals ADD COLUMN IF NOT EXISTS source VARCHAR(50);

ALTER TABLE creator_referrals ADD COLUMN IF NOT EXISTS gym_id VARCHAR(100);

ALTER TABLE creator_memberships
ADD COLUMN IF NOT EXISTS total_withdrawn_pence INTEGER DEFAULT 0;


-- from server.js
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS duration REAL;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_handle VARCHAR(100);
